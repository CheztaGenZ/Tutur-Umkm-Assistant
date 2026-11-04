/**
 * Tes keamanan lokal: akses LAN, CSRF, header, static exposure, zip bomb, injeksi.
 * Jalankan: node scripts/security.test.mjs
 *
 * Server uji memakai DB sementara + WhatsApp palsu. Tidak menyentuh data asli.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import AdmZip from 'adm-zip';
import {
  openDb,
  recordAiUsage,
  createStatusJob,
  getStatusJob,
  createActivity,
  createDraft,
  getDraft,
} from '../src/db.js';
import { createServer } from '../src/server.js';
import { config } from '../src/config.js';

const dir = path.resolve('data-securitytest');
fs.rmSync(dir, { recursive: true, force: true });
const db = openDb(dir);
const bus = new EventEmitter();
bus.setMaxListeners(100);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let qrValue = null;
const revokedStatuses = [];
const sentTexts = [];
const wa = {
  snapshot: () => ({
    status: 'open',
    qr: qrValue,
    me: { id: '628000:1@s.whatsapp.net', name: 'Test', number: '628000' },
    lastError: null,
    since: Date.now(),
  }),
  sendText: async (jid, text) => {
    sentTexts.push({ jid, text });
    await sleep(50);
    return { key: { id: `test_out_${sentTexts.length}` } };
  },
  sendStatus: async () => {},
  resolveStatusRecipients: async (all) => all,
  revokeStatus: async (id, recipients) => {
    revokedStatuses.push({ id, recipients });
    return { key: { id: 'revoke' } };
  },
  restartFresh: async () => {},
  requestHistory: async () => 'test_req',
};

const app = createServer({ db, wa, bus });
const server = app.listen(0, '0.0.0.0');
await new Promise((resolve) => server.once('listening', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const request = (options, body) =>
  new Promise((resolve, reject) => {
    const headers = { ...(options.headers || {}) };
    if (body && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-length')) {
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request({ ...options, headers, timeout: 20000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });

const jsonHeaders = { 'Content-Type': 'application/json' };

const lan = Object.values(os.networkInterfaces())
  .flat()
  .find((n) => n && (n.family === 'IPv4' || n.family === 4) && !n.internal)?.address;

try {
  // 1. Header keamanan + tidak membocorkan Express.
  const home = await request({ hostname: '127.0.0.1', port, path: '/', method: 'GET' });
  check('X-Frame-Options: DENY', home.headers['x-frame-options'] === 'DENY');
  check('X-Content-Type-Options: nosniff', home.headers['x-content-type-options'] === 'nosniff');
  check('Referrer-Policy: no-referrer', home.headers['referrer-policy'] === 'no-referrer');
  const csp = home.headers['content-security-policy'] || '';
  const scriptDirective = csp
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('script-src'));
  check(
    'CSP frame-ancestors none + script self',
    /frame-ancestors 'none'/.test(csp) && scriptDirective === "script-src 'self'",
  );
  check('X-Powered-By tidak ada', !home.headers['x-powered-by']);

  // 2. Host allowlist (DNS rebinding).
  const evilHost = await request({
    hostname: '127.0.0.1',
    port,
    path: '/',
    method: 'GET',
    headers: { Host: 'evil.example' },
  });
  check('Host asing ditolak', evilHost.status === 403);

  // 3. CSRF: content-type dan Origin.
  const textPost = await request(
    {
      hostname: '127.0.0.1',
      port,
      path: '/api/pause',
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
    },
    '{"paused":true}',
  );
  check('POST non-JSON ditolak', textPost.status === 415);

  const evilOrigin = await request(
    {
      hostname: '127.0.0.1',
      port,
      path: '/api/pause',
      method: 'POST',
      headers: { ...jsonHeaders, Origin: 'http://evil.example' },
    },
    '{"paused":true}',
  );
  check('POST Origin asing ditolak', evilOrigin.status === 403);

  const sameOrigin = await request(
    {
      hostname: '127.0.0.1',
      port,
      path: '/api/pause',
      method: 'POST',
      headers: { ...jsonHeaders, Origin: base },
    },
    '{"paused":true}',
  );
  check('POST Origin sama diterima', sameOrigin.status === 200);

  const getWithBody = await request(
    {
      hostname: '127.0.0.1',
      port,
      path: '/api/status',
      method: 'GET',
      headers: { ...jsonHeaders },
    },
    '{bad',
  );
  check('GET tidak mem-parse body JSON', getWithBody.status === 200);

  const malformed = await request(
    {
      hostname: '127.0.0.1',
      port,
      path: '/api/pause',
      method: 'POST',
      headers: { ...jsonHeaders, Origin: base },
    },
    '{bad',
  );
  check(
    'JSON rusak tidak bocorkan stack',
    malformed.status === 400 && malformed.body === '{"error":"JSON tidak valid."}',
  );

  // Mutasi tanpa body tetap harus bisa (DELETE status) dengan body JSON kosong.
  createStatusJob(db, {
    id: 'del_test',
    imagePath: null,
    caption: 'hapus saya',
    scheduledAt: Date.now() + 60_000,
  });
  db.prepare("UPDATE status_jobs SET status = 'sent' WHERE id = 'del_test'").run();
  const deleteStatus = await request(
    {
      hostname: '127.0.0.1',
      port,
      path: '/api/status-jobs/del_test',
      method: 'DELETE',
      headers: { ...jsonHeaders, Origin: base },
    },
    '{}',
  );
  check(
    'DELETE status sent berhasil',
    deleteStatus.status === 200 && getStatusJob(db, 'del_test') === null,
  );

  // Clear antrean draft: pending hilang, riwayat sent tetap.
  createDraft(db, {
    id: 'clear_pending_1',
    jid: '62811@s.whatsapp.net',
    incomingBody: 'satu',
    reply: 'balas satu',
    createdAt: Date.now(),
  });
  createDraft(db, {
    id: 'clear_pending_2',
    jid: '62822@s.whatsapp.net',
    incomingBody: 'dua',
    reply: 'balas dua',
    createdAt: Date.now(),
  });
  createDraft(db, {
    id: 'clear_sent',
    jid: '62833@s.whatsapp.net',
    incomingBody: 'tiga',
    reply: 'balas tiga',
    status: 'sent',
    createdAt: Date.now(),
  });
  const clearRes = await request(
    {
      hostname: '127.0.0.1',
      port,
      path: '/api/drafts?status=pending',
      method: 'DELETE',
      headers: { ...jsonHeaders, Origin: base },
    },
    '{}',
  );
  const clearBody = JSON.parse(clearRes.body || '{}');
  check(
    'clear draft pending saja',
    clearRes.status === 200 &&
      clearBody.deleted === 2 &&
      db.prepare("SELECT COUNT(*) n FROM drafts WHERE status='pending'").get().n === 0 &&
      db.prepare("SELECT COUNT(*) n FROM drafts WHERE status='sent'").get().n === 1,
  );

  // Kirim draft bersamaan: hanya satu yang boleh menang.
  createDraft(db, {
    id: 'race_draft',
    jid: '62899@s.whatsapp.net',
    incomingBody: 'race',
    reply: 'balas race',
    createdAt: Date.now(),
  });
  const beforeRace = sentTexts.length;
  const sendDraft = () =>
    request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/drafts/race_draft/send',
        method: 'POST',
        headers: { ...jsonHeaders, Origin: base },
      },
      '{"reply":"balas race"}',
    );
  const [raceA, raceB] = await Promise.all([sendDraft(), sendDraft()]);
  check(
    'draft send: klaim atomik, tidak dobel',
    [raceA.status, raceB.status].sort().join(',') === '200,409' &&
      sentTexts.length === beforeRace + 1 &&
      getDraft(db, 'race_draft')?.status === 'sent',
    `${raceA.status}/${raceB.status}, ${sentTexts.length - beforeRace} kirim`,
  );

  // Revoke status dari WhatsApp memakai message key yang disimpan.
  createStatusJob(db, {
    id: 'revoke_test',
    imagePath: null,
    caption: 'tarik saya',
    scheduledAt: Date.now() + 60_000,
  });
  db.prepare(
    "UPDATE status_jobs SET status = 'sent', wa_message_id = 'wa_status_x', wa_status_jids = ? WHERE id = 'revoke_test'",
  ).run(JSON.stringify(['62811@s.whatsapp.net']));
  const revokeStatus = await request(
    {
      hostname: '127.0.0.1',
      port,
      path: '/api/status-jobs/revoke_test/revoke',
      method: 'POST',
      headers: { ...jsonHeaders, Origin: base },
    },
    '{}',
  );
  check(
    'revoke status memanggil WhatsApp',
    revokeStatus.status === 200 &&
      getStatusJob(db, 'revoke_test') === null &&
      revokedStatuses.some(
        (r) => r.id === 'wa_status_x' && r.recipients.includes('62811@s.whatsapp.net'),
      ),
  );

  // List publik tidak boleh membocorkan path file, message ID, atau daftar JID.
  createStatusJob(db, {
    id: 'leak_test',
    imagePath: path.join(dir, 'secret_status.png'),
    caption: 'leak-status',
    scheduledAt: Date.now() + 60_000,
  });
  db.prepare(
    "UPDATE status_jobs SET status = 'sent', wa_message_id = 'SECRET_STATUS_ID', wa_status_jids = ? WHERE id = 'leak_test'",
  ).run(JSON.stringify(['SECRET_STATUS_JID@s.whatsapp.net']));
  createActivity(db, {
    id: 'leak_activity',
    text: 'leak-activity',
    imagePath: path.join(dir, 'secret_activity.png'),
    expiresAt: null,
  });
  const statusList = await request({
    hostname: '127.0.0.1',
    port,
    path: '/api/status-jobs',
    method: 'GET',
  });
  const activityList = await request({
    hostname: '127.0.0.1',
    port,
    path: '/api/activities',
    method: 'GET',
  });
  check(
    'status list tidak bocorkan path/id/jid',
    !statusList.body.includes('secret_status') &&
      !statusList.body.includes('SECRET_STATUS') &&
      statusList.body.includes('"has_image":true') &&
      statusList.body.includes('"can_revoke":true'),
  );
  check(
    'activity list tidak bocorkan path',
    !activityList.body.includes('secret_activity') && activityList.body.includes('"has_image":true'),
  );

  // 4. Akses tulis dari LAN.
  if (lan) {
    const lanBase = `http://${lan}:${port}`;
    const lanStatus = await fetch(`${lanBase}/api/status`).then((r) => r.json());
    const lanSettings = await (await fetch(`${lanBase}/api/settings`)).json();
    check('LAN status canWrite=false', lanStatus.canWrite === false);
    check('LAN status tidak bocorkan nomor', !lanStatus.wa.me?.number);
    check('LAN settings canEdit=false', lanSettings.canEdit === false);
    check('LAN settings tidak bocorkan mask key', !('apiKeyMasked' in lanSettings));
    const lanSent = await fetch(`${lanBase}/api/drafts?status=sent`);
    check('LAN riwayat draft ditolak', lanSent.status === 403);
    const lanContext = await fetch(`${lanBase}/api/contacts/62811@s.whatsapp.net/context`);
    check('LAN context chat ditolak', lanContext.status === 403);
    const lanWrite = await request(
      {
        hostname: lan,
        port,
        path: '/api/pause',
        method: 'POST',
        headers: { ...jsonHeaders, Origin: lanBase },
      },
      '{"paused":true}',
    );
    check('LAN POST ditolak 403', lanWrite.status === 403);
    check('LAN usage tetap terbaca', (await fetch(`${lanBase}/api/usage`)).ok);
  } else {
    check('LAN guard (tidak ada IP LAN, dilewati)', true);
  }

  // 4b. QR pairing hanya untuk PC, bukan LAN.
  qrValue = 'data:image/png;base64,QR_SECRET';
  const localQr = await (await fetch(`${base}/api/status`)).json();
  check('QR lokal terlihat', localQr.wa.qr === qrValue);
  if (lan) {
    const lanQr = await (await fetch(`http://${lan}:${port}/api/status`)).json();
    check('QR LAN disembunyikan', lanQr.wa.qr === null);
  }
  qrValue = null;

  // 5. Backup lama tidak boleh ke-serve.
  const backup = await request({ hostname: '127.0.0.1', port, path: '/.backup/index.html', method: 'GET' });
  check('backup .backup tidak ke-serve', backup.status === 404 || backup.status === 403);

  // 6. Path traversal.
  const traversal = await request({
    hostname: '127.0.0.1',
    port,
    path: '/%2e%2e/%2e%2e/.env',
    method: 'GET',
  });
  check('path traversal .env ditolak', traversal.status === 404 || traversal.status === 403);

  // 7. API key tidak bocor.
  const settings = await request({ hostname: '127.0.0.1', port, path: '/api/settings', method: 'GET' });
  const status = await request({ hostname: '127.0.0.1', port, path: '/api/status', method: 'GET' });
  check(
    'API key tidak bocor di settings/status',
    !settings.body.includes(config.ai.apiKey) && !status.body.includes(config.ai.apiKey),
  );
  check('Cache-Control no-store di API', /no-store/.test(status.headers['cache-control'] || ''));

  recordAiUsage(db, {
    ts: Date.now(),
    kind: 'test',
    model: 'security-model',
    baseUrl: 'https://user:pass@example.com/v1?api_key=SECRET',
    promptTokens: 1,
    completionTokens: 1,
    totalTokens: 2,
  });
  const usageLeak = await (await fetch(`${base}/api/usage`)).json();
  check(
    'usage tidak membocorkan baseUrl',
    !JSON.stringify(usageLeak).includes('SECRET') && !('baseUrl' in (usageLeak.last || {})),
  );

  // 8. SQL injection sederhana.
  const injDraft = await fetch(`${base}/api/drafts?status=${encodeURIComponent("' OR 1=1 --")}`);
  const injContacts = await fetch(`${base}/api/contacts?q=${encodeURIComponent("' OR 1=1 --")}`);
  check('SQL injection tidak merusak API', injDraft.status === 200 && injContacts.status === 200);

  // 9. Zip bomb: file teks 21 MB harus ditolak sebelum diekstrak.
  const zip = new AdmZip();
  zip.addFile('bomb.txt', Buffer.alloc(21 * 1024 * 1024, 0x61));
  const bombBody = JSON.stringify({ file: zip.toBuffer().toString('base64') });
  const bomb = await request(
    {
      hostname: '127.0.0.1',
      port,
      path: '/api/ingest/unzip',
      method: 'POST',
      headers: { ...jsonHeaders, Origin: base },
    },
    bombBody,
  );
  check('zip bomb ditolak 413', bomb.status === 413);

  // 10. SSE: QR LAN diredaksi, koneksi dibatasi per IP, cleanup setelah abort.
  const readSse = (hostname, bucket) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { hostname, port, path: '/api/events', method: 'GET' },
        (res) => {
          res.on('data', (c) => {
            bucket.data += c;
          });
          resolve({ req, status: res.statusCode });
        },
      );
      req.on('error', reject);
      req.end();
    });

  const localSseData = { data: '' };
  const lanSseData = { data: '' };
  const localSse = await readSse('127.0.0.1', localSseData);
  const lanSse = lan ? await readSse(lan, lanSseData) : null;
  bus.emit('event', { type: 'wa', state: { status: 'qr', qr: 'SSE_QR_SECRET' } });
  await sleep(250);
  check('SSE QR lokal terlihat', localSseData.data.includes('SSE_QR_SECRET'));
  if (lan) check('SSE QR LAN disembunyikan', !lanSseData.data.includes('SSE_QR_SECRET'));

  bus.emit('event', {
    type: 'sent',
    jid: 'SSE_SECRET_JID',
    contact: 'SSE_SECRET_CONTACT',
    reply: 'SSE_SECRET_REPLY',
  });
  bus.emit('event', { type: 'log', message: 'SSE_SECRET_LOG' });
  await sleep(250);
  check(
    'SSE lokal terlihat isi pesan',
    localSseData.data.includes('SSE_SECRET_REPLY') && localSseData.data.includes('SSE_SECRET_LOG'),
  );
  if (lan) {
    check(
      'SSE LAN redaksi isi pesan',
      !lanSseData.data.includes('SSE_SECRET_REPLY') &&
        !lanSseData.data.includes('SSE_SECRET_CONTACT') &&
        !lanSseData.data.includes('SSE_SECRET_JID') &&
        !lanSseData.data.includes('SSE_SECRET_LOG'),
    );
  }
  localSse.req.destroy();
  if (lanSse) lanSse.req.destroy();
  await sleep(200);

  const sseReqs = [];
  const openSse = () =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port, path: '/api/events', method: 'GET' },
        (res) => {
          res.resume();
          resolve({ req, status: res.statusCode });
        },
      );
      req.on('error', reject);
      req.end();
      sseReqs.push(req);
    });

  for (let i = 0; i < 5; i++) {
    const s = await openSse();
    if (s.status !== 200) check(`SSE koneksi ${i + 1}`, false, `status ${s.status}`);
  }
  const extraSse = await request({
    hostname: '127.0.0.1',
    port,
    path: '/api/events',
    method: 'GET',
  });
  check('SSE per IP dibatasi', extraSse.status === 429);

  for (const req of sseReqs) req.destroy();
  await sleep(200);
  const afterClose = await openSse();
  check('SSE pulih setelah ditutup', afterClose.status === 200);
  afterClose.req.destroy();
  await sleep(100);

  for (let i = 0; i < 30; i++) {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/api/events', method: 'GET' });
    req.on('error', () => {});
    req.end();
    req.destroy();
  }
  await sleep(300);
  const afterAbort = await openSse();
  check('SSE pulih setelah abort', afterAbort.status === 200);
  afterAbort.req.destroy();
  for (const req of sseReqs) req.destroy();
  await sleep(250);
  check('SSE listener bersih setelah ditutup', bus.listenerCount('event') === 0);

  console.log(`\n${results.filter(Boolean).length}/${results.length} tes keamanan lulus`);
  if (results.some((r) => !r)) process.exitCode = 1;
} catch (err) {
  console.error('SECURITY TEST GAGAL:', err.message);
  process.exitCode = 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
  try {
    db.close();
  } catch {}
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Smoke test: jalankan server sungguhan, lalu uji endpoint HTTP.
 * Tidak butuh WhatsApp login maupun API key AI.
 * Jalankan: node scripts/smoke.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import AdmZip from 'adm-zip';

const PORT = 3199;
const DATA_DIR = path.resolve('data-smoke');
fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
const ENV_FILE = path.join(DATA_DIR, '.env');
fs.writeFileSync(
  ENV_FILE,
  [
    'AI_BASE_URL=http://127.0.0.1:3198/v1',
    'AI_API_KEY=dummy-key',
    'AI_MODEL=deepseek-flash',
    'MY_NAME=Chesta',
  ].join('\n'),
);

const child = spawn(process.execPath, ['src/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    BIND_HOST: '0.0.0.0',
    DATA_DIR,
    ENV_FILE,
    IMPORT_INBOX: path.join(DATA_DIR, 'import-inbox'),
    AI_BASE_URL: 'http://127.0.0.1:3198/v1',
    AI_API_KEY: 'dummy-key',
    WA_DISABLED: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));

const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${base}/api/status`);
      if (res.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('Server tidak mau start:\n' + log);
}

const SAMPLE = `12/03/24 09.01 - Budi: bro jadi ga nih meetingnya
12/03/24 09.02 - Aku: jadi
12/03/24 09.02 - Aku: jam 2 ya
12/03/24 09.05 - Budi: oke sip
12/03/24 09.06 - Aku: otw nanti gue kabarin
12/03/24 10.11 - Budi: itu file udah dikirim belum?
12/03/24 10.15 - Aku: blm wkwk
12/03/24 10.15 - Aku: nanti sore gue kirim
12/03/24 10.20 - Budi: oke
12/03/24 11.00 - Budi: btw kemarin lo jadi ke bandung?
12/03/24 11.02 - Aku: jadi dong
12/03/24 11.02 - Aku: seru bgt asli
12/03/24 11.03 - Budi: wkwk enak aja
12/03/24 11.05 - Aku: kapan2 ikut lah
12/03/24 11.30 - Budi: nanti gue kabarin
12/03/24 11.31 - Aku: siap
12/03/24 12.00 - Budi: eh lo tau harga tiket nya ga
12/03/24 12.02 - Aku: ga tau tuh
12/03/24 12.02 - Aku: cek aja di app
12/03/24 12.10 - Budi: oke nanti gue cek
12/03/24 12.11 - Aku: sip
12/03/24 13.00 - Budi: btw makasih ya kemarin
12/03/24 13.05 - Aku: gpp santai
12/03/24 13.06 - Aku: kapan2 ngopi lagi
12/03/24 13.07 - Budi: boleh tuh
12/03/24 13.08 - Aku: okey
12/03/24 13.09 - Aku: gue lanjut kerja dulu ya
12/03/24 14.00 - Budi: semangat
12/03/24 14.01 - Aku: oke`;

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

try {
  await waitForServer();
  check('server start', true);

  const status = await (await fetch(`${base}/api/status`)).json();
  check('GET /api/status', status.wa && status.config.maxPerDay >= 1, `wa=${status.wa.status}, max/hari=${status.config.maxPerDay}`);
  check('API key tidak bocor', !JSON.stringify(status).includes('dummy-key'));
  check(
    'status usage fields',
    typeof status.usage?.totalTokens === 'number' && typeof status.usage?.todayTokens === 'number',
  );

  const settings = await (await fetch(`${base}/api/settings`)).json();
  check('GET /api/settings', settings.canEdit === true && settings.hasApiKey === true, settings.model);
  check('API key tidak bocor di settings', !JSON.stringify(settings).includes('dummy-key'));

  const usage = await (await fetch(`${base}/api/usage`)).json();
  check('GET /api/usage', usage.totalTokens === 0 && Array.isArray(usage.byKind));

  const savedRes = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: 'http://127.0.0.1:3198/v1',
      model: 'deepseek-chat',
      thinking: 'off',
      temperature: 1,
      maxTokens: 1000,
      me: 'Smoke',
    }),
  });
  const saved = await savedRes.json();
  check(
    'PUT /api/settings live',
    savedRes.ok && saved.model === 'deepseek-chat' && saved.hasApiKey === true && saved.persisted === true,
    saved.warning || '',
  );
  const status2 = await (await fetch(`${base}/api/status`)).json();
  check('status memakai model baru', status2.config.model === 'deepseek-chat');

  const lan = Object.values(os.networkInterfaces())
    .flat()
    .find((n) => n && (n.family === 'IPv4' || n.family === 4) && !n.internal)?.address;
  if (lan) {
    const lanBase = `http://${lan}:${PORT}`;
    const lanSettings = await (await fetch(`${lanBase}/api/settings`)).json();
    check('LAN settings read-only', lanSettings.canEdit === false);
    const lanPut = await fetch(`${lanBase}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    check('LAN PUT ditolak 403', lanPut.status === 403);
    const lanUsage = await fetch(`${lanBase}/api/usage`);
    check('LAN usage tetap terbaca', lanUsage.ok);
  } else {
    check('LAN guard (tidak ada IP LAN, dilewati)', true);
  }

  const page = await fetch(base + '/');
  const html = await page.text();
  check('dashboard ter-serve', page.ok && html.includes('WA Reply AI'));

  const preview = await (
    await fetch(`${base}/api/ingest/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: SAMPLE }),
    })
  ).json();
  check('preview export', preview.total === 29 && preview.authors.length === 2, `${preview.total} pesan`);

  // Export WhatsApp berbentuk zip (folder + file .txt di dalamnya)
  const zip = new AdmZip();
  zip.addFile('WhatsApp Chat with Budi/WhatsApp Chat with Budi.txt', Buffer.from(SAMPLE, 'utf8'));
  const unzipRes = await fetch(`${base}/api/ingest/unzip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: 'data:application/zip;base64,' + zip.toBuffer().toString('base64') }),
  });
  const unzipped = await unzipRes.json();
  check(
    'zip diekstrak otomatis',
    unzipRes.ok && unzipped.files?.length === 1 && unzipped.files[0].raw.includes('meetingnya'),
    unzipped.files?.[0]?.name,
  );

  const badZip = await fetch(`${base}/api/ingest/unzip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: Buffer.from('bukan zip').toString('base64') }),
  });
  check('zip rusak ditolak rapi', badZip.status === 400);

  const ingestRes = await fetch(`${base}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: SAMPLE, meName: 'Aku', contactName: 'Budi' }),
  });
  const ingest = await ingestRes.json();
  check(
    'ingest profil gaya',
    ingestRes.ok && ingest.ok && ingest.myMessages === 17 && ingest.pairs >= 8,
    `${ingest.myMessages} pesanmu, ${ingest.pairs} pasangan`,
  );
  check('catatan gaya dihasilkan', Array.isArray(ingest.style?.notes) && ingest.style.notes.length >= 4);
  check(
    'error AI tidak merusak ingest',
    typeof ingest.relationship === 'string' && /gagal membuat ringkasan/i.test(ingest.relationship),
    ingest.relationship?.slice(0, 40),
  );

  const contacts = await (await fetch(`${base}/api/contacts`)).json();
  const budi = contacts.find((c) => c.name === 'Budi');
  check('kontak tersimpan', !!budi && budi.mode === 'draft', `mode=${budi?.mode}, sampel=${budi?.sampleCount}`);

  const patchRes = await fetch(`${base}/api/contacts/${encodeURIComponent(budi.jid)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'auto' }),
  });
  const patched = await patchRes.json();
  check('ubah mode ke auto', patched.mode === 'auto');

  const badMode = await fetch(`${base}/api/contacts/${encodeURIComponent(budi.jid)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'bebas' }),
  });
  check('mode tidak valid ditolak', badMode.status === 400);

  const drafts = await (await fetch(`${base}/api/drafts`)).json();
  check('GET /api/drafts', Array.isArray(drafts) && drafts.length === 0);

  const pause = await (
    await fetch(`${base}/api/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: true }),
    })
  ).json();
  check('tombol jeda', pause.paused === true);

  const ctx = await (await fetch(`${base}/api/contacts/${encodeURIComponent(budi.jid)}/context`)).json();
  check('context kontak', ctx.style?.sampleSize === 17 && ctx.examples.length > 0);

  const sse = await fetch(`${base}/api/events`, { signal: AbortSignal.timeout(1200) }).catch((e) => e);
  check('endpoint SSE hidup', sse instanceof Error || sse.ok);

  // Import banyak kontak sekaligus (satu file per kontak).
  for (const nama of ['Sari', 'Rina', 'Dewi']) {
    const res = await fetch(`${base}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: SAMPLE.replaceAll('Budi', nama), meName: 'Aku', contactName: nama }),
    });
    const r = await res.json();
    check(`import file kontak ${nama}`, res.ok && r.ok, `${r.myMessages} pesanmu`);
  }
  const all = await (await fetch(`${base}/api/contacts`)).json();
  check('4 kontak tersimpan', all.length === 4, `${all.length} kontak`);
  check(
    'semua kontak punya profil gaya',
    all.every((c) => c.hasStyle && c.sampleCount === 17),
  );
} catch (err) {
  console.error('SMOKE GAGAL:', err.message);
  process.exitCode = 1;
} finally {
  child.kill('SIGKILL');
  await sleep(300);
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} tes gagal` : `\n${results.length} tes lulus`);
  if (failed) process.exitCode = 1;
}

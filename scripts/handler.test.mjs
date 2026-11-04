/**
 * Tes alur pesan masuk dengan AI tiruan (tanpa WhatsApp & tanpa API key asli).
 * Jalankan: node scripts/handler.test.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

/* ------------------------- AI tiruan (OpenAI-style) ------------------------ */

let nextReply = { reply: 'sip', confidence: 0.95, reason: 'aman' };
let aiCalls = 0;
let lastAiBody = '';
let aiDelayMs = 0;

const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    aiCalls++;
    lastAiBody = body;
    const isRelationship = body.includes('menganalisis hubungan');
    const content = isRelationship
      ? { relationship: 'Teman kerja, akrab, sering bahas deadline.' }
      : nextReply;
    if (aiDelayMs) await new Promise((r) => setTimeout(r, aiDelayMs));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [{ message: { content: '```json\n' + JSON.stringify(content) + '\n```' } }],
      }),
    );
  });
});
await new Promise((r) => mock.listen(3198, r));

/* --------------------------- environment & import -------------------------- */

const DATA_DIR = path.resolve('data-handlertest');
fs.rmSync(DATA_DIR, { recursive: true, force: true });

process.env.AI_BASE_URL = 'http://localhost:3198/v1';
process.env.AI_API_KEY = 'test';
process.env.MY_NAME = 'Aku';
process.env.DATA_DIR = DATA_DIR;
process.env.QUIET_HOURS = 'off'; // jam tenang diuji terpisah di selftest.mjs
process.env.AI_TRANSCRIBE_LOCAL = 'false'; // transkrip diuji terpisah
process.env.DEBOUNCE_MS = '0'; // tanpa tunda saat tes

const { openDb } = await import('../src/db.js');
const store = await import('../src/db.js');
const { createMessageHandler } = await import('../src/wa/handler.js');

const db = openDb(DATA_DIR);
const bus = new EventEmitter();
const sent = [];
const wa = {
  async sendText(jid, text) {
    sent.push({ jid, text });
    return { key: { id: `out_${sent.length}` } };
  },
  async downloadMedia() {
    return Buffer.from('gambar-palsu-untuk-tes');
  },
};

const handler = createMessageHandler({ db, wa, bus });

const msg = (over = {}) => ({
  id: `m_${Math.random().toString(36).slice(2)}`,
  chatJid: '62811@s.whatsapp.net',
  isGroup: false,
  isStatus: false,
  isNewsletter: false,
  fromMe: false,
  pushName: 'Budi',
  text: 'halo bro',
  hasMedia: false,
  timestamp: Date.now(),
  ...over,
});

const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const draftCount = () => db.prepare("SELECT COUNT(*) AS n FROM drafts WHERE status = 'pending'").get().n;
const outCount = () => db.prepare("SELECT COUNT(*) AS n FROM messages WHERE status = 'auto_sent'").get().n;

/* ---------------------------------- kasus --------------------------------- */

// 1. Kontak mode auto -> dikirim otomatis
const autoJid = '62811@s.whatsapp.net';
store.upsertContact(db, { jid: autoJid, number: '62811', name: 'Budi' });
store.setContactMode(db, autoJid, 'auto');
await handler.handle(msg({ chatJid: autoJid }));
const autoSent = sent.filter((s) => s.jid === autoJid);
check(
  'auto: balasan terkirim',
  autoSent.length >= 1 && autoSent[0].text === 'sip',
  `${autoSent.length}x: ${autoSent.map((s) => s.text).join(' | ')}`,
);
check('auto: tercatat di messages', outCount() === autoSent.length);
check('auto: tercatat di drafts sebagai sent', db.prepare("SELECT COUNT(*) AS n FROM drafts WHERE status='sent'").get().n === 1);

// 1b. Pesan kedua saat AI masih memproses pesan pertama -> antre, jangan hilang.
const lockJid = '62812@s.whatsapp.net';
store.upsertContact(db, { jid: lockJid, number: '62812', name: 'Antre' });
store.setContactMode(db, lockJid, 'auto');
store.setContactRegister(db, lockJid, 'temen');
aiDelayMs = 300;
const lockA = handler.handle(msg({ chatJid: lockJid, text: 'pesan satu' }));
const lockB = handler.handle(msg({ chatJid: lockJid, text: 'pesan dua' }));
await Promise.all([lockA, lockB]);
aiDelayMs = 0;
const lockSent = sent.filter((s) => s.jid === lockJid);
check(
  'lock: pesan kedua tetap diproses',
  lockSent.length >= 2 && lockSent.every((s) => s.text === 'sip' || ['wkwk', 'asu', 'yoo', 'loh'].includes(s.text)),
  `${lockSent.length}x: ${lockSent.map((s) => s.text).join(' | ')}`,
);

// 2. Kontak mode draft -> tidak dikirim
const draftJid = '62822@s.whatsapp.net';
store.upsertContact(db, { jid: draftJid, number: '62822', name: 'Sari' });
store.setContactMode(db, draftJid, 'draft');
const beforeDraft = sent.length;
await handler.handle(msg({ chatJid: draftJid, pushName: 'Sari', text: 'nanti jadi?' }));
check('draft: tidak terkirim', sent.length === beforeDraft);
check('draft: muncul di antrean', draftCount() === 1);

// 3. Kontak "jangan" -> AI tidak dipanggil sama sekali
const blockedJid = '62833@s.whatsapp.net';
store.upsertContact(db, { jid: blockedJid, number: '62833', name: 'Bos' });
store.setContactMode(db, blockedJid, 'ignore');
const callsBefore = aiCalls;
await handler.handle(msg({ chatJid: blockedJid, pushName: 'Bos', text: 'kerjaan udah?' }));
check('ignore: AI tidak dipanggil', aiCalls === callsBefore, `calls ${callsBefore}->${aiCalls}`);
check('ignore: tidak ada draft baru', draftCount() === 1);
check(
  'ignore: ditandai di log',
  db.prepare("SELECT COUNT(*) AS n FROM messages WHERE status='ignored'").get().n === 1,
);

// 4. Grup -> tidak pernah disentuh
const beforeGroup = sent.length;
await handler.handle(msg({ chatJid: '12345@g.us', isGroup: true, text: 'rapat jam 9' }));
check('grup: tidak dibalas', sent.length === beforeGroup);
check('grup: tidak dibuatkan kontak', !store.getContact(db, '12345@g.us'));

// 5. Pesan lama (backlog) -> dilewati
const oldJid = '62844@s.whatsapp.net';
store.upsertContact(db, { jid: oldJid, number: '62844', name: 'Lama' });
store.setContactMode(db, oldJid, 'auto');
const beforeBacklog = sent.length;
await handler.handle(msg({ chatJid: oldJid, timestamp: Date.now() - 30 * 60 * 1000 }));
check('backlog: tidak dibalas', sent.length === beforeBacklog);
check(
  'backlog: ditandai skipped',
  db.prepare("SELECT COUNT(*) AS n FROM messages WHERE status='skipped'").get().n === 1,
);

// 6. AI bilang tidak perlu dibalas -> tidak ada draft
nextReply = { reply: null, confidence: 0.9, reason: 'cuma info' };
const infoJid = '62855@s.whatsapp.net';
store.upsertContact(db, { jid: infoJid, number: '62855', name: 'Info' });
store.setContactMode(db, infoJid, 'draft');
await handler.handle(msg({ chatJid: infoJid, text: 'besok libur' }));
check('tanpa jawaban: tidak ada draft', draftCount() === 1);

// 7. Confidence rendah di mode auto -> turun jadi draft
nextReply = { reply: 'boleh', confidence: 0.2, reason: 'topik sensitif' };
const lowJid = '62866@s.whatsapp.net';
store.upsertContact(db, { jid: lowJid, number: '62866', name: 'Risky' });
store.setContactMode(db, lowJid, 'auto');
const beforeLow = sent.length;
await handler.handle(msg({ chatJid: lowJid, text: 'pinjam duit dong' }));
check('confidence rendah: tidak terkirim', sent.length === beforeLow);
check('confidence rendah: jadi draft', draftCount() === 2);

// 8. Pesan ganda (id sama) -> tidak dibalas dua kali
const dup = msg({ chatJid: draftJid, text: 'halo lagi' });
await handler.handle(dup);
await handler.handle(dup);
check('duplikat: hanya sekali proses', draftCount() === 3);

// 9. Media
const mediaJid = '62878@s.whatsapp.net';
store.upsertContact(db, { jid: mediaJid, number: '62878', name: 'Media' });
store.setContactMode(db, mediaJid, 'draft');

// 9a. Gambar -> dikirim ke AI sebagai vision
lastAiBody = '';
await handler.handle(
  msg({
    chatJid: mediaJid,
    text: '',
    hasMedia: true,
    mediaType: 'image',
    mimetype: 'image/png',
    raw: {},
  }),
);
check('gambar dikirim ke AI sebagai vision', lastAiBody.includes('image_url'));

// 9b. Pesan suara tanpa layanan transkrip -> dilewati
await handler.handle(
  msg({ chatJid: mediaJid, text: '', hasMedia: true, mediaType: 'audio', mimetype: 'audio/ogg', raw: {} }),
);
check(
  'pesan suara tanpa transkrip dilewati',
  db.prepare("SELECT COUNT(*) AS n FROM messages WHERE status='skipped' AND reason LIKE '%suara%'").get().n >= 1,
);

// 9c. Video belum didukung -> dilewati
await handler.handle(
  msg({ chatJid: mediaJid, text: '', hasMedia: true, mediaType: 'video', raw: {} }),
);
check(
  'video dilewati',
  db.prepare("SELECT COUNT(*) AS n FROM messages WHERE status='skipped' AND reason LIKE '%video%'").get().n >= 1,
);

// 10. Pesan yang kamu kirim sendiri -> dicatat, tidak dibalas
const beforeManual = sent.length;
await handler.handle(msg({ chatJid: draftJid, fromMe: true, text: 'gue jawab sendiri' }));
check(
  'pesan manual: dicatat',
  db.prepare("SELECT COUNT(*) AS n FROM messages WHERE status='manual'").get().n === 1,
);
check('pesan manual: tidak memicu AI', sent.length === beforeManual);

// 10b. Kontak teman dengan kata kasar -> draft, bukan crash
nextReply = { reply: 'asu', confidence: 0.9, reason: 'tes kasar' };
const heavyJid = '62879@s.whatsapp.net';
store.upsertContact(db, { jid: heavyJid, number: '62879', name: 'Kasar' });
store.setContactMode(db, heavyJid, 'auto');
store.setContactRegister(db, heavyJid, 'temen');
const beforeHeavy = sent.length;
const beforeHeavyDrafts = draftCount();
let heavyError = null;
try {
  await handler.handle(msg({ chatJid: heavyJid, text: 'halo' }));
} catch (err) {
  heavyError = err.message;
}
check('kasar: tidak crash', !heavyError, heavyError || '');
check('kasar: jadi draft', draftCount() === beforeHeavyDrafts + 1);
check('kasar: tidak terkirim', sent.length === beforeHeavy);
nextReply = { reply: 'sip', confidence: 0.95, reason: 'aman' };

// 10c. Retry AI dibatasi: maksimal 2 percobaan per pesan.
nextReply = { reply: 'asu', confidence: 0.95, reason: 'tes budget' };
const budgetJid = '62813@s.whatsapp.net';
store.upsertContact(db, { jid: budgetJid, number: '62813', name: 'Budget' });
store.setContactMode(db, budgetJid, 'auto');
store.setContactRegister(db, budgetJid, 'temen');
store.insertMessage(db, {
  id: 'budget_prev_out',
  jid: budgetJid,
  direction: 'out',
  body: 'asu',
  ts: Date.now() - 60_000,
  status: 'auto_sent',
});
const beforeBudget = aiCalls;
let budgetError = null;
try {
  await handler.handle(msg({ chatJid: budgetJid, text: 'halo' }));
} catch (err) {
  budgetError = err.message;
}
check(
  'AI: maksimal 2 percobaan per pesan',
  !budgetError && aiCalls - beforeBudget <= 2,
  `${aiCalls - beforeBudget} panggilan`,
);
nextReply = { reply: 'sip', confidence: 0.95, reason: 'aman' };

// 10d. Pesan LID dengan altJid PN -> pakai nama dari buku kontak.
const lidJid = '777777777777@lid';
const lidPn = '6281400000001:0@s.whatsapp.net';
store.upsertContact(db, { jid: lidJid, number: '777777777777', name: 'Orang' });
store.setContactMode(db, lidJid, 'draft');
store.setWaName(db, lidPn, 'Budi LID');
const beforeLidDrafts = draftCount();
await handler.handle(msg({ chatJid: lidJid, altJid: lidPn, text: 'halo lid' }));
const lidContact = store.getContact(db, lidJid);
check('LID: nama dari kontak HP dipakai', lidContact?.name === 'Budi LID');
check('LID: nomor diganti nomor telepon', lidContact?.number === '6281400000001');
check('LID: draft tetap dibuat', draftCount() === beforeLidDrafts + 1);

// 11. Belajar otomatis dari pesan yang sudah tersimpan
const { rebuildProfile } = await import('../src/ingest/rebuild.js');
const learnJid = '62877@s.whatsapp.net';
store.upsertContact(db, { jid: learnJid, number: '62877', name: 'Belajar' });

const tooFew = await rebuildProfile(db, learnJid);
check('rebuild: tolak kalau pesan kurang', tooFew.ok === false);

for (let i = 0; i < 12; i++) {
  store.insertMessage(db, {
    id: `learn_in_${i}`,
    jid: learnJid,
    direction: 'in',
    body: `halo ${i}`,
    ts: 1000 + i * 2,
  });
  store.insertMessage(db, {
    id: `learn_out_${i}`,
    jid: learnJid,
    direction: 'out',
    body: i % 2 ? 'sip' : 'otw wkwk',
    ts: 1001 + i * 2,
  });
}
const rebuilt = await rebuildProfile(db, learnJid, { withRelationship: false });
check('rebuild: profil dari pesan tersimpan', rebuilt.ok && rebuilt.samples === 12, JSON.stringify(rebuilt));
check('rebuild: gaya tersimpan', !!store.getContact(db, learnJid).style_profile);
check('rebuild: contoh pasangan dibuat', store.listExamples(db, learnJid, 50).length === 12);

// 12. Sinkronisasi buku kontak: nama di HP ("Mamah") menyambungkan import ke nomor asli
const { createContactSync } = await import('../src/wa/handler.js');
store.upsertContact(db, { jid: 'name:mamah', name: 'Mamah', importName: 'Mamah' });
store.saveProfile(db, 'name:mamah', { sampleCount: 193 });

const sync = createContactSync({ db, bus });
sync([{ id: '628123456789@s.whatsapp.net', name: 'Mamah', notify: 'Mama Chesta' }]);

const linkedContact = store.getContact(db, '628123456789@s.whatsapp.net');
check('sinkron kontak: import tersambung ke nomor', !!linkedContact, linkedContact?.name);
check('sinkron kontak: profil ikut pindah', linkedContact?.sample_count === 193);
check('sinkron kontak: placeholder lama hilang', !store.getContact(db, 'name:mamah'));

// 12a. Sinkron kontak LID yang membawa phoneNumber PN.
const lidSyncJid = '888888888888@lid';
const lidSyncPn = '6281400000002:0@s.whatsapp.net';
store.upsertContact(db, { jid: lidSyncJid, number: '888888888888', name: 'Orang' });
sync([{ id: lidSyncJid, phoneNumber: lidSyncPn, name: 'Teman LID Sync' }]);
const lidSync = store.getContact(db, lidSyncJid);
check(
  'sinkron LID: nama dari phoneNumber',
  lidSync?.name === 'Teman LID Sync' && lidSync?.number === '6281400000002',
);
check('sinkron LID: wa_contacts LID tersimpan', store.getWaName(db, lidSyncJid) === 'Teman LID Sync');

// 12b. Nama mirip tidak boleh auto-link ke kontak lain.
store.upsertContact(db, { jid: 'name:cahyo', name: 'Cahyo', importName: 'Cahyo' });
check('kontak: nama mirip tidak nyambung', store.findContactByImportName(db, 'Cahyono') === null);
check('kontak: nama persis tetap nyambung', store.findContactByImportName(db, 'Cahyo')?.jid === 'name:cahyo');

// 12c. Perbaikan kontak LID lama yang masih "Orang".
const repairLidJid = '999999999999@lid';
const repairPn = '6281400000003:0@s.whatsapp.net';
store.upsertContact(db, { jid: repairLidJid, number: '999999999999', name: 'Orang' });
store.setWaName(db, repairPn, 'Budi Repair');
const { repairLidContacts } = await import('../src/wa/contactRepair.js');
const repaired = await repairLidContacts({
  db,
  bus,
  wa: { resolvePn: async (jid) => (jid === repairLidJid ? repairPn : null) },
});
const repairedContact = store.getContact(db, repairLidJid);
check(
  'repair LID: nama dan nomor diperbaiki',
  repaired >= 1 &&
    repairedContact?.name === 'Budi Repair' &&
    repairedContact?.number === '6281400000003',
);

// Kontak LID yang sudah punya nama custom tidak boleh ditimpa.
const namedLidJid = '999999999998@lid';
const namedPn = '6281400000004:0@s.whatsapp.net';
store.upsertContact(db, { jid: namedLidJid, number: '999999999998', name: 'heizer' });
store.setWaName(db, namedPn, 'Hangga');
await repairLidContacts({
  db,
  bus,
  wa: { resolvePn: async (jid) => (jid === namedLidJid ? namedPn : null) },
});
const namedContact = store.getContact(db, namedLidJid);
check(
  'repair LID: nama custom tidak ditimpa',
  namedContact?.name === 'heizer' &&
    namedContact?.number === '6281400000004' &&
    store.getWaName(db, namedLidJid) === 'heizer',
);

// 13. Riwayat dari HP: disimpan, tidak dibalas, profil dibuat otomatis
const { createHistoryIngest } = await import('../src/wa/handler.js');
const histJid = '628998877@s.whatsapp.net';
const histWa = { normalize: (m) => m };
const ingestHistory = createHistoryIngest({ db, bus, wa: histWa });

const histMessages = [];
for (let i = 0; i < 10; i++) {
  histMessages.push({
    id: `h_in_${i}`,
    chatJid: histJid,
    isGroup: false,
    isStatus: false,
    isNewsletter: false,
    fromMe: false,
    pushName: 'Bude',
    text: `halo ${i}`,
    timestamp: 5000 + i * 2,
  });
  histMessages.push({
    id: `h_out_${i}`,
    chatJid: histJid,
    isGroup: false,
    isStatus: false,
    isNewsletter: false,
    fromMe: true,
    pushName: null,
    text: i % 2 ? 'otw' : 'sip wkwk',
    timestamp: 5001 + i * 2,
  });
}

const before13 = sent.length;
const res13 = await ingestHistory({
  messages: histMessages,
  contacts: [{ id: histJid, name: 'Bude' }],
  chats: [],
});
check('riwayat: semua pesan tersimpan', res13.stored === 20, `${res13.stored} pesan`);
check('riwayat: tidak memicu balasan', sent.length === before13);
check('riwayat: nama dari buku kontak dipakai', store.getContact(db, histJid)?.name === 'Bude');

await new Promise((r) => setTimeout(r, 400));
check('riwayat: profil dibuat otomatis', !!store.getContact(db, histJid)?.style_profile);

// 14. Grup di riwayat harus dilewati
const before14 = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n;
await ingestHistory({
  messages: [
    {
      id: 'grp_1',
      chatJid: '123@g.us',
      isGroup: true,
      isStatus: false,
      isNewsletter: false,
      fromMe: false,
      text: 'rapat jam 9',
      timestamp: 9000,
    },
  ],
});
check('riwayat: grup dilewati', db.prepare('SELECT COUNT(*) AS n FROM messages').get().n === before14);

/* --------------------------------- selesai -------------------------------- */

mock.close();
db.close?.();
fs.rmSync(DATA_DIR, { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} tes gagal` : `\n${results.length} tes lulus`);
process.exitCode = failed ? 1 : 0;

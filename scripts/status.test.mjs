import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { openDb, createStatusJob, getStatusJob, upsertContact } from '../src/db.js';
import { processStatusJobs, sendStatusJob, MAX_PER_DAY } from '../src/wa/statusWorker.js';
import { WhatsAppClient } from '../src/wa/client.js';

const dir = path.resolve('data-statustest');
fs.rmSync(dir, { recursive: true, force: true });
const db = openDb(dir);
const bus = new EventEmitter();

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const img = path.join(dir, 'x.png');
fs.writeFileSync(img, png);

const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

// 1. WA open + due -> terkirim
let sentCount = 0;
let sentRecipients = null;
const openWa = {
  snapshot: () => ({ status: 'open' }),
  resolveStatusRecipients: async (all) => all,
  sendStatus: async (buffer, caption, recipients) => {
    sentCount++;
    sentRecipients = recipients;
    return { key: { id: 'status_msg_1' } };
  },
};

upsertContact(db, { jid: '62811@s.whatsapp.net', number: '62811', name: 'Budi' });
const j1 = createStatusJob(db, {
  id: 'j1',
  imagePath: img,
  caption: 'tes',
  scheduledAt: Date.now() - 60_000,
});
await processStatusJobs({ db, wa: openWa, bus });
check('due + WA open → sent', getStatusJob(db, j1.id).status === 'sent' && sentCount === 1);
check('message key status disimpan', getStatusJob(db, j1.id).wa_message_id === 'status_msg_1');
check(
  'daftar penerima status disimpan',
  JSON.parse(getStatusJob(db, j1.id).wa_status_jids || '[]').includes('62811@s.whatsapp.net'),
);
check(
  'penerima dikirim eksplisit ke WhatsApp',
  Array.isArray(sentRecipients) && sentRecipients.includes('62811@s.whatsapp.net'),
);

const wc = new WhatsAppClient({ dataDir: dir });
wc.state.status = 'open';
let revokePayload = null;
wc.sock = {
  sendMessage: async (jid, content, opts) => {
    revokePayload = { jid, content, opts };
    return { key: { id: 'revoke' } };
  },
};
await wc.revokeStatus('status_msg_1', ['62811@s.whatsapp.net']);
check(
  'revoke status memakai protocol delete',
  revokePayload?.jid === 'status@broadcast' &&
    revokePayload.content.delete?.id === 'status_msg_1' &&
    revokePayload.opts.statusJidList?.includes('62811@s.whatsapp.net'),
);

// Privasi status: allow list, deny list, contacts, close friends, LID mapping.
const allStatusContacts = ['62811@s.whatsapp.net', '62822@s.whatsapp.net'];
wc.privacyWaitMs = 50;
wc.sock.fetchPrivacySettings = async () => ({ status: 'contacts' });
wc.statusPrivacy = { mode: 2, userJid: [] };
assert.deepEqual(await wc.resolveStatusRecipients(allStatusContacts), allStatusContacts);

wc.statusPrivacy = { mode: 1, userJid: ['62811@s.whatsapp.net'] };
assert.deepEqual(await wc.resolveStatusRecipients(allStatusContacts), ['62822@s.whatsapp.net']);

wc.statusPrivacy = { mode: 0, userJid: ['62811@s.whatsapp.net'] };
assert.deepEqual(await wc.resolveStatusRecipients(allStatusContacts), ['62811@s.whatsapp.net']);

wc.statusPrivacy = { mode: 3, userJid: ['62822@s.whatsapp.net'] };
assert.deepEqual(await wc.resolveStatusRecipients(allStatusContacts), ['62822@s.whatsapp.net']);

wc.statusPrivacy = { mode: 1, userJid: ['123@lid'] };
wc.sock.signalRepository = {
  lidMapping: { getPNForLID: async () => '62811@s.whatsapp.net' },
};
assert.deepEqual(await wc.resolveStatusRecipients(allStatusContacts), ['62822@s.whatsapp.net']);

// Mode 1 tanpa daftar pengecualian = belum tersinkron -> fail closed.
wc.statusPrivacy = { mode: 1 };
await assert.rejects(() => wc.resolveStatusRecipients(allStatusContacts), /pengecualian|sinkron/i);

// Array kosong eksplisit = tidak ada pengecualian.
wc.statusPrivacy = { mode: 1, userJid: [] };
assert.deepEqual(await wc.resolveStatusRecipients(allStatusContacts), allStatusContacts);

// Mode 2 tanpa kategori "contacts/all" harus fail closed.
wc.statusPrivacy = { mode: 2, userJid: [] };
wc.sock.fetchPrivacySettings = async () => ({ status: 'contact_blacklist' });
wc.sock.resyncAppState = async () => {};
await assert.rejects(() => wc.resolveStatusRecipients(allStatusContacts), /privasi|sinkron/i);

wc.statusPrivacy = null;
wc.sock.fetchPrivacySettings = async () => ({ status: 'contacts' });
assert.deepEqual(await wc.resolveStatusRecipients(allStatusContacts), allStatusContacts);

wc.statusPrivacy = null;
wc.sock.fetchPrivacySettings = async () => ({ status: 'none' });
await assert.rejects(() => wc.resolveStatusRecipients(allStatusContacts), /none|privasi/i);

// 1b. Dua pemanggilan untuk job yang sama -> hanya satu yang mengirim.
const jClaim = createStatusJob(db, {
  id: 'jclaim',
  imagePath: img,
  caption: 'klaim',
  scheduledAt: Date.now() - 60_000,
});
let claimSends = 0;
const slowWa = {
  snapshot: () => ({ status: 'open' }),
  resolveStatusRecipients: async (all) => all,
  sendStatus: async () => {
    claimSends++;
    await new Promise((r) => setTimeout(r, 50));
    return { key: { id: 'claim_msg' } };
  },
};
const [claimA, claimB] = await Promise.all([
  sendStatusJob({ db, wa: slowWa, bus }, getStatusJob(db, jClaim.id)),
  sendStatusJob({ db, wa: slowWa, bus }, getStatusJob(db, jClaim.id)),
]);
check(
  'status: klaim atomik, tidak dobel',
  claimSends === 1 &&
    [claimA, claimB].filter(Boolean).length === 1 &&
    getStatusJob(db, jClaim.id).status === 'sent',
  `${claimSends} kirim`,
);

// 1c. Error sementara (privasi belum sync) -> tetap pending, bukan failed.
const jTransient = createStatusJob(db, {
  id: 'jtransient',
  imagePath: img,
  caption: 'sementara',
  scheduledAt: Date.now() + 60_000,
});
const privacyWa = {
  snapshot: () => ({ status: 'open' }),
  resolveStatusRecipients: async () => {
    throw new Error('Privasi Status WhatsApp belum tersinkron.');
  },
  sendStatus: async () => {
    throw new Error('tidak boleh mengirim');
  },
};
const transientOk = await sendStatusJob({ db, wa: privacyWa, bus }, getStatusJob(db, jTransient.id));
check(
  'status sementara tetap pending',
  transientOk === false &&
    getStatusJob(db, jTransient.id).status === 'pending' &&
    getStatusJob(db, jTransient.id).attempts === 1,
);

// 2. WA mati -> tetap pending
const j2 = createStatusJob(db, {
  id: 'j2',
  imagePath: img,
  caption: 'tes2',
  scheduledAt: Date.now() - 60_000,
});
const closedWa = { snapshot: () => ({ status: 'closed' }), sendStatus: async () => {} };
await processStatusJobs({ db, wa: closedWa, bus });
check('WA mati → tetap pending', getStatusJob(db, j2.id).status === 'pending');

// 3. lewat 24 jam -> skipped
const j3 = createStatusJob(db, {
  id: 'j3',
  imagePath: img,
  caption: 'tes3',
  scheduledAt: Date.now() - 25 * 60 * 60 * 1000,
});
await sendStatusJob({ db, wa: openWa, bus }, getStatusJob(db, j3.id));
check('lewat 24 jam → skipped', getStatusJob(db, j3.id).status === 'skipped');

// 4. kuota harian berhenti setelah MAX_PER_DAY
let sent4 = 0;
const countingWa = {
  snapshot: () => ({ status: 'open' }),
  resolveStatusRecipients: async (all) => all,
  sendStatus: async () => {
    sent4++;
  },
};
for (let i = 0; i < MAX_PER_DAY + 2; i++) {
  createStatusJob(db, {
    id: `bulk${i}`,
    imagePath: img,
    caption: 'bulk',
    scheduledAt: Date.now() - 60_000,
  });
}
await processStatusJobs({ db, wa: countingWa, bus });
const totalSent = db.prepare("SELECT COUNT(*) n FROM status_jobs WHERE status='sent'").get().n;
check('kuota harian dihormati', totalSent <= MAX_PER_DAY, `${totalSent} terkirim (maks ${MAX_PER_DAY})`);

// 5. Post manual tetap tunduk pada kuota harian.
const jManual = createStatusJob(db, {
  id: 'jmanual',
  imagePath: img,
  caption: 'manual',
  scheduledAt: Date.now() - 60_000,
});
const beforeManual = sent4;
const manualOk = await sendStatusJob({ db, wa: countingWa, bus }, getStatusJob(db, jManual.id));
check(
  'kuota manual ditolak',
  manualOk === false && sent4 === beforeManual && getStatusJob(db, jManual.id).status === 'pending',
  `${sent4} terkirim`,
);

db.close?.();
fs.rmSync(dir, { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} tes gagal` : `\n${results.length} tes lulus`);
process.exitCode = failed ? 1 : 0;

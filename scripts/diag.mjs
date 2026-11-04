/**
 * Diagnosa cepat: kenapa auto tidak jalan?
 * Jalankan: npm run diag
 */
import { openDb } from '../src/db.js';
import { config } from '../src/config.js';
import { decide, inQuietHours, dayStart, hourStart } from '../src/policy.js';
import * as store from '../src/db.js';

const db = openDb(config.dataDir);

const real = db.prepare("SELECT * FROM contacts WHERE jid NOT LIKE 'name:%'").all();
const placeholders = db.prepare("SELECT * FROM contacts WHERE jid LIKE 'name:%'").all();

console.log('\n  === KONTAK ===');
console.log(`  Tersambung ke nomor : ${real.length}`);
for (const c of real) console.log(`   - ${c.name} (${c.jid}) mode=${c.mode}`);
console.log(`  Hasil import (belum ada nomor) : ${placeholders.length}`);
for (const c of placeholders.slice(0, 12)) console.log(`   - ${c.name} mode=${c.mode}`);

console.log('\n  === PESAN TERAKHIR ===');
const msgs = db
  .prepare('SELECT * FROM messages ORDER BY ts DESC LIMIT 15')
  .all();
if (!msgs.length) console.log('  (belum ada pesan sama sekali)');
for (const m of msgs) {
  const t = new Date(m.ts).toLocaleString('id-ID');
  console.log(
    `  ${t} | ${m.jid} | ${m.direction} | ${m.status || '-'} | ${m.reason || '-'} | ${String(
      m.body,
    ).slice(0, 45).replace(/\n/g, ' ')}`,
  );
}

console.log('\n  === KONDISI SAAT INI ===');
console.log(`  Jam tenang  : ${config.safety.quietHours}${inQuietHours(new Date()) ? '  ← SEDANG AKTIF, auto diblokir' : ''}`);
console.log(`  Jeda/kontak : ${config.safety.minGapPerContactSec}s`);
console.log(`  Batas hari  : ${store.countOutSince(db, dayStart())}/${config.safety.maxPerDay}`);
console.log(`  Batas jam   : ${store.countOutSince(db, hourStart())}/${config.safety.maxPerHour}`);
console.log('');

// Simulasikan keputusan untuk tiap kontak nyata.
for (const c of real) {
  const last = db
    .prepare("SELECT ts FROM messages WHERE jid = ? AND direction = 'out' ORDER BY ts DESC LIMIT 1")
    .get(c.jid);
  const d = decide({
    jid: c.jid,
    contact: c,
    paused: store.kvGet(db, 'paused') === '1',
    counts: {
      day: store.countOutSince(db, dayStart()),
      hour: store.countOutSince(db, hourStart()),
      contactToday: store.countOutSince(db, dayStart(), c.jid),
      lastContactSentAt: last?.ts ?? 0,
    },
  });
  console.log(`  ${c.name.padEnd(20)} → ${d.action.toUpperCase()} (${d.reason})`);
}
console.log('');

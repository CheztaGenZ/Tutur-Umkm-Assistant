/**
 * Tebak tingkat tutur (kasar/sopan) untuk semua kontak dari contoh chat
 * yang sudah tersimpan. Tidak memanggil AI.
 *
 * Jalankan: npm run detect-register
 */
import { openDb, listContacts, setContactRegister } from '../src/db.js';
import { detectRegister } from '../src/ingest/style.js';
import { config } from '../src/config.js';

const db = openDb(config.dataDir);
const contacts = listContacts(db, '');

let changed = 0;
for (const c of contacts) {
  const rows = db.prepare('SELECT mine FROM examples WHERE jid = ? LIMIT 400').all(c.jid);
  if (!rows.length) continue;
  const guess = detectRegister(rows.map((r) => r.mine));
  if (guess !== c.register) {
    setContactRegister(db, c.jid, guess);
    console.log(`  ${c.name.padEnd(22)} ${c.register} → ${guess}`);
    changed++;
  }
}
console.log(`\n  ${changed} kontak diperbarui dari ${contacts.length} kontak.\n`);

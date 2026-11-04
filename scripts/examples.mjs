/**
 * Lihat contoh chat tersimpan untuk satu kontak.
 * Jalankan: npm run examples -- "agda" [jumlah]
 */
import { openDb, listContacts } from '../src/db.js';
import { config } from '../src/config.js';

const q = process.argv[2];
const limit = Number(process.argv[3]) || 40;

if (!q) {
  console.log('\n  Pakai: npm run examples -- "nama kontak" [jumlah]\n');
  process.exit(1);
}

const db = openDb(config.dataDir);
const contact = listContacts(db, q)[0];
if (!contact) {
  console.log(`\n  Kontak "${q}" tidak ditemukan.\n`);
  process.exit(1);
}

const rows = db
  .prepare('SELECT their, mine, ts FROM examples WHERE jid = ? ORDER BY ts DESC LIMIT ?')
  .all(contact.jid, limit);

console.log(`\n  ${contact.name} (${contact.register}) — ${rows.length} contoh terakhir\n`);
for (const r of rows) {
  console.log(`  dia : ${r.their.replace(/\n/g, ' ').slice(0, 90)}`);
  console.log(`  aku : ${r.mine.replace(/\n/g, ' ').slice(0, 90)}`);
  console.log('');
}

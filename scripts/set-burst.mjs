/**
 * Atur jumlah maksimal bubble per balasan untuk satu kontak.
 * Jalankan: npm run set-burst -- "dy" 6
 */
import { openDb, listContacts, setContactBurst } from '../src/db.js';
import { config } from '../src/config.js';

const [query, n] = process.argv.slice(2);

if (!query || !n) {
  console.log('\n  Pakai: npm run set-burst -- "nama kontak" 1-8\n');
  process.exit(1);
}

const db = openDb(config.dataDir);
const contact = listContacts(db, query)[0];
if (!contact) {
  console.log(`\n  Kontak "${query}" tidak ditemukan.\n`);
  process.exit(1);
}

const updated = setContactBurst(db, contact.jid, n);
console.log(`\n  ${updated.name} → maksimal ${updated.burst} bubble per balasan\n`);

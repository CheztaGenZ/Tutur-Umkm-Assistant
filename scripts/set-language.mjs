/**
 * Kunci bahasa untuk satu kontak.
 * Jalankan: npm run set-language -- "roaaaa" id
 *           npm run set-language -- "agda" jv
 *           npm run set-language -- "mamah" auto
 */
import { openDb, listContacts, setContactLanguage } from '../src/db.js';
import { config } from '../src/config.js';

const [query, lang] = process.argv.slice(2);

if (!query || !['id', 'jv', 'auto'].includes(lang)) {
  console.log('\n  Pakai: npm run set-language -- "nama kontak" id|jv|auto\n');
  process.exit(1);
}

const db = openDb(config.dataDir);
const contact = listContacts(db, query)[0];
if (!contact) {
  console.log(`\n  Kontak "${query}" tidak ditemukan.\n`);
  process.exit(1);
}

setContactLanguage(db, contact.jid, lang);
console.log(`\n  ${contact.name} → bahasa: ${lang.toUpperCase()}\n`);

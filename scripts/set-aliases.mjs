/**
 * Set nama panggilan (alias) per kontak.
 * Jalankan: npm run set-alias
 */
import { openDb, listContacts, setContactAlias } from '../src/db.js';
import { config } from '../src/config.js';

const MAP = {
  agda: 'Ida',
  'rajah rezah': 'Eko',
  erpan: 'Tony',
  'nonot anget': 'Nonot',
};

const db = openDb(config.dataDir);
let changed = 0;

for (const [key, alias] of Object.entries(MAP)) {
  const contact = listContacts(db, key)[0];
  if (!contact) {
    console.log(`  ? ${key}: tidak ditemukan`);
    continue;
  }
  setContactAlias(db, contact.jid, alias);
  console.log(`  ${contact.name.padEnd(20)} → ${alias}`);
  changed++;
}

console.log(`\n  ${changed} alias disimpan.\n`);

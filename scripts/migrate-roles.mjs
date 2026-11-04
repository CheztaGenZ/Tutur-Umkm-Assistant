/**
 * Migrasi tingkat kesopanan lama ke sistem 5 level.
 * Jalankan sekali: npm run migrate-roles
 */
import { openDb, listContacts, setContactRegister } from '../src/db.js';
import { config } from '../src/config.js';

const db = openDb(config.dataDir);
let n = 0;

for (const c of listContacts(db, '')) {
  let target = c.register;

  if (c.register === 'kasar') target = 'temen_dekat';
  else if (c.register === 'sopan' || c.register === 'auto') target = 'temen';

  // Nama generik "Orang" = tidak dikenal -> wajib sopan.
  if (c.name === 'Orang' && target === 'temen') target = 'wajib_sopan';

  if (target !== c.register) {
    setContactRegister(db, c.jid, target);
    console.log(`  ${String(c.name).padEnd(24)} ${c.register} → ${target}`);
    n++;
  }
}

console.log(`\n  ${n} kontak dimigrasi.\n`);

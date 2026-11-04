/**
 * Perbaiki nama kontak yang terlanjur memakai nama profil ("Chesta Adabi...").
 * Prioritas: nama dari buku kontak WhatsApp -> selain itu "Orang".
 *
 * Jalankan: npm run fix-names
 */
import { openDb, listContacts, setWaName } from '../src/db.js';
import { config } from '../src/config.js';
import { isFamilyName } from '../src/db.js';

const db = openDb(config.dataDir);

const rows = db.prepare("SELECT * FROM contacts WHERE name LIKE '%Chesta%' OR name LIKE '%Adabi%'").all();

for (const c of rows) {
  const bookName = db.prepare('SELECT name FROM wa_contacts WHERE jid = ?').get(c.jid)?.name;
  const name = bookName || 'Orang';
  db.prepare('UPDATE contacts SET name = ?, updated_at = ? WHERE jid = ?').run(name, Date.now(), c.jid);
  console.log(`  ${c.jid.padEnd(34)} → ${name}`);
}

// Deteksi ulang keluarga berdasarkan nama baru.
let fam = 0;
for (const c of listContacts(db, '')) {
  if (isFamilyName(c.name) && c.register !== 'keluarga') {
    db.prepare("UPDATE contacts SET register = 'keluarga' WHERE jid = ?").run(c.jid);
    console.log(`  keluarga: ${c.name}`);
    fam++;
  }
}

console.log(`\n  ${rows.length} nama diperbaiki, ${fam} kontak keluarga ditandai.\n`);

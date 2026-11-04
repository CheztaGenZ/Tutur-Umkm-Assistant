/**
 * Gabungkan kontak WhatsApp asli dengan profil hasil import.
 *
 * Jalankan: npm run link -- "dy" "roaaaa"
 *   arg1 = kontak yang punya nomor (hasil chat)
 *   arg2 = profil hasil import (placeholder "name:...")
 */
import { openDb, listContacts, getContact } from '../src/db.js';
import { config } from '../src/config.js';

const [realQuery, importQuery] = process.argv.slice(2);

if (!realQuery || !importQuery) {
  console.log('\n  Pakai: npm run link -- "nama kontak live" "nama hasil import"\n');
  process.exit(1);
}

const db = openDb(config.dataDir);

const real = listContacts(db, realQuery).find((c) => !c.jid.startsWith('name:'));
const imported = listContacts(db, importQuery).find((c) => c.jid.startsWith('name:'));

if (!real) {
  console.log(`\n  Kontak live "${realQuery}" tidak ditemukan.\n`);
  process.exit(1);
}
if (!imported) {
  console.log(`\n  Profil import "${importQuery}" tidak ditemukan.\n`);
  process.exit(1);
}
if (real.jid === imported.jid) {
  console.log('\n  Keduanya kontak yang sama.\n');
  process.exit(0);
}

db.exec('BEGIN');
try {
  // Pindahkan contoh chat, lalu hapus contoh lama milik kontak live.
  db.prepare('DELETE FROM examples WHERE jid = ?').run(real.jid);
  db.prepare('UPDATE examples SET jid = ? WHERE jid = ?').run(real.jid, imported.jid);

  // Ambil alih profil, bahasa, tingkat tutur, alias.
  db.prepare(
    `UPDATE contacts SET
       style_profile = COALESCE(?, style_profile),
       relationship  = COALESCE(?, relationship),
       sample_count  = MAX(sample_count, ?),
       language      = CASE WHEN language = 'auto' THEN ? ELSE language END,
       register      = CASE WHEN register = 'auto' THEN ? ELSE register END,
       alias         = COALESCE(alias, ?),
       import_name   = COALESCE(import_name, ?),
       updated_at    = ?
     WHERE jid = ?`,
  ).run(
    imported.style_profile,
    imported.relationship,
    imported.sample_count,
    imported.language,
    imported.register,
    imported.alias,
    imported.import_name,
    Date.now(),
    real.jid,
  );

  db.prepare('DELETE FROM contacts WHERE jid = ?').run(imported.jid);
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  throw err;
}

const merged = getContact(db, real.jid);
console.log(`\n  "${imported.name}" digabung ke "${merged.name}" (${merged.jid})`);
console.log(`  Bahasa: ${merged.language} · Tingkat: ${merged.register} · Sampel: ${merged.sample_count}\n`);

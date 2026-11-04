/**
 * Bersihkan data hasil import (kontak placeholder `name:...`).
 * Dipakai kalau format export salah terbaca dan profilnya perlu diimpor ulang.
 *
 * Jalankan:
 *   npm run reset-import            # hapus kontak hasil import saja
 *   npm run reset-import -- --all   # hapus SEMUA kontak + chat + draft
 */
import { openDb } from '../src/db.js';
import { config } from '../src/config.js';

const all = process.argv.includes('--all');
const db = openDb(config.dataDir);

const where = all ? '1 = 1' : "jid LIKE 'name:%'";
const count = db.prepare(`SELECT COUNT(*) AS c FROM contacts WHERE ${where}`).get().c;

if (!count) {
  console.log('\n  Tidak ada data yang perlu dihapus.\n');
  process.exit(0);
}

db.prepare(`DELETE FROM examples WHERE ${where}`).run();
db.prepare(`DELETE FROM drafts WHERE ${where}`).run();
db.prepare(`DELETE FROM messages WHERE ${where}`).run();
db.prepare(`DELETE FROM contacts WHERE ${where}`).run();
db.prepare("DELETE FROM kv WHERE key = 'global_style'").run();

console.log(`\n  ${count} kontak dihapus beserta contoh chat dan draftnya.`);
console.log(`  Sisa kontak sekarang: ${db.prepare('SELECT COUNT(*) AS c FROM contacts').get().c}`);
console.log('  Silakan import ulang dari dashboard.\n');

/**
 * Ringkasan isi database: berapa pesan, kontak, profil.
 * Jalankan: npm run stats
 */
import { openDb } from '../src/db.js';
import { config } from '../src/config.js';

const db = openDb(config.dataDir);

const n = (sql, ...args) => db.prepare(sql).get(...args).n;

console.log('');
console.log(`  Pesan tersimpan   : ${n('SELECT COUNT(*) n FROM messages')}`);
console.log(`    dari riwayat    : ${n("SELECT COUNT(*) n FROM messages WHERE status='history'")}`);
console.log(`    masuk (live)    : ${n("SELECT COUNT(*) n FROM messages WHERE status='received'")}`);
console.log(`    keluar          : ${n("SELECT COUNT(*) n FROM messages WHERE direction='out'")}`);
console.log(`  Kontak            : ${n('SELECT COUNT(*) n FROM contacts')}`);
console.log(`    punya profil    : ${n('SELECT COUNT(*) n FROM contacts WHERE style_profile IS NOT NULL')}`);
console.log(`    profil import   : ${n("SELECT COUNT(*) n FROM contacts WHERE style_profile IS NOT NULL AND sample_count > 0")}`);
console.log(`  Contoh pasangan   : ${n('SELECT COUNT(*) n FROM examples')}`);
console.log(`  Sampel dari grup  : ${n('SELECT COUNT(*) n FROM group_samples')}`);
console.log(`  Draft menunggu    : ${n("SELECT COUNT(*) n FROM drafts WHERE status='pending'")}`);
console.log('');

const top = db
  .prepare(
    `SELECT c.name, c.mode, c.sample_count,
            (SELECT COUNT(*) FROM messages m WHERE m.jid = c.jid) AS msgs
     FROM contacts c ORDER BY msgs DESC LIMIT 10`,
  )
  .all();

if (top.length) {
  console.log('  Kontak teratas:');
  for (const t of top) {
    console.log(
      `   ${String(t.name).padEnd(22).slice(0, 22)} ${String(t.mode).padEnd(6)} ${String(t.msgs).padStart(7)} pesan  ${String(t.sample_count).padStart(6)} sampel`,
    );
  }
  console.log('');
}

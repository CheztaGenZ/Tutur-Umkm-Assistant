/**
 * Bangun ulang profil gaya untuk SEMUA kontak dari tabel examples
 * (hasil import maupun chat live). Tidak memanggil AI.
 *
 * Jalankan: npm run rebuild-all
 */
import { openDb, listContacts, saveProfile, setContactRegister } from '../src/db.js';
import { config } from '../src/config.js';
import { analyzeStyle, detectRegister } from '../src/ingest/style.js';
import { cleanMessage } from '../src/ingest/parseExport.js';
import { groupSampleCount, rebuildGroupStyle } from '../src/ingest/groupStyle.js';

const db = openDb(config.dataDir);

const groupStyle = rebuildGroupStyle(db);
const phraseNote = (groupStyle?.notes || []).find((n) => n.includes('Frasa'));
console.log(`\n  Gaya grup: ${groupSampleCount(db)} sampel`);
console.log(`  ${phraseNote || '(frasa belum terdeteksi)'}\n`);

for (const c of listContacts(db, '')) {
  const rows = db.prepare('SELECT mine FROM examples WHERE jid = ?').all(c.jid);
  const mine = rows.map((r) => cleanMessage(r.mine)).filter(Boolean);

  if (mine.length < 5) {
    console.log(`  ${String(c.name).padEnd(22)} dilewati (contoh cuma ${mine.length})`);
    continue;
  }

  const style = analyzeStyle(mine);
  saveProfile(db, c.jid, { styleProfile: style, sampleCount: mine.length });

  const register = detectRegister(mine);
  if (c.register === 'auto') setContactRegister(db, c.jid, register);

  console.log(`  ${String(c.name).padEnd(22)} ${mine.length} contoh · ${register}`);
}

console.log('\n  Selesai.\n');

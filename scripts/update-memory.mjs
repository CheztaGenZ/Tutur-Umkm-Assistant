/**
 * Bangun memori jangka panjang untuk semua kontak yang punya cukup obrolan.
 * Jalankan: npm run update-memory
 */
import { openDb, listContacts } from '../src/db.js';
import { config } from '../src/config.js';
import { updateMemory } from '../src/ai/memory.js';

const db = openDb(config.dataDir);

for (const c of listContacts(db, '')) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE jid = ?').get(c.jid).n;
  if (count < 40) {
    console.log(`  ${String(c.name).padEnd(22)} dilewati (${count} pesan)`);
    continue;
  }
  try {
    const mem = await updateMemory(db, c.jid);
    console.log(
      `  ${String(c.name).padEnd(22)} ${mem ? `memori ${mem.length} karakter` : 'gagal'}`,
    );
  } catch (err) {
    console.log(`  ${String(c.name).padEnd(22)} error: ${err.message}`);
  }
}

console.log('');

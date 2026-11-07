/**
 * Menyemai riwayat chat hasil import ke tabel messages.
 * Tujuannya supaya bot punya konteks percakapan SEBELUM dia dihidupkan.
 * Hanya ekor percakapan yang disimpan (default 200 pesan) agar tidak membengkak.
 */
import crypto from 'node:crypto';

export function seedHistory(db, jid, messages, meName, limit = 200, ownerId = 'demo') {
  if (!messages?.length) return 0;

  const owner = String(ownerId);
  const tail = messages.slice(-limit);
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO messages (id, owner_id, jid, direction, body, ts, status, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );

  let inserted = 0;
  for (const m of tail) {
    if (!m.text) continue;
    const id = `imp_${crypto
      .createHash('md5')
      .update(`${owner}|${jid}|${m.ts}|${m.text}`)
      .digest('hex')
      .slice(0, 16)}`;
    const res = stmt.run(
      id,
      owner,
      jid,
      m.author === meName ? 'out' : 'in',
      m.text,
      m.ts,
      'history',
      'import',
    );
    inserted += res.changes || 0;
  }

  return inserted;
}

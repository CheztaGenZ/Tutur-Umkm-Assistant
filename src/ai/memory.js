/**
 * Memori jangka panjang per kontak.
 *
 * 50 pesan terakhir dikirim apa adanya ke model. Supaya obrolan lama tidak
 * hilang, ringkasan disimpan di kolom contacts.memory dan ikut dikirim.
 */
import { chatJson } from './client.js';
import { config } from '../config.js';
import * as store from '../db.js';

const WINDOW = 160; // pesan yang diringkas
const MIN_MESSAGES = 40;

export async function updateMemory(db, jid) {
  const contact = store.getContact(db, jid);
  if (!contact) return null;

  const rows = db
    .prepare('SELECT direction, body, ts FROM messages WHERE jid = ? ORDER BY ts DESC LIMIT ?')
    .all(jid, WINDOW)
    .reverse();

  if (rows.length < MIN_MESSAGES) return null;

  const transcript = rows
    .map((r) => `${r.direction === 'out' ? config.me : contact.name || 'dia'}: ${r.body}`)
    .join('\n');

  const out = await chatJson(
    [
      {
        role: 'system',
        content: `Kamu merangkum obrolan WhatsApp untuk dijadikan memori jangka panjang.
Tulis 3-5 kalimat padat dalam bahasa Indonesia yang mencakup:
- topik yang sedang dibahas
- rencana/janji yang belum selesai
- hal penting tentang orangnya (kebiasaan, suasana hati, kejadian)
- topik yang pernah dibahas (JANGAN simpan joke/lelucon untuk dipakai ulang)
Jangan mengarang. Jangan menyebut nama lengkap atau alamat. Abaikan basa-basi.
Balas JSON: {"memory": "..."}`,
      },
      {
        role: 'user',
        content: `Ringkasan sebelumnya:\n${contact.memory || '(belum ada)'}\n\nObrolan terbaru:\n${transcript}`,
      },
    ],
    { temperature: 0.3, kind: 'memory' },
  );

  const memory = typeof out.memory === 'string' ? out.memory.trim().slice(0, 1200) : null;
  if (!memory) return null;

  db.prepare('UPDATE contacts SET memory = ?, updated_at = ? WHERE jid = ?').run(
    memory,
    Date.now(),
    jid,
  );
  return memory;
}

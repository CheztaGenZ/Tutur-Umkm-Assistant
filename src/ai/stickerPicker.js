/**
 * Memilih stiker yang paling cocok dengan konteks obrolan.
 * Dipanggil terpisah setelah balasan teks jadi, supaya pilihan stiker fokus.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatJson } from './client.js';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = path.join(__dirname, '..', '..', 'stickers', 'catalog.json');

export function stickerCatalog() {
  try {
    const raw = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
    return Object.entries(raw)
      .filter(([, v]) => v?.desc)
      .map(([file, v]) => ({ file, desc: v.desc }));
  } catch {
    return [];
  }
}

export async function chooseSticker({ messages = [], reply = '', contactName = 'dia', meName = 'aku' }) {
  const list = stickerCatalog();
  if (!list.length) return null;

  const transcript = messages
    .slice(-8)
    .map((m) => `${m.direction === 'out' ? meName : contactName}: ${m.body}`)
    .join('\n');

  const out = await chatJson(
    [
      {
        role: 'system',
        content: `Kamu memilih stiker WhatsApp yang paling pas untuk membalas obrolan.
Aturan:
- Pilih PALING BANYAK SATU stiker, hanya kalau benar-benar nyambung dengan nada/konteks.
- Kalau tidak ada yang pas, pilih null. Lebih baik null daripada salah.
- Jangan pilih stiker yang menyinggung fisik, agama, atau keluarga.
Balas JSON: {"sticker": "nama file" atau null, "alasan": "singkat"}`,
      },
      {
        role: 'user',
        content: `Obrolan terakhir:\n${transcript}\n\nBalasan teks ${meName} yang baru dibuat: "${reply}"\n\nDaftar stiker:\n${list
          .map((s) => `- ${s.file} — ${s.desc}`)
          .join('\n')}`,
      },
    ],
    { temperature: 0.4, kind: 'sticker' },
  );

  const file = typeof out.sticker === 'string' ? path.basename(out.sticker.trim()) : null;
  if (!file) return null;

  return list.some((s) => s.file === file) ? { file, reason: String(out.alasan || '').slice(0, 120) } : null;
}

/**
 * Menambang kosakata baru dari chat yang tersimpan.
 * Hasilnya disimpan di data/slang-extra.json dan dipakai prompt sebagai
 * "kosakata khas" (bukan untuk mengubah balasan).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLANG } from './slang.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', '..', 'data', 'slang-extra.json');

const STOP = new Set(
  `yang dan di ke dari untuk pada dengan ini itu aku kamu saya gue lo lu kita kami mereka dia ada tidak ga gak nggak enggak ya yah kah lah pun juga sudah udah belum blm akan mau bisa harus apa apakah siapa kapan dimana mana bagaimana gimana kenapa mengapa berapa banget bgt kalau kalo jadi jd tapi tp atau ato karena krn soalnya karna sama utk dgn dg yg tuh nih sih dong deh aja aje doang cuma cmn lagi lg sekali sangat amat paling lebih kurang banyak sedikit the and you are is to of it in for on that this i a`.split(
    /\s+/,
  ),
);

export function expandSlang(db, limit = 200) {
  const rows = db
    .prepare(
      "SELECT body FROM messages WHERE direction = 'out' UNION ALL SELECT body FROM group_samples",
    )
    .all();

  const counts = new Map();
  for (const r of rows) {
    const words = String(r.body || '')
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    for (const w of words) {
      if (w.length < 3 || /^\d+$/.test(w)) continue;
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }

  const existing = new Set(Object.keys(SLANG));
  const list = [...counts.entries()]
    .filter(([w, c]) => c >= 3 && !existing.has(w) && !STOP.has(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  const out = Object.fromEntries(list.map(([w, c]) => [w, { count: c }]));
  fs.writeFileSync(DATA, JSON.stringify(out, null, 2));

  return {
    total: list.length,
    sample: list.slice(0, 25).map(([w, c]) => `${w} (${c}x)`),
  };
}

export function loadSlangExtra() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    return Object.keys(raw);
  } catch {
    return [];
  }
}

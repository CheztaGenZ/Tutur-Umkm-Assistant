/**
 * Knowledge base bisnis: retrieval ringan tanpa dependency.
 * Skor sederhana dan dapat dijelaskan: judul > keywords > body.
 */

const STOPWORDS = new Set([
  'yang', 'dan', 'atau', 'untuk', 'dengan', 'dari', 'pada', 'adalah', 'apa', 'apakah',
  'berapa', 'bagaimana', 'dimana', 'kapan', 'siapa', 'bisa', 'ada', 'tidak', 'iya',
  'the', 'and', 'or', 'for', 'with', 'from', 'what', 'how', 'when', 'where', 'who',
  'are', 'is', 'do', 'does', 'can', 'you', 'your', 'have', 'has', 'there', 'this',
]);

const SYNONYMS = {
  plant: ['vegan'],
  plantbased: ['vegan'],
  meatless: ['vegan'],
  vegetarian: ['vegan'],
  price: ['harga'],
  cost: ['harga'],
  open: ['buka'],
  opens: ['buka'],
  close: ['tutup'],
  closes: ['tutup'],
  hours: ['jam'],
  time: ['jam'],
  parking: ['parkir'],
  address: ['alamat', 'lokasi'],
  location: ['lokasi'],
  book: ['reservasi', 'booking'],
  booking: ['reservasi'],
  drink: ['minuman'],
  drinks: ['minuman'],
  food: ['menu', 'makanan'],
};

export function tokenize(text) {
  const normalized = String(text || '').replace(
    /without meat|no meat|meatless|plant[\s-]?based/gi,
    'vegan',
  );
  const base = normalized
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  const out = new Set(base);
  for (const token of base) {
    for (const extra of SYNONYMS[token] || []) out.add(extra);
  }
  return [...out];
}

/** @returns {Array} knowledge rows yang relevan, urut skor menurun. */
export function searchKnowledge(rows = [], query = '', limit = 3) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  const scored = [];
  for (const row of rows) {
    if (Number(row.active) !== 1) continue;
    const title = String(row.title || '').toLowerCase();
    const keywords = String(row.keywords || '').toLowerCase();
    const body = String(row.body || '').toLowerCase();
    const category = String(row.category || '').toLowerCase();

    let score = 0;
    for (const token of tokens) {
      if (title.includes(token)) score += 3;
      if (keywords.includes(token)) score += 2;
      if (body.includes(token)) score += 1;
      if (category.includes(token)) score += 1;
    }
    if (score > 0) scored.push({ row, score });
  }

  scored.sort((a, b) => b.score - a.score || String(a.row.title).localeCompare(String(b.row.title)));
  return scored.slice(0, Math.max(1, limit)).map((s) => s.row);
}

/** Blok prompt yang menjadi satu-satunya sumber fakta bisnis. */
export function formatKnowledgeBlock(rows = []) {
  if (!rows.length) return '';
  return rows
    .map((r) => `[${r.id}] ${r.category} — ${r.title}: ${r.body}`)
    .join('\n');
}

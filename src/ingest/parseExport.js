/**
 * Parser export chat WhatsApp (.txt).
 *
 * Format yang didukung:
 *   iOS     : [12/03/24, 14.22.05] Budi: halo
 *   Android : 12/03/24 14.22 - Budi: halo
 *             12/03/2024, 14:22 - Budi: halo
 *
 * Baris tanpa timestamp dianggap lanjutan pesan sebelumnya (multi-line).
 */

const LRM = /[\u200e\u200f\u202a-\u202e]/g;

const LINE_RE =
  /^\[?(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4}),?\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([AaPp]\.?\s?[Mm]\.?)?\]?\s*(?:-\s*)?([^:\n]{1,80}):\s?([\s\S]*)$/;

// Baris ber-timestamp tapi tanpa "Nama:" — event sistem (telepon, media, dsb).
const TS_PREFIX = /^\[?\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4},?\s+\d{1,2}[:.]\d{2}/;

const SYSTEM_HINTS = [
  'messages and calls are end-to-end encrypted',
  'pesan dan panggilan terenkripsi',
  'you deleted this message',
  'pesan ini telah dihapus',
  'this message was deleted',
  'anda menghapus pesan ini',
  '<media omitted>',
  'media omitted',
  'image omitted',
  'sticker omitted',
  'gambar dihilangkan',
];

/* ------------------------- pembersihan pesan sampah ------------------------ */

const MEDIA_TAG = /^<[^>\n]{0,80}(tidak disertakan|omitted)[^>\n]*>\s*/i;
const FILE_ONLY =
  /^[\w\-. ()]+\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|webp|gif|mp4|mov|opus|m4a|mp3|zip|rar|apk)$/i;
const NOISE_ONLY =
  /^(pesan ini dihapus|anda menghapus pesan ini|menghapus pesan ini|this message was deleted|you deleted this message|\[?telepon\]?|\[?panggilan\]?|\[?video ?call\]?|\[?call\]?|\[?diteruskan\]?|<?media omitted>?|image omitted|video omitted|audio omitted|sticker omitted|gif omitted|document omitted|contact card omitted)$/i;

/** Buang penanda media/pesan sistem. Null = jangan dipakai sebagai sampel. */
export function cleanMessage(text) {
  let t = String(text || '').trim();
  t = t.replace(/^\[Diteruskan\]\s*/i, '');
  t = t.replace(MEDIA_TAG, '').trim();
  if (!t) return null;
  // Penanda media buatan kita sendiri — bukan sampel gaya ngetik.
  if (/^\[(gambar|video|suara|dokumen|stiker)\]/i.test(t)) return null;
  if (NOISE_ONLY.test(t)) return null;
  if (FILE_ONLY.test(t)) return null;
  return t;
}

function toTs(d, mo, y, h, mi, s, ampm) {
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  let hour = Number(h);
  if (ampm) {
    const pm = /p/i.test(ampm);
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  }
  // WhatsApp export pakai format hari/bulan/tahun (ID/EU).
  const dt = new Date(year, Number(mo) - 1, Number(d), hour, Number(mi), Number(s || 0));
  const t = dt.getTime();
  return Number.isFinite(t) ? t : null;
}

export function parseExport(raw, { meName = null } = {}) {
  const text = String(raw || '')
    .replace(LRM, '')
    .replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);

  const messages = [];
  const authorCounts = new Map();
  let current = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    const m = line.match(LINE_RE);
    if (m) {
      const ts = toTs(m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
      const author = m[8].trim();
      const body = (m[9] || '').trim();
      current = { ts, author, text: body };
      messages.push(current);
      authorCounts.set(author, (authorCounts.get(author) || 0) + 1);
      continue;
    }

    // Event sistem (mis. "[Telepon]") tidak boleh menempel ke pesan sebelumnya.
    if (TS_PREFIX.test(line)) {
      current = null;
      continue;
    }

    // Lanjutan pesan sebelumnya.
    if (current) {
      const low = line.toLowerCase();
      if (SYSTEM_HINTS.some((h) => low.includes(h))) continue;
      current.text += (current.text ? '\n' : '') + line.trim();
    }
  }

  const authors = [...authorCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const cleaned = messages
    .map((m) => ({ ...m, text: cleanMessage(m.text) }))
    .filter((m) => m.text && m.ts);

  const detected = meName ?? guessMe(authors)?.name ?? null;

  return { messages: cleaned, authors, detectedMe: detected };
}

/**
 * Tebak siapa "aku" di export: biasanya nama pemilik nomor,
 * sering muncul di paling banyak chat tapi bukan yang paling banyak.
 * Heuristik: ambil kandidat yang muncul sebagai pengirim pesan terakhir.
 */
function guessMe(authors) {
  if (authors.length < 2) return authors[0] ?? null;
  return authors.find((a) => a.name !== '') ?? authors[0];
}

/** Ambil pasangan (pesan dia -> balasan aku) untuk few-shot. */
export function buildPairs(messages, meName, { maxGapMs = 1000 * 60 * 60 * 6 } = {}) {
  const pairs = [];
  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const cur = messages[i];
    if (prev.author === meName || cur.author !== meName) continue;
    if (!prev.text || !cur.text) continue;
    if (cur.ts - prev.ts > maxGapMs) continue;
    if (prev.text.length > 300 || cur.text.length > 300) continue;
    pairs.push({ their: prev.text, mine: cur.text, ts: cur.ts });
  }
  return pairs;
}

/**
 * Gacha bubble: satu balasan dipecah jadi beberapa pesan seperti orang chat.
 * Pemecahan hanya di batas kalimat, koma, atau jeda kata.
 */

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
// Gaya aslinya hampir tidak pernah pakai titik di akhir.
const clean = (s) => norm(s).replace(/[.…]+$/, '').trim();

export function splitBubbles(text, rng = Math.random, maxBubbles = 3) {
  const cap = Math.max(1, Math.min(8, Number(maxBubbles) || 3));
  const lines = String(text || '')
    .split('\n')
    .map(clean)
    .filter(Boolean);

  const pieces = [];
  for (const line of lines) {
    const parts = line
      .split(/(?<=[.!?…])\s+/)
      .map(clean)
      .filter(Boolean);
    pieces.push(...(parts.length ? parts : [line]));
  }

  if (!pieces.length) return [''];

  // Sudah lebih dari satu kalimat.
  if (pieces.length > 1) {
    const r = rng();
    if (r < 0.35) return [pieces.join(' ')];
    if (r < 0.7) return [pieces[0], pieces.slice(1).join(' ')].slice(0, cap);
    return pieces.slice(0, cap);
  }

  const single = pieces[0];
  const r = rng();

  // Satu kalimat pendek: kadang pecah di koma.
  const comma = single.indexOf(', ');
  if (r < 0.45 && comma > 2 && comma < single.length - 3 && cap >= 2) {
    return [single.slice(0, comma).trim(), single.slice(comma + 2).trim()];
  }

  // Kalau kontak ini biasa spam bubble, pecah lebih agresif (tetap ada gacha).
  const words = single.split(' ');
  if (cap >= 4 && words.length >= 3 && r < 0.75) {
    const cut = Math.ceil(words.length / 2);
    return [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
  }

  if (r < 0.3 && words.length >= 5 && cap >= 2) {
    const cut = Math.ceil(words.length / 2);
    return [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
  }

  // Kadang balasan pendek dibarengi bubble kecil.
  if (r < 0.15 && words.length <= 5 && cap >= 3) {
    const filler = ['wkwk', 'asu', 'yoo', 'loh'][Math.floor(rng() * 4)];
    return [single, filler];
  }

  return [single];
}

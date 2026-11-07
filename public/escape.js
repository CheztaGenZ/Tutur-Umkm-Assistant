const MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape teks sebelum masuk ke HTML. Dipakai semua render playground. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => MAP[c]);
}

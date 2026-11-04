/** Normalisasi JID nomor telepon: buang device suffix (`:0`) dan server. */
export function normalizePnJid(jid) {
  const value = String(jid || '').trim();
  if (!value.endsWith('@s.whatsapp.net')) return null;
  const user = value.split('@')[0].split(':')[0];
  return user ? `${user}@s.whatsapp.net` : null;
}

export function pnNumber(jid) {
  const normalized = normalizePnJid(jid);
  return normalized ? normalized.split('@')[0] : null;
}

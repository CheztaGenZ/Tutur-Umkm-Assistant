import { config, parseQuietHours } from './config.js';

export const isGroupJid = (jid = '') => jid.endsWith('@g.us');
export const isStatusJid = (jid = '') => jid === 'status@broadcast';
export const isNewsletterJid = (jid = '') => jid.endsWith('@newsletter');
export const isDirectJid = (jid = '') => jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid');

export const dayStart = (d = new Date()) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
};

export const hourStart = (d = new Date()) => {
  const x = new Date(d);
  x.setMinutes(0, 0, 0);
  return x.getTime();
};

export function inQuietHours(date = new Date(), spec = config.safety.quietHours) {
  const range = parseQuietHours(spec);
  if (!range) return false;
  const mins = date.getHours() * 60 + date.getMinutes();
  const { start, end } = range;
  // Mendukung rentang yang melewati tengah malam (mis. 22:00-07:00).
  return start <= end ? mins >= start && mins < end : mins >= start || mins < end;
}

export function isVip(contact) {
  if (!contact) return false;
  const num = String(contact.number || contact.jid || '').replace(/\D/g, '');
  return config.vip.some((v) => v.replace(/\D/g, '') === num);
}

/**
 * Satu-satunya tempat yang memutuskan boleh-balas atau tidak.
 * Default aman: apa pun yang tidak jelas -> draft (tidak dikirim).
 *
 * @returns {{action: 'auto'|'draft'|'ignore', reason: string}}
 */
export function decide({
  jid,
  contact,
  paused = false,
  counts = { day: 0, hour: 0, contactToday: 0, lastContactSentAt: 0 },
  now = new Date(),
  needsOwner = false,
  ownerReason = '',
  intent = 'obrolan',
}) {
  const ignore = (reason) => ({ action: 'ignore', reason });
  const draft = (reason) => ({ action: 'draft', reason });

  if (paused) return ignore('Sistem sedang dijeda.');
  if (isGroupJid(jid)) return ignore('Grup — tidak pernah dibalas.');
  if (isStatusJid(jid)) return ignore('Status/broadcast.');
  if (isNewsletterJid(jid)) return ignore('Channel/newsletter.');
  if (!isDirectJid(jid)) return ignore('Bukan chat pribadi.');

  // Kontak yang ditandai "jangan dijawab" — mutlak, tidak ada pengecualian.
  if (contact?.mode === 'ignore') return ignore('Kontak ditandai JANGAN dibalas.');
  if (isVip(contact)) return ignore('Nomor VIP (dari .env) — tidak dibalas.');

  // Spam tidak pernah dibalas, bahkan untuk kontak baru atau kontak draft.
  if (intent === 'spam') return ignore('Spam/promosi — sengaja tidak dibalas.');

  if (!contact) return draft('Kontak baru/belum dikenal — masuk draft dulu.');
  if (contact.mode === 'draft') return draft('Kontak di mode draft — butuh persetujuanmu.');

  // contact.mode === 'auto'
  if (inQuietHours(now)) return ignore(`Jam tenang (${config.safety.quietHours}).`);
  if (counts.day >= config.safety.maxPerDay)
    return draft(`Batas harian tercapai (${config.safety.maxPerDay} pesan).`);
  if (counts.hour >= config.safety.maxPerHour)
    return draft(`Batas per jam tercapai (${config.safety.maxPerHour} pesan).`);
  if (counts.lastContactSentAt && counts.lastContactSentAt <= now.getTime()) {
    const gapSec = (now.getTime() - counts.lastContactSentAt) / 1000;
    if (gapSec < config.safety.minGapPerContactSec)
      return draft(
        `Baru saja membalas kontak ini (${Math.round(
          gapSec,
        )}s lalu, jeda ${config.safety.minGapPerContactSec}s). Masuk draft dulu, biar tidak terkesan spam.`,
      );
  }

  // Eskalasi mengalahkan auto, tetapi tidak pernah mengubah ignore menjadi draft.
  if (needsOwner)
    return draft(`Butuh pemilik: ${ownerReason || 'pesan berisiko, perlu keputusan manusia'}.`);

  return { action: 'auto', reason: 'Kontak di mode auto, semua batas aman.' };
}

/**
 * Satu tempat untuk memutuskan apakah balasan boleh dikirim tanpa persetujuan.
 * needsOwner dan spam selalu menang, bahkan saat confidence tinggi.
 */
export function shouldAutoSend({
  decision,
  confidence = 0,
  confidenceMin = config.safety.autoConfidenceMin,
  forceDraft = false,
  needsOwner = false,
  intent = 'obrolan',
}) {
  if (forceDraft || needsOwner || intent === 'spam') return false;
  return decision?.action === 'auto' && Number(confidence) >= Number(confidenceMin);
}

/** Jeda manusiawi sebelum "mengetik". */
export function humanDelay() {  const { replyDelayMinMs: min, replyDelayMaxMs: max } = config.safety;
  return Math.round(min + Math.random() * Math.max(0, max - min));
}

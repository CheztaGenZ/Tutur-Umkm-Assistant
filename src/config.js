import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env' });

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function list(v) {
  return String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  port: num(process.env.PORT, 3000),
  dataDir: process.env.DATA_DIR || './data',

  // Dipakai sebagai "nama kamu" kalau export WA tidak menyebutkannya.
  me: process.env.MY_NAME || 'Aku',

  ai: {
    baseUrl: process.env.AI_BASE_URL || 'https://api.deepseek.com/v1',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'deepseek-flash',
    // Model khusus pesan bergambar/video. Kosong = ikut model teks.
    visionModel: process.env.AI_VISION_MODEL || '',
    temperature: num(process.env.AI_TEMPERATURE, 1.0),
    timeoutMs: num(process.env.AI_TIMEOUT_MS, 20000),
    // 'off' = matikan thinking (murah & cepat), 'on' = aktifkan, 'auto' = jangan kirim apa pun.
    thinking: process.env.AI_THINKING || 'auto',
    // Saat thinking aktif: low / high / max. Low = paling hemat.
    reasoningEffort: process.env.AI_REASONING_EFFORT || 'low',
    maxTokens: num(process.env.AI_MAX_TOKENS, 2000),

    // Opsional: layanan transkrip suara (OpenAI/Groq whisper, dll).
    transcribeUrl: process.env.AI_TRANSCRIBE_URL || '',
    transcribeKey: process.env.AI_TRANSCRIBE_KEY || '',
    transcribeModel: process.env.AI_TRANSCRIBE_MODEL || 'whisper-1',
    // Whisper lokal (tanpa akun): pakai onnxruntime + model HuggingFace.
    transcribeLocal: process.env.AI_TRANSCRIBE_LOCAL !== 'false',
    transcribeModelLocal: process.env.AI_TRANSCRIBE_MODEL_LOCAL || 'Xenova/whisper-base',
  },

  // Pagar pengaman anti-ban. Jangan dinaikkan tanpa alasan kuat.
  safety: {
    maxPerDay: num(process.env.MAX_MSGS_PER_DAY, 40),
    maxPerHour: num(process.env.MAX_MSGS_PER_HOUR, 12),
    minGapPerContactSec: num(process.env.MIN_GAP_PER_CONTACT_SEC, 180),
    replyDelayMinMs: num(process.env.REPLY_DELAY_MIN_MS, 4000),
    replyDelayMaxMs: num(process.env.REPLY_DELAY_MAX_MS, 12000),
    quietHours: process.env.QUIET_HOURS || '01:00-07:00',
    autoConfidenceMin: num(process.env.AUTO_CONFIDENCE_MIN, 0.75),
  },

  style: {
    fewShotCount: num(process.env.FEWSHOT_COUNT, 12),
    historyTurns: num(process.env.HISTORY_TURNS, 10),
  },

  // Tunggu dulu sebelum membalas: bubble chat yang bersambung digabung.
  chat: {
    debounceMs: num(process.env.DEBOUNCE_MS, 5000),
    maxWaitMs: num(process.env.DEBOUNCE_MAX_WAIT_MS, 20000),
  },

  // Stiker: dikumpulkan dari chat, dikirim sesekali saja.
  stickers: {
    enabled: process.env.STICKER_ENABLED !== 'false',
    chance: num(process.env.STICKER_CHANCE, 0.15),
    cooldownMs: num(process.env.STICKER_COOLDOWN_MIN, 30) * 60 * 1000,
    every: num(process.env.STICKER_EVERY, 5),
    dir: process.env.STICKER_DIR || './stickers',
  },

  // Nomor yang tidak boleh dibalas sama sekali (pengaman ekstra di luar dashboard).
  vip: list(process.env.VIP_NUMBERS),

  // Mode demo penjurian: persona bisnis, tanpa WhatsApp, dashboard butuh token.
  demo: {
    enabled: process.env.DEMO_MODE === '1',
    businessName: process.env.BUSINESS_NAME || 'Sari Kitchen',
    adminToken: process.env.ADMIN_TOKEN || '',
  },

  auth: {
    publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
    googleId: process.env.GOOGLE_CLIENT_ID || '',
    googleSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    facebookId: process.env.FACEBOOK_APP_ID || '',
    facebookSecret: process.env.FACEBOOK_APP_SECRET || '',
  },
};

/** Parse "01:00-07:00" jadi dua menit-dalam-hari. Null kalau format salah atau dimatikan. */export function parseQuietHours(spec) {
  const raw = String(spec || '').trim();
  if (!raw || /^(off|none|-)$/i.test(raw)) return null;
  const m = raw.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const toMin = (h, mm) => Number(h) * 60 + Number(mm);
  return { start: toMin(m[1], m[2]), end: toMin(m[3], m[4]) };
}

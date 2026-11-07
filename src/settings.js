/**
 * Pengaturan provider AI dari dashboard.
 *
 * Nilai disimpan ke .env supaya tetap ada setelah restart, lalu object
 * `config` yang sudah dipakai semua modul dimutasi agar langsung aktif.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { testProvider } from './ai/client.js';

const ENV_KEYS = [
  'AI_BASE_URL',
  'AI_API_KEY',
  'AI_MODEL',
  'AI_VISION_MODEL',
  'AI_THINKING',
  'AI_TEMPERATURE',
  'AI_MAX_TOKENS',
  'MY_NAME',
];

const fail = (message) => {
  const err = new Error(message);
  err.status = 400;
  return err;
};

export function maskKey(key) {
  const value = String(key || '');
  if (!value) return '';
  if (value.length <= 8) return '•'.repeat(value.length);
  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}

export function isLocalRequest(req) {
  // Di belakang reverse proxy, socket selalu 127.0.0.1. Jangan pernah
  // menganggap request yang membawa alamat proxy sebagai akses lokal.
  if (req?.headers?.['x-forwarded-for'] || req?.headers?.['x-real-ip']) return false;
  const ip = String(req?.socket?.remoteAddress || req?.ip || '').trim();
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/** Alamat privat/loopback untuk akses baca API dari LAN. */
export function isPrivateRemote(req) {
  let ip = String(req?.socket?.remoteAddress || req?.ip || '')
    .trim()
    .toLowerCase()
    .replace(/^::ffff:/, '');
  if (!ip) return false;
  if (ip === '::1' || ip.startsWith('127.')) return true;
  if (/^10\./.test(ip) || /^192\.168\./.test(ip) || /^169\.254\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip)) return true;
  return false;
}

/** URL yang aman ditampilkan ke LAN: tanpa userinfo/query/hash. */
export function publicBaseUrl(value) {
  try {
    const url = new URL(String(value));
    return `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
}

function envPath() {
  return path.resolve(process.env.ENV_FILE || '.env');
}

function formatEnvValue(value) {
  const text = String(value ?? '').replace(/[\r\n]/g, '');
  return /[\s#"']/.test(text) ? JSON.stringify(text) : text;
}

/** Tulis hanya key yang diberikan; komentar dan urutan baris lain dipertahankan. */
function writeEnvFile(updates) {
  const file = envPath();
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw ? raw.split(/\r?\n/) : [];

  for (const key of ENV_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(updates, key)) continue;
    const matcher = new RegExp(`^(\\s*(?:export\\s+)?${key}\\s*=)(.*)$`);
    const index = lines.findIndex((row) => matcher.test(row));
    if (index === -1) {
      lines.push(`${key}=${formatEnvValue(updates[key])}`);
    } else {
      const match = lines[index].match(matcher);
      const comment = match[2].match(/\s+#.*$/)?.[0] || '';
      lines[index] = `${match[1]}${formatEnvValue(updates[key])}${comment}`;
    }
  }

  const text = `${lines.join(eol).replace(new RegExp(`${eol}+$`), '')}${eol}`;
  let mode = 0o600;
  try {
    if (fs.existsSync(file)) mode = fs.statSync(file).mode & 0o777;
  } catch {}
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
  try {
    try {
      fs.renameSync(tmp, file);
    } catch {
      fs.copyFileSync(tmp, file);
    }
    try {
      fs.chmodSync(file, mode);
    } catch {}
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {}
  }
}

function validate(payload = {}) {
  const baseUrl = String(payload.baseUrl || '').trim();
  if (!baseUrl || baseUrl.length > 2000) throw fail('Base URL tidak valid');

  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw fail('Base URL tidak valid');
  }
  if (!/^https?:$/.test(parsed.protocol)) throw fail('Base URL harus http atau https');
  if (parsed.username || parsed.password) throw fail('Base URL tidak boleh memuat username/password');

  const model = String(payload.model || '').trim();
  if (!model) throw fail('Model wajib diisi');
  if (model.length > 200) throw fail('Nama model terlalu panjang');

  let currentOrigin = '';
  try {
    currentOrigin = new URL(config.ai.baseUrl).origin;
  } catch {
    currentOrigin = '';
  }
  const hostChanged = currentOrigin !== parsed.origin;

  // Field ini opsional. Kalau tidak dikirim, pertahankan nilai lama.
  // Saat pindah provider, model vision lama dibuang karena belum tentu ada.
  const hasVision = Object.prototype.hasOwnProperty.call(payload, 'visionModel');
  const visionModel = hasVision
    ? String(payload.visionModel || '').trim()
    : hostChanged
      ? ''
      : config.ai.visionModel || '';
  if (visionModel.length > 200) throw fail('Nama model gambar/video terlalu panjang');

  const thinking = String(payload.thinking || 'auto');
  if (!['off', 'on', 'auto'].includes(thinking)) throw fail('Mode thinking tidak valid');

  const temperature = Number(payload.temperature ?? config.ai.temperature);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw fail('Temperature harus antara 0 dan 2');
  }

  const maxTokens = Number(payload.maxTokens ?? config.ai.maxTokens);
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8000) {
    throw fail('Max token output harus 1–8000');
  }

  const me = String(payload.me ?? config.me).trim().slice(0, 80) || 'Aku';
  const apiKeyInput = payload.apiKey == null ? '' : String(payload.apiKey).trim();
  if (apiKeyInput.length > 500) throw fail('API key terlalu panjang');

  const keyCleared = hostChanged && !apiKeyInput && Boolean(config.ai.apiKey);
  const apiKey = apiKeyInput || (hostChanged ? '' : config.ai.apiKey);

  return {
    baseUrl,
    model,
    visionModel,
    thinking,
    temperature,
    maxTokens,
    me,
    apiKey,
    hostChanged,
    keyCleared,
  };
}

export function getSettings() {
  return {
    baseUrl: config.ai.baseUrl,
    model: config.ai.model,
    visionModel: config.ai.visionModel || '',
    thinking: config.ai.thinking,
    temperature: config.ai.temperature,
    maxTokens: config.ai.maxTokens,
    me: config.me,
    hasApiKey: Boolean(config.ai.apiKey),
    apiKeyMasked: maskKey(config.ai.apiKey),
  };
}

export function saveSettings(payload = {}) {
  const next = validate(payload);

  config.ai.baseUrl = next.baseUrl;
  config.ai.apiKey = next.apiKey;
  config.ai.model = next.model;
  config.ai.visionModel = next.visionModel;
  config.ai.thinking = next.thinking;
  config.ai.temperature = next.temperature;
  config.ai.maxTokens = next.maxTokens;
  config.me = next.me;

  let persisted = true;
  let warning = null;
  try {
    writeEnvFile({
      AI_BASE_URL: next.baseUrl,
      AI_API_KEY: next.apiKey,
      AI_MODEL: next.model,
      AI_VISION_MODEL: next.visionModel,
      AI_THINKING: next.thinking,
      AI_TEMPERATURE: next.temperature,
      AI_MAX_TOKENS: next.maxTokens,
      MY_NAME: next.me,
    });
  } catch (err) {
    persisted = false;
    warning = `Setting aktif, tapi gagal menulis .env: ${err.message}`;
  }

  return {
    ...getSettings(),
    persisted,
    warning,
    hostChanged: next.hostChanged,
    keyCleared: next.keyCleared,
  };
}

export async function testSettings(payload = {}) {
  const next = validate(payload);
  return testProvider({
    baseUrl: next.baseUrl,
    apiKey: next.apiKey,
    model: next.model,
  });
}

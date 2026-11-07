import { config } from '../config.js';
import { getAiSettings } from '../db.js';
import { decryptSecret, maskSecret } from '../secrets.js';

/** Ambil konfigurasi AI milik akun. Null berarti akun belum punya API key. */
export function aiConfigForOwner(db, ownerId) {
  const row = getAiSettings(db, ownerId);
  if (!row || !row.api_key) return null;
  const apiKey = decryptSecret(row.api_key, config.dataDir);
  if (!apiKey) return null;
  return {
    ...config.ai,
    baseUrl: row.base_url || config.ai.baseUrl,
    apiKey,
    model: row.model || config.ai.model,
    visionModel: row.vision_model || '',
    thinking: row.thinking || 'off',
    temperature: Number.isFinite(row.temperature) ? row.temperature : config.ai.temperature,
    maxTokens: Number.isFinite(row.max_tokens) ? row.max_tokens : config.ai.maxTokens,
  };
}

export function aiInfoForOwner(db, ownerId) {
  const row = getAiSettings(db, ownerId);
  const apiKey = row?.api_key ? decryptSecret(row.api_key, config.dataDir) : '';
  return {
    configured: Boolean(apiKey),
    baseUrl: row?.base_url || '',
    model: row?.model || '',
    visionModel: row?.vision_model || '',
    thinking: row?.thinking || 'off',
    temperature: row?.temperature ?? 0.8,
    maxTokens: row?.max_tokens ?? 2000,
    apiKeyMasked: maskSecret(apiKey),
  };
}

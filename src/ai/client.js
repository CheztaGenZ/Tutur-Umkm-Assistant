import { config } from '../config.js';
import { recordUsage, normalizeUsage } from './usage.js';

/**
 * Klien minimal untuk API yang kompatibel OpenAI
 * (DeepSeek, OpenAI, OpenRouter, Groq, Ollama, dsb).
 */

class AiError extends Error {}

/** Pesan berisi gambar/video? Dipakai untuk memilih model vision. */
export function hasMediaContent(messages = []) {
  return (messages || []).some(
    (m) =>
      Array.isArray(m?.content) &&
      m.content.some((part) =>
        ['image_url', 'video_url', 'input_image', 'input_video'].includes(part?.type),
      ),
  );
}

/** Pilih model teks atau model gambar/video. */
export function selectModel(
  messages,
  textModel = config.ai.model,
  visionModel = config.ai.visionModel,
) {
  return hasMediaContent(messages) && visionModel ? visionModel : textModel;
}

/** Gemini 3 hanya menerima level thinking tertentu. */
export function googleReasoningEffort(model) {
  return /gemini-3\.8/i.test(String(model || '')) ? 'low' : 'minimal';
}

/** Model cadangan kalau model Gemini utama sedang sibuk/kena limit. */
export function googleFallbackModel(model) {
  return /gemini-3\.1-flash-lite/i.test(String(model || ''))
    ? 'gemini-3.5-flash'
    : 'gemini-3.1-flash-lite';
}

/** Buang API key dari teks error provider sebelum disimpan/dikirim ke UI. */
export function redactSecrets(text, key) {
  let out = String(text ?? '');
  const secret = String(key || '');
  if (secret.length >= 4) out = out.split(secret).join('[REDACTED]');
  out = out.replace(/Bearer\s+[^\s"'\\]+/gi, 'Bearer [REDACTED]');
  out = out.replace(/\b(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[REDACTED]@');
  return out;
}

async function postChat(
  messages,
  {
    temperature = config.ai.temperature,
    jsonMode = true,
    useThinking = true,
    useReasoning = true,
    signal,
    kind = 'chat',
    meta = {},
  } = {},
) {
  const url = `${config.ai.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const isGoogle = /generativelanguage\.googleapis\.com/i.test(config.ai.baseUrl);
  const primary = selectModel(messages);
  const models = [primary];
  if (isGoogle) {
    const fallback = googleFallbackModel(primary);
    if (fallback && fallback !== primary) models.push(fallback);
  }

  const headers = { 'Content-Type': 'application/json' };
  if (config.ai.apiKey) headers.Authorization = `Bearer ${config.ai.apiKey}`;
  let lastError = null;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const timeout = AbortSignal.timeout(config.ai.timeoutMs);
    const body = {
      model,
      messages,
      temperature,
      max_tokens: config.ai.maxTokens,
    };
    if (jsonMode) body.response_format = { type: 'json_object' };

    // DeepSeek menyalakan thinking secara default. Mode thinking memakan
    // lebih banyak token output (dan mengabaikan temperature).
    if (useThinking && config.ai.thinking !== 'auto') {
      body.thinking = { type: config.ai.thinking === 'on' ? 'enabled' : 'disabled' };
      if (config.ai.thinking === 'on') body.reasoning_effort = config.ai.reasoningEffort;
    }

    // Gemini 3 tidak bisa mematikan thinking, tapi bisa dibuat seminimal mungkin.
    if (useReasoning && isGoogle) {
      body.reasoning_effort = googleReasoningEffort(model);
    }

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        redirect: 'error',
      });
    } catch (err) {
      lastError = new AiError(`AI gagal: ${err.message}`);
      lastError.status = err.status || null;
      if (isGoogle && i < models.length - 1) continue;
      throw lastError;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const safe = redactSecrets(text, config.ai.apiKey);
      const err = new AiError(`AI HTTP ${res.status}: ${safe.slice(0, 300)}`);
      err.status = res.status;
      err.body = safe;
      lastError = err;
      if (isGoogle && [429, 502, 503, 504].includes(res.status) && i < models.length - 1) {
        continue;
      }
      throw err;
    }

    const data = await res.json();
    recordUsage(data?.usage, {
      kind,
      model: meta.model || data?.model || model,
      baseUrl: meta.baseUrl || config.ai.baseUrl,
    });
    const content = data?.choices?.[0]?.message?.content;
    if (content) return content;

    lastError = new AiError('AI mengembalikan respons kosong');
    if (!isGoogle || i >= models.length - 1) throw lastError;
  }

  throw lastError || new AiError('AI gagal menghubungi provider');
}

/** Ekstrak JSON dari output model, toleran terhadap code fence / teks pembuka. */
export function parseJsonLoose(content) {
  const raw = String(content || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced ? fenced[1] : null, raw].filter(Boolean);

  for (const c of candidates) {
    try {
      return JSON.parse(c.trim());
    } catch {
      /* lanjut */
    }
    const start = c.indexOf('{');
    const end = c.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(c.slice(start, end + 1));
      } catch {
        /* lanjut */
      }
    }
  }
  return null;
}

export async function chatJson(messages, opts = {}) {
  const fallback = {
    ...opts,
    jsonMode: false,
    useThinking: false,
    useReasoning: false,
  };
  let content;
  let usedFallback = false;
  try {
    content = await postChat(messages, { ...opts, jsonMode: true });
  } catch (err) {
    // Sebagian provider menolak response_format / parameter thinking.
    // Coba sekali lagi dengan setelan paling kompatibel.
    if (err.status === 400 || err.status === 422) {
      content = await postChat(messages, fallback);
      usedFallback = true;
    } else {
      throw err;
    }
  }

  let parsed = parseJsonLoose(content);
  if (!parsed && !usedFallback) {
    // Provider kadang membalas 200 dengan teks biasa walau JSON mode aktif.
    content = await postChat(messages, fallback);
    parsed = parseJsonLoose(content);
  }

  if (!parsed) {
    const err = new AiError('Gagal parse JSON dari AI');
    err.raw = content;
    throw err;
  }
  return parsed;
}

/**
 * Tes koneksi ke provider dengan parameter form (bisa belum disimpan).
 * Tidak mengubah config dan tidak menulis .env.
 */
export async function testProvider({ baseUrl, apiKey, model, timeoutMs = 20000 }) {
  if (!baseUrl || !model) throw new AiError('Base URL dan model wajib diisi');

  const url = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const body = {
    model,
    messages: [{ role: 'user', content: 'ping' }],
    // Model reasoning bisa menghabiskan token untuk berpikir sebelum menulis.
    max_tokens: 256,
    temperature: 0,
  };
  // Tes koneksi DeepSeek selalu hemat: jangan biarkan thinking menghabiskan token.
  try {
    const host = new URL(baseUrl).hostname;
    if (host.endsWith('deepseek.com')) body.thinking = { type: 'disabled' };
    if (host === 'generativelanguage.googleapis.com') {
      body.reasoning_effort = googleReasoningEffort(model);
    }
  } catch {}

  const started = Date.now();
  const timeout = AbortSignal.timeout(timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: timeout,
      redirect: 'error',
    });
  } catch (err) {
    throw new AiError(`Tidak bisa menghubungi provider: ${err.message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const safe = redactSecrets(text, apiKey);
    const err = new AiError(`AI HTTP ${res.status}: ${safe.slice(0, 300)}`);
    err.status = res.status;
    err.body = safe;
    throw err;
  }

  const data = await res.json();
  recordUsage(data?.usage, {
    kind: 'test',
    model: data?.model || model,
    baseUrl,
  });
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new AiError('Provider mengembalikan respons kosong');

  return {
    ok: true,
    ms: Date.now() - started,
    model: data?.model || model,
    sample: String(content).slice(0, 120),
    usage: normalizeUsage(data?.usage),
  };
}

export { AiError };

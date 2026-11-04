/**
 * Pencatatan pemakaian token AI.
 *
 * Modul ini sengaja tidak tahu soal database. `src/index.js` memasang sink
 * yang menulis ke SQLite, sehingga `ai/client.js` tetap bisa dipakai oleh
 * script tes tanpa database.
 */

let sink = null;

const toInt = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** Samakan bentuk usage dari OpenAI, DeepSeek, OpenRouter, Groq, dsb. */
export function normalizeUsage(usage) {
  const promptTokens = toInt(usage?.prompt_tokens ?? usage?.input_tokens);
  const completionTokens = toInt(usage?.completion_tokens ?? usage?.output_tokens);
  const totalTokens = toInt(usage?.total_tokens) || promptTokens + completionTokens;
  const cachedTokens = toInt(
    usage?.prompt_cache_hit_tokens ??
      usage?.cached_tokens ??
      usage?.prompt_tokens_details?.cached_tokens,
  );
  return { promptTokens, completionTokens, totalTokens, cachedTokens };
}

export function setUsageSink(fn) {
  sink = typeof fn === 'function' ? fn : null;
}

export function recordUsage(usage, meta = {}) {
  const row = {
    ts: Date.now(),
    kind: String(meta.kind || 'chat'),
    model: meta.model ? String(meta.model) : null,
    baseUrl: meta.baseUrl ? String(meta.baseUrl) : null,
    ...normalizeUsage(usage),
  };

  if (sink) {
    try {
      sink(row);
    } catch (err) {
      console.error('Gagal mencatat pemakaian token AI:', err.message);
    }
  }
  return row;
}

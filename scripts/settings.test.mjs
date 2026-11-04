/**
 * Tes setting AI + pencatatan token.
 * Jalankan: node scripts/settings.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openDb, recordAiUsage, aiUsageSummary } from '../src/db.js';
import { normalizeUsage, recordUsage, setUsageSink } from '../src/ai/usage.js';

const dir = path.resolve('data-settingstest');
fs.rmSync(dir, { recursive: true, force: true });
const db = openDb(dir);

const n = normalizeUsage({
  prompt_tokens: 100,
  completion_tokens: 20,
  total_tokens: 120,
  prompt_cache_hit_tokens: 30,
});
assert.equal(n.promptTokens, 100);
assert.equal(n.completionTokens, 20);
assert.equal(n.totalTokens, 120);
assert.equal(n.cachedTokens, 30);
assert.equal(normalizeUsage({ input_tokens: 11, output_tokens: 4 }).totalTokens, 15);
assert.equal(
  normalizeUsage({
    prompt_tokens: 10,
    completion_tokens: 2,
    prompt_tokens_details: { cached_tokens: 7 },
  }).cachedTokens,
  7,
);
assert.equal(normalizeUsage({ cached_tokens: 3 }).cachedTokens, 3);

const rows = [];
setUsageSink((row) => rows.push(row));
recordUsage(null, { kind: 'reply', model: 'm', baseUrl: 'https://x' });
assert.equal(rows.length, 1);
assert.equal(rows[0].totalTokens, 0);
assert.equal(rows[0].kind, 'reply');

recordAiUsage(db, {
  ts: 1000,
  kind: 'reply',
  model: 'm',
  baseUrl: 'https://x',
  promptTokens: 100,
  completionTokens: 20,
  totalTokens: 120,
  cachedTokens: 10,
});
recordAiUsage(db, {
  ts: 2000,
  kind: 'memory',
  model: 'm',
  baseUrl: 'https://x',
  promptTokens: 50,
  completionTokens: 5,
  totalTokens: 55,
  cachedTokens: 0,
});
const s = aiUsageSummary(db);
assert.equal(s.totalTokens, 175);
assert.equal(s.calls, 2);
assert.equal(s.promptTokens, 150);
assert.equal(s.completionTokens, 25);
assert.equal(s.last.kind, 'memory');
assert.deepEqual(s.byKind.map((x) => x.kind).sort(), ['memory', 'reply']);

console.log('✓ usage: normalisasi, sink, dan ringkasan SQLite');

/* ------------------------------- settings -------------------------------- */

const envPath = path.resolve('data-settingstest', '.env');
fs.writeFileSync(
  envPath,
  [
    'AI_BASE_URL=https://api.deepseek.com/v1',
    'AI_API_KEY=sk-old-key-1234',
    'AI_MODEL=deepseek-flash',
    'AI_VISION_MODEL=vision-old',
    'AI_THINKING=on',
    'AI_TEMPERATURE=1.25',
    'MY_NAME=Chesta',
    '# komentar harus tetap ada',
  ].join('\n'),
);
process.env.AI_BASE_URL = 'https://api.deepseek.com/v1';
process.env.AI_API_KEY = 'sk-old-key-1234';
process.env.AI_MODEL = 'deepseek-flash';
process.env.AI_VISION_MODEL = 'vision-old';
process.env.AI_THINKING = 'on';
process.env.AI_TEMPERATURE = '1.25';
process.env.AI_MAX_TOKENS = '2000';
process.env.MY_NAME = 'Chesta';
process.env.ENV_FILE = envPath;

const settings = await import('../src/settings.js');
const { config } = await import('../src/config.js');

const initial = settings.getSettings();
assert.equal(initial.apiKeyMasked, 'sk-…1234');
assert.equal(initial.hasApiKey, true);
assert.equal(initial.model, 'deepseek-flash');
assert.equal(initial.visionModel, 'vision-old');

const kept = settings.saveSettings({
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  visionModel: 'vision-new',
  thinking: 'off',
  temperature: 0.7,
  maxTokens: 500,
  me: 'Test',
});
assert.equal(kept.persisted, true);
assert.equal(kept.hasApiKey, true);
assert.equal(kept.hostChanged, false);
assert.equal(config.ai.model, 'deepseek-chat');
assert.equal(config.ai.visionModel, 'vision-new');
assert.equal(config.ai.thinking, 'off');
assert.match(fs.readFileSync(envPath, 'utf8'), /AI_VISION_MODEL=vision-new/);
assert.match(fs.readFileSync(envPath, 'utf8'), /AI_API_KEY=sk-old-key-1234/);
assert.match(fs.readFileSync(envPath, 'utf8'), /# komentar harus tetap ada/);
assert.match(fs.readFileSync(envPath, 'utf8'), /MY_NAME=Test/);

const cleared = settings.saveSettings({
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  thinking: 'auto',
  temperature: 1,
  maxTokens: 1000,
  me: 'Test',
});
assert.equal(cleared.hostChanged, true);
assert.equal(cleared.keyCleared, true);
assert.equal(cleared.hasApiKey, false);
assert.equal(config.ai.apiKey, '');
assert.equal(config.ai.visionModel, '');
assert.match(fs.readFileSync(envPath, 'utf8'), /AI_API_KEY=\r?\n/);

const changed = settings.saveSettings({
  baseUrl: 'https://api.groq.com/openai/v1',
  apiKey: 'gsk-new-5678',
  model: 'llama-3.3-70b-versatile',
  visionModel: 'vision-groq',
  thinking: 'auto',
  temperature: 1,
  maxTokens: 1000,
  me: 'Test',
});
assert.equal(changed.hasApiKey, true);
assert.equal(config.ai.apiKey, 'gsk-new-5678');
assert.equal(config.ai.visionModel, 'vision-groq');
assert.match(fs.readFileSync(envPath, 'utf8'), /AI_API_KEY=gsk-new-5678/);
assert.match(fs.readFileSync(envPath, 'utf8'), /AI_VISION_MODEL=vision-groq/);

// Origin, bukan cuma host: https -> http harus membuang key lama.
settings.saveSettings({
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-origin-9999',
  model: 'origin',
  thinking: 'off',
  temperature: 1,
  maxTokens: 1000,
  me: 'Test',
});
const downgrade = settings.saveSettings({
  baseUrl: 'http://api.deepseek.com/v1',
  model: 'origin',
  thinking: 'off',
  temperature: 1,
  maxTokens: 1000,
  me: 'Test',
});
assert.equal(downgrade.hostChanged, true);
assert.equal(downgrade.keyCleared, true);
assert.equal(config.ai.apiKey, '');

// Komentar inline dan prefix export harus dipertahankan.
settings.saveSettings({
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-inline-9999',
  model: 'old-model',
  thinking: 'on',
  temperature: 1,
  maxTokens: 1000,
  me: 'Test',
});
const inlineEnv = path.resolve(dir, 'inline.env');
fs.writeFileSync(
  inlineEnv,
  [
    'export AI_BASE_URL=https://api.deepseek.com/v1',
    'export AI_API_KEY=sk-inline-9999',
    'export AI_MODEL=old-model # keep this',
    'AI_THINKING=on # mode',
  ].join('\n'),
);
process.env.ENV_FILE = inlineEnv;
const inlineSaved = settings.saveSettings({
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'new-model',
  thinking: 'off',
  temperature: 1,
  maxTokens: 1000,
  me: 'Test',
});
assert.equal(inlineSaved.persisted, true);
const inlineText = fs.readFileSync(inlineEnv, 'utf8');
assert.match(inlineText, /export AI_MODEL=new-model # keep this/);
assert.match(inlineText, /AI_THINKING=off # mode/);
assert.doesNotMatch(inlineText, /^AI_MODEL=/m);
process.env.ENV_FILE = envPath;

// Gagal tulis .env: runtime tetap aktif, tapi tidak boleh ada file temp berisi key.
const roEnv = path.resolve(dir, 'readonly.env');
fs.writeFileSync(
  roEnv,
  [
    'AI_BASE_URL=https://api.deepseek.com/v1',
    'AI_API_KEY=sk-ro-9999',
    'AI_MODEL=old',
    'AI_THINKING=off',
  ].join('\n'),
);
process.env.ENV_FILE = roEnv;
fs.chmodSync(roEnv, 0o444);
let ro;
try {
  ro = settings.saveSettings({
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-ro-new',
    model: 'ro-model',
    thinking: 'off',
    temperature: 1,
    maxTokens: 1000,
    me: 'Test',
  });
} finally {
  fs.chmodSync(roEnv, 0o666);
}
assert.equal(ro.persisted, false);
assert.equal(
  fs.readdirSync(dir).filter((f) => f.startsWith('readonly.env.tmp-')).length,
  0,
);
process.env.ENV_FILE = envPath;

assert.throws(
  () => settings.saveSettings({ baseUrl: 'ftp://x', model: 'm' }),
  (err) => err.status === 400,
);

assert.equal(settings.isLocalRequest({ socket: { remoteAddress: '127.0.0.1' } }), true);
assert.equal(settings.isLocalRequest({ socket: { remoteAddress: '::1' } }), true);
assert.equal(settings.isLocalRequest({ socket: { remoteAddress: '::ffff:127.0.0.1' } }), true);
assert.equal(settings.isLocalRequest({ socket: { remoteAddress: '192.168.1.8' } }), false);
assert.equal(settings.isPrivateRemote({ socket: { remoteAddress: '192.168.1.8' } }), true);
assert.equal(settings.isPrivateRemote({ socket: { remoteAddress: '::ffff:192.168.1.8' } }), true);
assert.equal(settings.isPrivateRemote({ socket: { remoteAddress: '100.64.0.1' } }), true);
assert.equal(settings.isPrivateRemote({ socket: { remoteAddress: '8.8.8.8' } }), false);
assert.equal(settings.isPrivateRemote({ socket: { remoteAddress: '2404:c0::1' } }), false);
assert.equal(
  settings.publicBaseUrl('https://user:pass@example.com/v1?api_key=SECRET'),
  'https://example.com/v1',
);
console.log('✓ settings: masking, .env, host change, guard');

/* ------------------------- client + test provider ------------------------- */

import http from 'node:http';
config.ai.baseUrl = 'http://localhost:3197/v1';
config.ai.apiKey = 'secret-key';
config.ai.model = 'mock-model';
const { chatJson, testProvider, selectModel, googleReasoningEffort, googleFallbackModel } =
  await import('../src/ai/client.js');

let lastAuth = '';
let mockStatus = 200;
let mockBadJson = false;
let mockCalls = 0;
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    mockCalls++;
    lastAuth = req.headers.authorization || '';
    if (mockStatus === 401 || mockStatus === 400) {
      res.writeHead(mockStatus, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: `invalid: ${lastAuth}` } }));
    }
    if (mockBadJson) {
      mockBadJson = false;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({
          model: 'mock-model',
          choices: [{ message: { content: 'ini bukan json' } }],
          usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
        }),
      );
    }
    const content = body.includes('JSON') ? '{"ok":true}' : 'pong';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        model: 'mock-model',
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      }),
    );
  });
});
await new Promise((r) => mock.listen(3197, r));

const testRows = [];
setUsageSink((row) => testRows.push(row));
const testResult = await testProvider({
  baseUrl: 'http://localhost:3197/v1',
  apiKey: 'secret-key',
  model: 'mock-model',
});
assert.equal(testResult.ok, true);
assert.equal(testResult.model, 'mock-model');
assert.equal(testResult.usage.totalTokens, 10);
assert.equal(lastAuth, 'Bearer secret-key');
assert.equal(testRows.at(-1).kind, 'test');
assert.equal(testRows.at(-1).totalTokens, 10);

await chatJson([{ role: 'user', content: 'balas JSON' }], { kind: 'reply' });
assert.equal(testRows.at(-1).kind, 'reply');

// Respons 200 non-JSON -> retry sekali tanpa JSON mode.
mockBadJson = true;
const beforeBadJson = mockCalls;
const retried = await chatJson([{ role: 'user', content: 'balas JSON' }], { kind: 'reply' });
assert.deepEqual(retried, { ok: true });
assert.equal(mockCalls - beforeBadJson, 2);

const textModel = 'text-model';
const visionModel = 'vision-model';
assert.equal(selectModel([{ role: 'user', content: 'halo' }], textModel, visionModel), textModel);
const imageMessages = [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'lihat ini' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
    ],
  },
];
assert.equal(selectModel(imageMessages, textModel, visionModel), visionModel);
assert.equal(
  selectModel(
    [{ role: 'user', content: [{ type: 'video_url', video_url: { url: 'https://x/v.mp4' } }] }],
    textModel,
    visionModel,
  ),
  visionModel,
);
assert.equal(selectModel(imageMessages, textModel, ''), textModel);
assert.equal(googleReasoningEffort('gemini-3.5-flash'), 'minimal');
assert.equal(googleReasoningEffort('gemini-3.1-flash-lite'), 'minimal');
assert.equal(googleReasoningEffort('gemini-3.8-flash'), 'low');
assert.equal(googleFallbackModel('gemini-3.1-flash-lite'), 'gemini-3.5-flash');
assert.equal(googleFallbackModel('gemini-3.5-flash'), 'gemini-3.1-flash-lite');

// Provider keyless: header Authorization tidak boleh dikirim kosong.
config.ai.apiKey = '';
await chatJson([{ role: 'user', content: 'balas JSON' }]);
assert.equal(lastAuth, '');
config.ai.apiKey = 'secret-key';

// Error provider tidak boleh membocorkan key ke message/body.
const secret = 'sk-super-secret-key-9999';
config.ai.baseUrl = 'http://localhost:3197/v1';
config.ai.apiKey = secret;
mockStatus = 401;
await assert.rejects(
  () => testProvider({ baseUrl: 'http://localhost:3197/v1', apiKey: secret, model: 'mock-model' }),
  (err) => {
    assert.equal(err.status, 401);
    assert.ok(!err.message.includes(secret), 'testProvider message membocorkan key');
    assert.ok(!String(err.body || '').includes(secret), 'testProvider body membocorkan key');
    return true;
  },
);
mockStatus = 400;
await assert.rejects(
  () => chatJson([{ role: 'user', content: 'balas JSON' }]),
  (err) => {
    assert.ok(!err.message.includes(secret), 'chatJson message membocorkan key');
    assert.ok(!String(err.body || '').includes(secret), 'chatJson body membocorkan key');
    return true;
  },
);
mockStatus = 200;
config.ai.apiKey = 'secret-key';

// Ganti host dengan key kosong: key lama tidak boleh ikut ke host baru.
config.ai.baseUrl = 'https://api.groq.com/openai/v1';
config.ai.apiKey = 'gsk-new-5678';
const tested = await settings.testSettings({
  baseUrl: 'http://localhost:3197/v1',
  model: 'mock-model',
  thinking: 'off',
  temperature: 1,
  maxTokens: 100,
});
assert.equal(tested.ok, true);
assert.equal(lastAuth, '');

mock.close();
console.log('✓ client: usage tercatat + testProvider');

try {
  db.close();
} catch {}
fs.rmSync(dir, { recursive: true, force: true });

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

process.env.DEMO_MODE = '1';
process.env.ADMIN_TOKEN = 'test-token';
process.env.WA_DISABLED = '1';

const { openDb, upsertContact } = await import('../src/db.js');
const { createServer } = await import('../src/server.js');

const dir = path.resolve('data-aiaccounttest');
fs.rmSync(dir, { recursive: true, force: true });
const db = openDb(dir);

const bus = new EventEmitter();
const wa = {
  snapshot: () => ({ status: 'disabled', qr: null, me: null, lastError: null, since: Date.now() }),
  sendText: async () => {},
  statusPrivacy: null,
};
const app = createServer({ db, wa, bus });
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const post = (pathname, body, cookie) =>
  fetch(base + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body || {}),
  });

async function register(email, name) {
  const res = await post('/api/public/auth/register', {
    name,
    email,
    password: 'rahasia123',
    acceptedTerms: true,
  });
  assert.equal(res.status, 200);
  return res.headers.getSetCookie()[0].split(';')[0];
}

const cookieA = await register('ai-a@example.com', 'Pemilik AI A');
const cookieB = await register('ai-b@example.com', 'Pemilik AI B');

// Akun baru belum punya key dan belum bisa memakai Coba Chat.
const statusA = await (await fetch(`${base}/api/status`, { headers: { cookie: cookieA } })).json();
assert.equal(statusA.aiReady, false);
const chatDenied = await post('/api/public/playground/chat', { message: 'halo' }, cookieA);
assert.equal(chatDenied.status, 400);
assert.match((await chatDenied.json()).error, /API key/i);

const settingsA = await (await fetch(`${base}/api/settings`, { headers: { cookie: cookieA } })).json();
assert.equal(settingsA.account, true);
assert.equal(settingsA.hasApiKey, false);

// Nama akun bisa diubah dan password bisa diganti.
const renamed = await fetch(`${base}/api/public/auth/profile`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', cookie: cookieA },
  body: JSON.stringify({ name: 'Nama Baru' }),
});
assert.equal(renamed.status, 200);
assert.equal((await renamed.json()).user.name, 'Nama Baru');
const changed = await post(
  '/api/public/auth/password',
  { currentPassword: 'rahasia123', newPassword: 'rahasia456' },
  cookieA,
);
assert.equal(changed.status, 200);
const relogin = await post('/api/public/auth/login', {
  email: 'ai-a@example.com',
  password: 'rahasia456',
});
assert.equal(relogin.status, 200);

// Simpan key milik akun A.
const saved = await fetch(`${base}/api/settings`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', cookie: cookieA },
  body: JSON.stringify({
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    apiKey: 'sk-test-account-a',
    temperature: 0.7,
    maxTokens: 1500,
    thinking: 'off',
  }),
});
assert.equal(saved.status, 200, await saved.clone().text());
const savedBody = await saved.json();
assert.equal(savedBody.hasApiKey, true);
assert.match(savedBody.apiKeyMasked, /sk-/);

const statusA2 = await (await fetch(`${base}/api/status`, { headers: { cookie: cookieA } })).json();
assert.equal(statusA2.aiReady, true);
assert.equal(statusA2.config.model, 'deepseek-chat');

// Akun B tetap tanpa key dan tidak bisa memakai key akun A.
const settingsB = await (await fetch(`${base}/api/settings`, { headers: { cookie: cookieB } })).json();
assert.equal(settingsB.hasApiKey, false);
const chatB = await post('/api/public/playground/chat', { message: 'halo' }, cookieB);
assert.equal(chatB.status, 400);

// Kontak baru langsung siap dibalas otomatis.
const contact = upsertContact(db, { jid: '628999@s.whatsapp.net', number: '628999', name: 'Pelanggan Baru' });
assert.equal(contact.mode, 'auto');

server.close();
db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('ai account ok');

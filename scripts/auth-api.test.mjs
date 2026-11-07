import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

process.env.DEMO_MODE = '1';
process.env.ADMIN_TOKEN = 'test-token';

const { openDb } = await import('../src/db.js');
const { createServer } = await import('../src/server.js');

const dir = path.resolve('data-authapitest');
fs.rmSync(dir, { recursive: true, force: true });
const db = openDb(dir);
const bus = new EventEmitter();
const wa = {
  snapshot: () => ({ status: 'disabled', qr: null, me: null, lastError: null, since: Date.now() }),
  sendText: async () => {},
  statusPrivacy: null,
};
const server = createServer({ db, wa, bus }).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

async function post(pathname, body, cookie) {
  return fetch(base + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

const noTerms = await post('/api/public/auth/register', {
  name: 'Tanpa Setuju',
  email: 'noterms@example.com',
  password: 'rahasia123',
});
assert.equal(noTerms.status, 400);

const register = await post('/api/public/auth/register', {
  name: 'Sari',
  email: 'sari@example.com',
  password: 'rahasia123',
  acceptedTerms: true,
});
assert.equal(register.status, 200);
const cookie = register.headers.getSetCookie()[0].split(';')[0];
assert.match(cookie, /tutur_session=/);

const me = await (await fetch(`${base}/api/public/auth/me`, { headers: { cookie } })).json();
assert.equal(me.user.email, 'sari@example.com');

const item = await post(
  '/api/products',
  { name: 'Nasi campur vegan', price: 35000, description: 'Bisa tidak pedas', category: 'Makanan', available: true },
  cookie,
);
assert.equal(item.status, 200, await item.clone().text());
const list = await (await fetch(`${base}/api/products`, { headers: { cookie } })).json();
assert.equal(list.products.length, 1);

const kb = await (await fetch(`${base}/api/knowledge`, { headers: { cookie } })).json();
assert.equal(kb.knowledge.length, 1);
assert.match(kb.knowledge[0].body, /35\.000/);

// Akun kedua tidak melihat produk akun pertama.
const second = await post('/api/public/auth/register', {
  name: 'Wayan',
  email: 'wayan@example.com',
  password: 'rahasia456',
  acceptedTerms: true,
});
const cookie2 = second.headers.getSetCookie()[0].split(';')[0];
const list2 = await (await fetch(`${base}/api/products`, { headers: { cookie: cookie2 } })).json();
assert.equal(list2.products.length, 0);
const kb2 = await (await fetch(`${base}/api/knowledge`, { headers: { cookie: cookie2 } })).json();
assert.equal(kb2.knowledge.length, 0);

// Login salah ditolak.
const bad = await post('/api/public/auth/login', { email: 'sari@example.com', password: 'salah' });
assert.equal(bad.status, 401);

const logout = await post('/api/public/auth/logout', {}, cookie);
assert.equal(logout.status, 200);

server.close();
db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('auth api ok');

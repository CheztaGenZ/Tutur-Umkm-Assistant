import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

process.env.DEMO_MODE = '1';
process.env.ADMIN_TOKEN = 'test-token';
process.env.WA_DISABLED = '1';

const { openDb } = await import('../src/db.js');
const { createServer } = await import('../src/server.js');

const dir = path.resolve('data-waownertest');
fs.rmSync(dir, { recursive: true, force: true });
const db = openDb(dir);

const bus = new EventEmitter();
const wa = {
  snapshot: () => ({
    status: 'open',
    qr: null,
    me: { number: '628111111111', name: 'Toko Uji' },
    lastError: null,
    since: Date.now(),
  }),
  sendText: async () => {},
  restartFresh: async () => {},
  start: async () => {},
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

const cookieA = await register('owner-a@example.com', 'Pemilik A');
const cookieB = await register('owner-b@example.com', 'Pemilik B');

// Profil usaha dipakai untuk memastikan data akun tetap terpisah.
for (const [cookie, name] of [
  [cookieA, 'Toko A'],
  [cookieB, 'Toko B'],
]) {
  const res = await post('/api/business', { name, category: 'Toko', contact: '0812' }, cookie);
  assert.equal(res.status, 200);
}

// Sebelum diklaim, nomor terlihat sebagai belum terikat dan data chat disembunyikan.
const statusA = await (await fetch(`${base}/api/status`, { headers: { cookie: cookieA } })).json();
assert.equal(statusA.wa.status, 'open');
assert.equal(statusA.wa.claimed, false);
assert.equal(statusA.wa.ownedByMe, true);
const contactsBefore = await (await fetch(`${base}/api/contacts`, { headers: { cookie: cookieA } })).json();
assert.deepEqual(contactsBefore, []);

// Akun A mengklaim nomor.
const claim = await post('/api/wa/claim', {}, cookieA);
assert.equal(claim.status, 200);

// Akun A adalah pemilik.
const statusA2 = await (await fetch(`${base}/api/status`, { headers: { cookie: cookieA } })).json();
assert.equal(statusA2.wa.claimed, true);
assert.equal(statusA2.wa.ownedByMe, true);

// Akun B tidak melihat nomor atau data chat akun A.
const statusB = await (await fetch(`${base}/api/status`, { headers: { cookie: cookieB } })).json();
assert.equal(statusB.wa.status, 'idle');
assert.equal(statusB.wa.claimed, true);
assert.equal(statusB.wa.ownedByMe, false);
assert.equal(statusB.sentToday, 0);
const contactsB = await (await fetch(`${base}/api/contacts`, { headers: { cookie: cookieB } })).json();
assert.deepEqual(contactsB, []);

// Akun B tidak bisa mengambil alih atau memutus nomor.
assert.equal((await post('/api/wa/claim', {}, cookieB)).status, 409);
assert.equal((await post('/api/wa/connect', {}, cookieB)).status, 409);
assert.equal((await post('/api/wa/logout', {}, cookieB)).status, 403);

// Pemilik bisa memutus, lalu nomor terbuka untuk klaim berikutnya.
assert.equal((await post('/api/wa/logout', {}, cookieA)).status, 200);

server.close();
db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('wa owner ok');

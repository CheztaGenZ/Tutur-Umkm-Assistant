import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

process.env.DEMO_MODE = '1';
process.env.ADMIN_TOKEN = 'test-token';
process.env.WA_DISABLED = '1';

const { openDb, upsertContact } = await import('../src/db.js');
const { createServer } = await import('../src/server.js');

const dir = path.resolve('data-multitenanttest');
fs.rmSync(dir, { recursive: true, force: true });
const db = openDb(dir);

// Manager tiruan: setiap akun punya snapshot sendiri.
const clients = new Map();
const started = [];
function fakeClient(number) {
  return {
    snapshot: () => ({
      status: 'open',
      qr: null,
      me: { number },
      lastError: null,
      since: Date.now(),
    }),
    statusPrivacy: null,
    start: async () => started.push(number),
    restartFresh: async () => started.push(`restart:${number}`),
  };
}

const fakeManager = {
  client(ownerId) {
    return clients.get(String(ownerId));
  },
  snapshot(ownerId) {
    return clients.get(String(ownerId)).snapshot();
  },
  start: async (ownerId) => clients.get(String(ownerId)).start(),
  restartFresh: async (ownerId) => clients.get(String(ownerId)).restartFresh(),
};

const bus = new EventEmitter();
const app = createServer({ db, wa: fakeManager, bus });
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
  const body = await res.json();
  return { cookie: res.headers.getSetCookie()[0].split(';')[0], user: body.user };
}

const a = await register('owner-a@example.com', 'Pemilik A');
const b = await register('owner-b@example.com', 'Pemilik B');

// Setiap akun melihat koneksi WhatsApp miliknya sendiri.
clients.set(a.user.id, fakeClient('628111111111'));
clients.set(b.user.id, fakeClient('628222222222'));
const statusA = await (await fetch(`${base}/api/status`, { headers: { cookie: a.cookie } })).json();
const statusB = await (await fetch(`${base}/api/status`, { headers: { cookie: b.cookie } })).json();
assert.equal(statusA.wa.me.number, '628111111111');
assert.equal(statusB.wa.me.number, '628222222222');

// Kontak dan draft terpisah per akun.
upsertContact(db, {
  ownerId: a.user.id,
  jid: '628999@s.whatsapp.net',
  number: '628999',
  name: 'Pelanggan A',
});
const contactsA = await (await fetch(`${base}/api/contacts`, { headers: { cookie: a.cookie } })).json();
const contactsB = await (await fetch(`${base}/api/contacts`, { headers: { cookie: b.cookie } })).json();
assert.equal(contactsA.length, 1);
assert.equal(contactsA[0].name, 'Pelanggan A');
assert.equal(contactsB.length, 0);

// Koneksi tiap akun tidak saling mengunci.
assert.equal((await post('/api/wa/connect', {}, a.cookie)).status, 200);
assert.equal((await post('/api/wa/connect', {}, b.cookie)).status, 200);
assert.deepEqual(started, ['628111111111', '628222222222']);

// Tidak ada lagi endpoint klaim nomor global.
assert.equal((await post('/api/wa/claim', {}, a.cookie)).status, 404);

server.close();
db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('multi tenant whatsapp ok');

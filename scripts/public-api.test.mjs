import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

process.env.DEMO_MODE = '1';
process.env.ADMIN_TOKEN = 'test-token';
process.env.WA_DISABLED = '1';

const { openDb, upsertKnowledge } = await import('../src/db.js');
const { createServer } = await import('../src/server.js');

const dir = path.resolve('data-publicapitest');
fs.rmSync(dir, { recursive: true, force: true });
const db = openDb(dir);
upsertKnowledge(db, {
  category: 'menu',
  title: 'Nasi campur vegan',
  body: 'Rp35.000',
  keywords: 'vegan',
});

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

const state = await fetch(`${base}/api/public/playground/state`);
assert.equal(state.status, 200);
const body = await state.json();
assert.equal(body.business.name, 'Sari Kitchen');
assert.ok(Array.isArray(body.personas) && body.personas.length >= 4);

const denied = await fetch(`${base}/api/knowledge`);
assert.equal(denied.status, 403);

const allowed = await fetch(`${base}/api/knowledge`, { headers: { 'x-admin-token': 'test-token' } });
assert.equal(allowed.status, 200);
const list = await allowed.json();
assert.equal(list.knowledge.length, 1);

const wrong = await fetch(`${base}/api/knowledge`, { headers: { 'x-admin-token': 'salah' } });
assert.equal(wrong.status, 403);

server.close();
db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('public api ok');

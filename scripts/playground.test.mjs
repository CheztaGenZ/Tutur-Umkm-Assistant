import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createPlayground } from '../src/playground.js';
import { decide } from '../src/policy.js';

const dir = path.resolve('data-playgroundtest');
fs.rmSync(dir, { recursive: true, force: true });
const db = openDb(dir);
const personaJid = 'demo-tourist@s.whatsapp.net';

const pg = createPlayground({
  db,
  decide,
  generateReply: async () => ({
    reply: 'Ada, 35k.',
    confidence: 0.9,
    reason: 'fakta dari menu',
    intent: 'tanya_fakta',
    needsOwner: false,
    knowledgeUsed: ['menu-vegan'],
  }),
});

const one = await pg.chat({ sessionId: 's1', ip: '1.1.1.1', personaJid, message: 'harga vegan?' });
assert.equal(one.reply, 'Ada, 35k.');
assert.equal(one.trace.action, 'auto');
assert.equal(one.trace.intent, 'tanya_fakta');

// giliran kedua memakai konteks
let seen = [];
const pg2 = createPlayground({
  db,
  decide,
  generateReply: async ({ messages }) => {
    seen = messages;
    return { reply: 'ok', confidence: 0.8, intent: 'obrolan' };
  },
});
await pg2.chat({ sessionId: 's2', ip: '1.1.1.1', personaJid, message: 'halo' });
await pg2.chat({ sessionId: 's2', ip: '1.1.1.1', personaJid, message: 'masih buka?' });
assert.equal(seen.filter((m) => m.direction === 'in').length, 2);
assert.equal(seen.filter((m) => m.direction === 'out').length, 1);

// rate limit per IP
for (let i = 0; i < 20; i++) {
  await pg2.chat({ sessionId: 's3', ip: '2.2.2.2', personaJid, message: 'x' });
}
const blocked = await pg2.chat({ sessionId: 's3', ip: '2.2.2.2', personaJid, message: 'x' });
assert.match(blocked.error, /terlalu banyak/i);

// provider gagal -> trace error, bukan throw
const pg3 = createPlayground({
  db,
  decide,
  generateReply: async () => {
    throw new Error('timeout');
  },
});
const failed = await pg3.chat({ sessionId: 's4', ip: '3.3.3.3', personaJid, message: 'halo' });
assert.match(failed.error, /timeout/);
assert.equal(failed.reply, null);
assert.ok(pg3.stats().sessions >= 1);

// eskalasi booking -> draft
const pg4 = createPlayground({
  db,
  decide,
  generateReply: async () => ({
    reply: 'Saya cek dulu ya.',
    confidence: 0.9,
    intent: 'booking',
    needsOwner: true,
    ownerReason: 'booking 6 orang',
  }),
});
const booking = await pg4.chat({ sessionId: 's5', ip: '4.4.4.4', personaJid, message: 'book a table' });
assert.equal(booking.trace.action, 'draft');
assert.match(booking.trace.policyReason, /pemilik/i);
assert.equal(booking.trace.needsOwner, true);

// batas pesan
const tooLong = await pg4.chat({ sessionId: 's6', ip: '4.4.4.4', personaJid, message: 'a'.repeat(1001) });
assert.match(tooLong.error, /1000|panjang/i);

db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('playground ok');

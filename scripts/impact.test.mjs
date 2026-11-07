import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openDb, recordPlaygroundEvent } from '../src/db.js';
import { createPlayground } from '../src/playground.js';
import { decide } from '../src/policy.js';

const dir = path.resolve('data-impacttest');
fs.rmSync(dir, { recursive: true, force: true });
const db = openDb(dir);

for (let i = 0; i < 4; i++) {
  recordPlaygroundEvent(db, { sessionHash: 's', intent: 'tanya_fakta', action: 'auto', needsOwner: false, latencyMs: 1000 });
}
recordPlaygroundEvent(db, { sessionHash: 's', intent: 'obrolan', action: 'draft', needsOwner: false, latencyMs: 2000 });
recordPlaygroundEvent(db, { sessionHash: 's', intent: 'booking', action: 'draft', needsOwner: true, latencyMs: 3000 });

const pg = createPlayground({ db, decide, generateReply: async () => ({ reply: null }) });
const m = pg.metrics();

assert.equal(m.messages, 6);
assert.equal(m.auto, 4);
assert.equal(m.escalated, 1);
assert.equal(m.simulatedDays, 0);
assert.equal(m.autoRate, Math.round((4 / 6) * 100));
assert.equal(m.ownerMinutesSaved, Math.round(4 * 1.5));
assert.equal(m.source, 'live');

db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('impact ok');

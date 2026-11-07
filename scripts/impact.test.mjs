import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openDb, recordPlaygroundEvent, kvSet } from '../src/db.js';
import { createPlayground } from '../src/playground.js';
import { decide } from '../src/policy.js';

const dir = path.resolve('data-impacttest');
fs.rmSync(dir, { recursive: true, force: true });
const db = openDb(dir);

kvSet(db, 'demo_baseline', JSON.stringify({ days: 30, messages: 420, auto: 350, escalated: 18 }));
for (let i = 0; i < 4; i++) {
  recordPlaygroundEvent(db, { sessionHash: 's', intent: 'tanya_fakta', action: 'auto', needsOwner: false, latencyMs: 1000 });
}
recordPlaygroundEvent(db, { sessionHash: 's', intent: 'obrolan', action: 'draft', needsOwner: false, latencyMs: 2000 });
recordPlaygroundEvent(db, { sessionHash: 's', intent: 'booking', action: 'draft', needsOwner: true, latencyMs: 3000 });

const pg = createPlayground({ db, decide, generateReply: async () => ({ reply: null }) });
const m = pg.metrics();

assert.equal(m.messages, 426);
assert.equal(m.auto, 354);
assert.equal(m.escalated, 19);
assert.equal(m.simulatedDays, 30);
assert.equal(m.autoRate, Math.round((354 / 426) * 100));
assert.equal(m.ownerMinutesSaved, Math.round(354 * 1.5));
assert.equal(m.source, 'simulated+live');

db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('impact ok');

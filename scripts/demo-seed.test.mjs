import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openDb, listKnowledge, getContact } from '../src/db.js';
import { seedDemo } from '../src/demo/seed.js';

const dir = path.resolve('data-demo-seedtest');
fs.rmSync(dir, { recursive: true, force: true });
const db = openDb(dir);

const first = seedDemo({ db });
assert.equal(first.knowledge >= 8, true);
assert.equal(first.contacts, 4);

const tourist = getContact(db, 'demo-tourist@s.whatsapp.net');
assert.equal(tourist.mode, 'auto');
assert.ok(tourist.style_profile);
assert.ok(JSON.parse(tourist.style_profile).notes.length > 0);

assert.equal(getContact(db, 'demo-guest@s.whatsapp.net').mode, 'draft');
assert.equal(getContact(db, 'demo-vip@s.whatsapp.net').mode, 'ignore');
assert.equal(getContact(db, 'demo-unknown@s.whatsapp.net'), null);

const second = seedDemo({ db });
assert.deepEqual(second, { contacts: 0, knowledge: 0, examples: 0 });
assert.equal(listKnowledge(db).length, first.knowledge);

db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('demo seed ok');

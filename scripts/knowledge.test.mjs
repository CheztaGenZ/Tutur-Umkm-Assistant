import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openDb, upsertKnowledge, listKnowledge, deleteKnowledge } from '../src/db.js';
import { searchKnowledge, formatKnowledgeBlock } from '../src/knowledge.js';

const dir = path.resolve('data-knowledgetest');
fs.rmSync(dir, { recursive: true, force: true });
const db = openDb(dir);

const menu = upsertKnowledge(db, {
  category: 'menu',
  title: 'Nasi campur vegan',
  body: 'Nasi campur vegan Rp35.000, tersedia setiap hari.',
  keywords: 'vegan, vegetarian, nasi campur, harga',
});
upsertKnowledge(db, {
  category: 'jam',
  title: 'Jam buka',
  body: 'Buka 08.00-21.00 WITA setiap hari.',
  keywords: 'jam, buka, tutup, open, close, hours',
});

assert.equal(listKnowledge(db).length, 2);
assert.equal(upsertKnowledge(db, { ...menu, body: 'Nasi campur vegan Rp35.000.' }).id, menu.id);
assert.equal(listKnowledge(db).length, 2);

const hit = searchKnowledge(listKnowledge(db), 'berapa harga nasi campur vegan?');
assert.equal(hit[0].title, 'Nasi campur vegan');
assert.match(formatKnowledgeBlock(hit), /Rp35\.000/);

assert.deepEqual(searchKnowledge(listKnowledge(db), 'apakah ada parkir bus besar?'), []);

const en = searchKnowledge(listKnowledge(db), 'what time do you close?');
assert.equal(en[0].title, 'Jam buka');

assert.equal(deleteKnowledge(db, menu.id), true);
assert.equal(listKnowledge(db).length, 1);

db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('knowledge ok');

import assert from 'node:assert/strict';
import { buildSystemPrompt, normalizeIntent } from '../src/ai/prompt.js';

const knowledge = [
  {
    id: 'menu-vegan',
    category: 'menu',
    title: 'Nasi campur vegan',
    body: 'Rp35.000, tersedia setiap hari.',
    keywords: 'vegan',
    active: 1,
  },
];

const withKb = buildSystemPrompt({
  meName: 'Sari',
  contactName: 'Turis',
  style: null,
  relationship: null,
  examples: [],
  knowledge,
});

assert.match(withKb, /SUMBER DATA BISNIS/);
assert.match(withKb, /Rp35\.000/);
assert.match(withKb, /JANGAN mengarang/);
assert.match(withKb, /menu-vegan/);
assert.match(withKb, /used_sources/);
assert.match(withKb, /needs_owner/);

const withoutKb = buildSystemPrompt({
  meName: 'Sari',
  contactName: 'Turis',
  style: null,
  relationship: null,
  examples: [],
  knowledge: [],
});
assert.equal(withoutKb.includes('SUMBER DATA BISNIS'), false);
assert.match(withoutKb, /used_sources/);

assert.equal(normalizeIntent('booking'), 'booking');
assert.equal(normalizeIntent('TANYA_FAKTA'), 'tanya_fakta');
assert.equal(normalizeIntent('halo apa kabar'), 'obrolan');
assert.equal(normalizeIntent(undefined), 'obrolan');

console.log('grounding ok');

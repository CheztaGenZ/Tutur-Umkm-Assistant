import assert from 'node:assert/strict';
import { buildSystemPrompt, normalizeIntent, applyIntentGuards, detectRiskyIntent } from '../src/ai/prompt.js';

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

const spam = applyIntentGuards({ intent: 'spam', needsOwner: false, reply: 'klik link' });
assert.equal(spam.reply, null);
assert.equal(spam.intent, 'spam');

const booking = applyIntentGuards({ intent: 'booking', needsOwner: false, reply: 'oke' });
assert.equal(booking.needsOwner, true);

const normal = applyIntentGuards({ intent: 'tanya_fakta', needsOwner: false, reply: '35k' });
assert.equal(normal.needsOwner, false);
assert.equal(normal.reply, '35k');

assert.equal(detectRiskyIntent('Can I book a table for 6 people?'), 'booking');
assert.equal(detectRiskyIntent('Mau reservasi 12 orang besok'), 'booking');
assert.equal(detectRiskyIntent('Kemarin pesanan saya telat satu jam'), 'komplain');
assert.equal(detectRiskyIntent('Berapa harga nasi campur?'), null);
assert.equal(detectRiskyIntent('pesan satu'), null);
assert.equal(detectRiskyIntent('mau pesan nasi goreng'), 'pesanan');

console.log('grounding ok');

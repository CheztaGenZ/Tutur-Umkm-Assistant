import assert from 'node:assert/strict';
import { decide, shouldAutoSend } from '../src/policy.js';

const base = {
  jid: '62811@s.whatsapp.net',
  contact: { mode: 'auto' },
  counts: { day: 0, hour: 0, contactToday: 0, lastContactSentAt: 0 },
  now: new Date('2026-11-07T12:00:00'),
};

assert.equal(decide(base).action, 'auto');

const esc = decide({ ...base, needsOwner: true, ownerReason: 'booking meja' });
assert.equal(esc.action, 'draft');
assert.match(esc.reason, /pemilik/i);
assert.match(esc.reason, /booking meja/);

const ignored = decide({
  ...base,
  jid: '123@g.us',
  needsOwner: true,
  ownerReason: 'booking meja',
});
assert.equal(ignored.action, 'ignore');

const quiet = decide({
  ...base,
  contact: { mode: 'ignore' },
  needsOwner: true,
});
assert.equal(quiet.action, 'ignore');

const spam = decide({ ...base, intent: 'spam' });
assert.equal(spam.action, 'ignore');
assert.match(spam.reason, /spam/i);

const spamDraft = decide({ ...base, contact: { mode: 'draft' }, intent: 'spam' });
assert.equal(spamDraft.action, 'ignore');

const auto = { action: 'auto' };
assert.equal(shouldAutoSend({ decision: auto, confidence: 0.9 }), true);
assert.equal(shouldAutoSend({ decision: auto, confidence: 0.9, needsOwner: true }), false);
assert.equal(shouldAutoSend({ decision: auto, confidence: 0.9, intent: 'spam' }), false);
assert.equal(shouldAutoSend({ decision: auto, confidence: 0.3 }), false);
assert.equal(shouldAutoSend({ decision: auto, confidence: 0.9, forceDraft: true }), false);

console.log('escalation ok');

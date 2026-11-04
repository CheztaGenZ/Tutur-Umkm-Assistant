/**
 * Tampilkan prompt PERSIS seperti yang dikirim ke model (tanpa memanggil AI).
 * Jalankan: npm run show-prompt -- "hangga" "krungu ra we?"
 */
import { openDb, listContacts, listExamples, recentMessages, getActiveActivity } from '../src/db.js';
import { config } from '../src/config.js';
import { pickStyle } from '../src/ingest/groupStyle.js';
import { buildSystemPrompt, buildUserPrompt } from '../src/ai/prompt.js';
import { glossFor } from '../src/ai/slang.js';

const [query, ...rest] = process.argv.slice(2);
const incoming = rest.join(' ').trim() || 'halo';

if (!query) {
  console.log('\n  Pakai: npm run show-prompt -- "nama kontak" "pesan"\n');
  process.exit(1);
}

const db = openDb(config.dataDir);
const contact = listContacts(db, query)[0];
if (!contact) {
  console.log(`\n  Kontak "${query}" tidak ditemukan.\n`);
  process.exit(1);
}

const register = contact.register === 'auto' ? 'temen' : contact.register;
const level =
  register === 'kasar' ? 'temen_dekat' : register === 'sopan' ? 'temen' : register;
const polite = level === 'keluarga' || level === 'wajib_sopan';

const rawStyle = pickStyle(db, contact);
const style =
  polite && rawStyle
    ? {
        ...rawStyle,
        notes: (rawStyle.notes || []).filter((n) => !/cok|asu|jancok/i.test(n)),
      }
    : rawStyle;

let examples = listExamples(db, contact.jid, config.style.fewShotCount);
if (polite) examples = examples.filter((e) => !/cok|asu|jancok/i.test(e.mine));

const history = recentMessages(db, contact.jid, 12);
const messages = [...history, { direction: 'in', body: incoming }];

const system = buildSystemPrompt({
  meName: config.me,
  contactName: contact.name,
  style,
  relationship: contact.relationship,
  examples,
  recentReplies: [],
  avoidPhrases: [],
  register,
  crudeExamples: [],
  alias: contact.alias,
  language: contact.language,
  maxBubbles: contact.burst || 3,
  memory: contact.memory,
  activity: getActiveActivity(db),
});

const user = buildUserPrompt({
  messages,
  contactName: contact.name,
  meName: config.me,
});

console.log('\n=========== SYSTEM PROMPT ===========\n');
console.log(system);
console.log('\n=========== USER PROMPT ===========\n');
console.log(user);
console.log('\n=========== GLOSS KATA ===========\n');
console.log(glossFor(incoming).join('\n') || '(tidak ada kata slang yang dikenali)');
console.log(`\n  Panjang prompt: ${system.length + user.length} karakter\n`);

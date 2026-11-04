/**
 * Simulasi: coba balasan untuk satu kontak TANPA mengirim apa pun ke WhatsApp.
 *
 * Jalankan: npm run simulate -- "mamah" "chesta udah makan?"
 */
import { openDb, listContacts, listExamples, recentMessages, getActiveActivity } from '../src/db.js';
import { config } from '../src/config.js';
import { decide, dayStart, hourStart, inQuietHours } from '../src/policy.js';
import { generateReply } from '../src/ai/prompt.js';
import { pickStyle } from '../src/ingest/groupStyle.js';
import { isCrude } from '../src/ingest/style.js';
import { SLANG } from '../src/ai/slang.js';

const [query, ...rest] = process.argv.slice(2);
const incoming = rest.join(' ').trim() || 'halo';

if (!query) {
  console.log('\n  Pakai: npm run simulate -- "nama kontak" "pesan yang masuk"\n');
  process.exit(1);
}

const db = openDb(config.dataDir);
const matches = listContacts(db, query);

if (!matches.length) {
  console.log(`\n  Tidak ada kontak yang cocok dengan "${query}".`);
  console.log('  Import dulu chat-nya di dashboard, atau cek nama di tab Kontak.\n');
  process.exit(1);
}

const contact = matches[0];
if (matches.length > 1) {
  console.log(`\n  ${matches.length} kontak cocok, dipakai yang pertama: ${contact.name}`);
}

const rawStyle = pickStyle(db, contact);
const isFamily = contact.register === 'keluarga';
const CRUDE = /\b(asu|cok|jancok|kontol|memek|matio|nolo|ngawur|babi|crot|gay|boti|tai)\b/i;

const style =
  isFamily && rawStyle
    ? {
        ...rawStyle,
        notes: (rawStyle.notes || []).filter((n) => !CRUDE.test(n)),
        examples: (rawStyle.examples || []).filter((e) => !CRUDE.test(e)),
        stats: {
          ...rawStyle.stats,
          topSlang: (rawStyle.stats?.topSlang || []).filter(([w]) => !CRUDE.test(w)),
        },
      }
    : rawStyle;

let examples = listExamples(db, contact.jid, config.style.fewShotCount);
if (isFamily) examples = examples.filter((e) => !CRUDE.test(e.mine) && !CRUDE.test(e.their));
const history = recentMessages(db, contact.jid, 30);
const recentReplies = db
  .prepare(
    "SELECT body FROM messages WHERE jid = ? AND direction = 'out' AND body != '[stiker]' ORDER BY ts DESC LIMIT 8",
  )
  .all(contact.jid)
  .map((r) => r.body);

// Frasa 3 kata yang sudah dipakai >= 2 kali -> dilarang lagi.
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const shingles = (text, n = 3) => {
  const w = norm(text).split(' ').filter(Boolean);
  const out = new Set();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
};
const counts = new Map();
for (const t of recentReplies) for (const s of shingles(t)) counts.set(s, (counts.get(s) || 0) + 1);
const register = contact.register === 'auto' ? 'sopan' : contact.register || 'sopan';
const crudeExamples = examples.filter((e) => isCrude(e.mine)).slice(0, 6).map((e) => e.mine);
const banned = [...counts.entries()]
  .filter(([, c]) => c >= 2)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .map(([p]) => p);

console.log('');
console.log(`  Kontak    : ${contact.name} (${contact.mode})`);
console.log(`  Sampel    : ${contact.sample_count} pesan · ${examples.length} contoh`);
if (banned.length) console.log(`  Frasa dilarang: ${banned.slice(0, 5).join(' | ')}`);
console.log(`  Pesan masuk: ${incoming}`);
if (inQuietHours(new Date())) {
  console.log('  ⚠ Sekarang jam tenang — balasan otomatis akan diblokir.');
}

const decision = decide({
  jid: contact.jid,
  contact,
  paused: false,
  counts: {
    day: 0,
    hour: 0,
    contactToday: 0,
    lastContactSentAt: 0,
  },
});

const belumTersambung = String(contact.jid).startsWith('name:');
if (belumTersambung) {
  console.log('  Catatan   : kontak ini belum terhubung ke nomor WhatsApp (menunggu pesan pertama).');
}

const result = await generateReply({
  meName: config.me,
  contactName: contact.name,
  style,
  relationship: contact.relationship,
  examples,
  messages: [...history, { direction: 'in', body: incoming }],
  recentReplies,
  avoidPhrases: banned,
  register,
  crudeExamples,
  alias: contact.alias,
  language: contact.language,
  memory: contact.memory,
  activity: getActiveActivity(db),
});

// Sama seperti di produksi: kalau kepanjangan, minta versi pendek.
const wc = (s) => String(s || '').split(/\s+/).filter(Boolean).length;
let final = result;
if (final.reply && wc(final.reply) > 10) {
  const short = await generateReply({
    meName: config.me,
    contactName: contact.name,
    style,
    relationship: contact.relationship,
    examples,
    messages: [...history, { direction: 'in', body: incoming }],
    recentReplies: [...recentReplies, final.reply],
    avoidPhrases: banned,
    strictShort: true,
    register,
    crudeExamples,
  });
  if (short.reply && wc(short.reply) < wc(final.reply)) final = short;
}

// Sama seperti produksi: jangan pura-pura tidak paham kata yang dia pakai.
const inWords = new Set(
  String(incoming)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean),
);
const echoed = Object.keys(SLANG).find(
  (w) => inWords.has(w) && new RegExp(`\\b${w}\\s+(opo|apa)\\b`, 'i').test(final.reply || ''),
);
if (echoed) {
  const alt = await generateReply({
    meName: config.me,
    contactName: contact.name,
    style,
    relationship: contact.relationship,
    examples,
    messages: [...history, { direction: 'in', body: incoming }],
    recentReplies: [...recentReplies, final.reply],
    avoidPhrases: banned,
    strictShort: true,
    register,
    crudeExamples,
    extraHint: `Kamu paham "${echoed}" artinya ${SLANG[echoed]}. Balas sesuai maksudnya, jangan pura-pura tidak paham.`,
  });
  if (alt.reply) final = alt;
}

console.log('');
console.log(`  Balasan   : ${final.reply ?? '(memilih tidak membalas)'}`);
console.log(`  Confidence: ${final.confidence.toFixed(2)}`);
if (final.sticker) console.log(`  Stiker    : ${final.sticker}`);
console.log(`  Alasan    : ${final.reason}`);
console.log('');

const wouldAuto =
  decision.action === 'auto' && final.confidence >= config.safety.autoConfidenceMin;
console.log(
  `  Kalau pesan ini benar-benar masuk: ${
    !final.reply
      ? 'tidak dibalas (AI menilai tidak perlu)'
      : belumTersambung
        ? 'menunggu kontak terhubung dulu (belum ada pesan masuk dari dia)'
        : wouldAuto
          ? 'LANGSUNG DIKIRIM (mode auto)'
          : `masuk DRAFT (\${
              decision.action === 'auto' ? 'confidence di bawah ambang' : decision.reason
            })`
  }`,
);
console.log('');

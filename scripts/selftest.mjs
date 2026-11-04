/**
 * Tes offline untuk logika inti: parser export, analisis gaya, dan kebijakan balas.
 * Jalankan: node scripts/selftest.mjs
 */
import assert from 'node:assert/strict';
import { parseExport, buildPairs } from '../src/ingest/parseExport.js';
import { analyzeStyle } from '../src/ingest/style.js';
import { decide, inQuietHours, isVip } from '../src/policy.js';
import { config } from '../src/config.js';
import { splitBubbles } from '../src/wa/bubbles.js';
import { glossFor } from '../src/ai/slang.js';

function testSlang() {
  const g = glossFor('Woo asu ben to, gak trimo we?');
  const joined = g.join(' ');
  assert.ok(joined.includes('trimo'), 'trimo harus dikenali');
  assert.ok(joined.includes('ben'), 'ben harus dikenali');
  assert.ok(joined.includes('we'), 'we harus dikenali');

  const none = glossFor('halo selamat pagi');
  assert.equal(none.length, 0, 'kalimat biasa tidak perlu gloss');

  console.log(`✓ slang: ${g.length} kata dikenali (${g.map((x) => x.split(' ')[0]).join(', ')})`);
}

function testBubbles() {
  const fixed = (v) => () => v;

  assert.deepEqual(
    splitBubbles('aku chesta cok, lali no', fixed(0.1)),
    ['aku chesta cok', 'lali no'],
    'kalimat berkoma harus bisa dipecah',
  );
  assert.deepEqual(splitBubbles('yoo', fixed(0.9)), ['yoo'], 'kata pendek tidak dipecah');
  assert.deepEqual(
    splitBubbles('satu. dua', fixed(0.6)),
    ['satu', 'dua'],
    'dua kalimat bisa jadi dua bubble',
  );
  assert.deepEqual(
    splitBubbles('a b c d e f', fixed(0.2)),
    ['a b c', 'd e f'],
    'kalimat tanpa koma dipecah di tengah',
  );
  assert.deepEqual(splitBubbles('', fixed(0.5)), [''], 'input kosong aman');

  // Semua hasil tidak boleh kehilangan kata (tanda baca boleh hilang).
  const text = 'yo idaaaaa, koe iki piye sih';
  const strip = (s) => String(s).replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ').trim();
  const joined = strip(splitBubbles(text, fixed(0.1)).join(' '));
  assert.equal(joined, strip(text), 'isi kalimat tidak boleh hilang');

  console.log('✓ bubble: pemecahan mengikuti koma/kalimat, isi tidak berubah');
}

const SAMPLE = `12/03/24 09.01 - Budi: bro jadi ga nih meetingnya
12/03/24 09.02 - Aku: jadi
12/03/24 09.02 - Aku: jam 2 ya
12/03/24 09.05 - Budi: oke sip
12/03/24 09.06 - Aku: otw nanti gue kabarin
12/03/24 10.11 - Budi: itu file udah dikirim belum?
12/03/24 10.15 - Aku: blm wkwk
12/03/24 10.15 - Aku: nanti sore gue kirim
12/03/24 10.20 - Budi: oke
12/03/24 11.00 - Budi: btw kemarin lo jadi ke bandung?
12/03/24 11.02 - Aku: jadi dong
12/03/24 11.02 - Aku: seru bgt asli
12/03/24 11.03 - Budi: wkwk enak aja
12/03/24 11.05 - Aku: kapan2 ikut lah
12/03/24 11.30 - Budi: nanti gue kabarin
12/03/24 11.31 - Aku: siap
12/03/24 12.00 - Budi: eh lo tau harga tiket nya ga
12/03/24 12.02 - Aku: ga tau tuh
12/03/24 12.02 - Aku: cek aja di app
12/03/24 12.10 - Budi: oke nanti gue cek
12/03/24 12.11 - Aku: sip
12/03/24 13.00 - Budi: btw makasih ya kemarin
12/03/24 13.05 - Aku: gpp santai
12/03/24 13.06 - Aku: kapan2 ngopi lagi
12/03/24 13.07 - Budi: boleh tuh
12/03/24 13.08 - Aku: okey
12/03/24 13.09 - Aku: gue lanjut kerja dulu ya
12/03/24 14.00 - Budi: semangat
12/03/24 14.01 - Aku: 🤣🤣 oke

[12/03/24, 15.00.00] Sari: ini format iOS juga kebaca kan
[12/03/24, 15.01.00] Aku: kebaca kok

12/03/24 15.10 - Budi: pesan ini
dilanjut di baris kedua
12/03/24 15.11 - Aku: iya kebaca

[31/03/24, 2.30.05 PM] Budi: jam segini masih kerja?
[31/03/24, 9.05.00 AM] Aku: iya nih
[31/03/24, 12.15.00 PM] Aku: makan siang dulu
[31/03/24, 12.40.10 AM] Budi: loh masih bangun`;

function testParse() {
  const parsed = parseExport(SAMPLE, { meName: 'Aku' });
  const budi = parsed.messages.filter((m) => m.author === 'Budi').length;
  const mine = parsed.messages.filter((m) => m.author === 'Aku').length;
  assert.ok(budi > 10, `pesan Budi harus banyak, dapat ${budi}`);
  assert.ok(mine > 10, `pesan Aku harus banyak, dapat ${mine}`);

  // multi-line ikut tergabung
  const multi = parsed.messages.find((m) => m.text.includes('dilanjut'));
  assert.ok(multi, 'pesan multi-line harus tergabung');
  assert.ok(multi.text.includes('baris kedua'));

  // format iOS kebaca
  assert.ok(parsed.messages.some((m) => m.author === 'Sari'), 'format iOS harus terdeteksi');

  // sistem message tidak masuk
  assert.ok(!parsed.messages.some((m) => /end-to-end encrypted/i.test(m.text)));

  // format 12 jam (AM/PM) — nama tidak boleh ketempelan "PM]"
  assert.ok(
    parsed.authors.every((a) => !/(AM|PM)\]/.test(a.name)),
    'nama author tidak boleh mengandung AM]/PM]',
  );
  const pm = parsed.messages.find((m) => m.text.includes('masih kerja'));
  assert.ok(pm, 'pesan format 12 jam harus terbaca');
  assert.equal(new Date(pm.ts).getHours(), 14, 'jam 2.30 PM harus jadi 14:30');
  const noon = parsed.messages.find((m) => m.text.includes('makan siang'));
  assert.equal(new Date(noon.ts).getHours(), 12, 'jam 12.15 PM harus tetap 12');
  const midnight = parsed.messages.find((m) => m.text.includes('masih bangun'));
  assert.equal(new Date(midnight.ts).getHours(), 0, 'jam 12.40 AM harus jadi 00:40');

  const pairs = buildPairs(parsed.messages, 'Aku');
  assert.ok(pairs.length >= 8, `harus dapat pasangan chat, dapat ${pairs.length}`);
  assert.ok(pairs.every((p) => p.their && p.mine));

  console.log(`✓ parser: ${parsed.messages.length} pesan, ${pairs.length} pasangan, ${parsed.authors.length} author`);
}

function testStyle() {
  const parsed = parseExport(SAMPLE, { meName: 'Aku' });
  const mine = parsed.messages.filter((m) => m.author === 'Aku').map((m) => m.text);
  const style = analyzeStyle(mine);

  assert.ok(style.sampleSize === mine.length);
  assert.ok(style.notes.length >= 4, 'harus menghasilkan catatan gaya');
  assert.ok(style.notes.some((n) => /huruf kecil/i.test(n)));
  assert.ok(style.notes.some((n) => /emoji/i.test(n)));
  assert.ok(style.stats.medLen > 0);

  // kosakata khas harus menangkap singkatan
  const slang = style.stats.topSlang.map(([t]) => t);
  assert.ok(slang.some((t) => ['wkwk', 'bgt', 'gpp', 'blm', 'otw', 'sip'].includes(t)), `slang: ${slang.join(',')}`);

  const empty = analyzeStyle([]);
  assert.equal(empty, null, 'input kosong harus aman');

  console.log(`✓ style: ${style.sampleSize} sampel, median ${style.stats.medLen} char, slang: ${slang.slice(0, 6).join(', ')}`);
}

function testPolicy() {
  // Jangan bergantung pada isi .env (mis. QUIET_HOURS=off saat mengetes).
  const originalQuiet = config.safety.quietHours;
  config.safety.quietHours = '01:00-07:00';

  const auto = { jid: '62811@s.whatsapp.net', number: '62811', mode: 'auto' };
  const draft = { jid: '62822@s.whatsapp.net', number: '62822', mode: 'draft' };
  const blocked = { jid: '62833@s.whatsapp.net', number: '62833', mode: 'ignore' };
  const normal = new Date(2026, 9, 30, 14, 0); // 14:00, di luar jam tenang
  const safe = { day: 0, hour: 0, contactToday: 0, lastContactSentAt: 0 };

  // grup tidak pernah dibalas
  assert.equal(decide({ jid: '123@g.us', contact: auto, counts: safe, now: normal }).action, 'ignore');

  // status & channel
  assert.equal(decide({ jid: 'status@broadcast', contact: auto, now: normal }).action, 'ignore');
  assert.equal(decide({ jid: '123@newsletter', contact: auto, now: normal }).action, 'ignore');

  // kontak "jangan" -> diam mutlak, walau mode lain apa pun
  assert.equal(decide({ jid: blocked.jid, contact: blocked, counts: safe, now: normal }).action, 'ignore');

  // kontak draft -> draft
  assert.equal(decide({ jid: draft.jid, contact: draft, counts: safe, now: normal }).action, 'draft');

  // belum dikenal -> draft, bukan auto
  assert.equal(decide({ jid: '62899@s.whatsapp.net', contact: null, now: normal }).action, 'draft');

  // auto normal -> auto
  assert.equal(decide({ jid: auto.jid, contact: auto, counts: safe, now: normal }).action, 'auto');

  // batas harian -> turun jadi draft
  assert.equal(
    decide({ jid: auto.jid, contact: auto, counts: { ...safe, day: config.safety.maxPerDay }, now: normal }).action,
    'draft',
  );

  // batas per jam
  assert.equal(
    decide({ jid: auto.jid, contact: auto, counts: { ...safe, hour: config.safety.maxPerHour }, now: normal }).action,
    'draft',
  );

  // jeda per kontak belum lewat -> draft (tidak hilang, tidak dikirim)
  assert.equal(
    decide({ jid: auto.jid, contact: auto, counts: { ...safe, lastContactSentAt: normal.getTime() - 5000 }, now: normal }).action,
    'draft',
  );

  // jeda sudah lewat -> auto
  assert.equal(
    decide({
      jid: auto.jid,
      contact: auto,
      counts: { ...safe, lastContactSentAt: normal.getTime() - (config.safety.minGapPerContactSec + 10) * 1000 },
      now: normal,
    }).action,
    'auto',
  );

  // dijeda global
  assert.equal(decide({ jid: auto.jid, contact: auto, paused: true, counts: safe, now: normal }).action, 'ignore');

  // jam tenang
  const night = new Date(2026, 9, 30, 3, 0);
  assert.equal(inQuietHours(night, '01:00-07:00'), true);
  assert.equal(inQuietHours(normal, '01:00-07:00'), false);
  assert.equal(inQuietHours(new Date(2026, 9, 30, 23, 0), '22:00-07:00'), true, 'rentang lewat tengah malam');
  assert.equal(decide({ jid: auto.jid, contact: auto, counts: safe, now: night }).action, 'ignore');

  // VIP dari env
  const vip = { ...auto, number: '628777' };
  const before = config.vip.slice();
  config.vip.push('628777');
  assert.equal(isVip(vip), true);
  assert.equal(decide({ jid: vip.jid, contact: vip, counts: safe, now: normal }).action, 'ignore');
  config.vip.length = 0;
  config.vip.push(...before);

  config.safety.quietHours = originalQuiet;

  console.log('✓ policy: grup/status/jangan/draft/auto/batas/jeda/jam-tenang/VIP semua sesuai');
}

testParse();
testStyle();
testBubbles();
testSlang();
testPolicy();
console.log('\nSemua tes lulus.');

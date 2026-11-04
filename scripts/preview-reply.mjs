/**
 * Coba hasil balasan tanpa WhatsApp: melatih gaya dari contoh chat,
 * lalu minta AI membalas satu pesan.
 *
 * Jalankan: node scripts/preview-reply.mjs "pesan yang mau dibalas"
 */
import { config } from '../src/config.js';
import { analyzeStyle } from '../src/ingest/style.js';
import { generateReply } from '../src/ai/prompt.js';

const SAMPLE_MY_MESSAGES = [
  'jadi',
  'jam 2 ya',
  'otw nanti gue kabarin',
  'blm wkwk',
  'nanti sore gue kirim',
  'jadi dong',
  'seru bgt asli',
  'kapan2 ikut lah',
  'siap',
  'ga tau tuh',
  'cek aja di app',
  'sip',
  'gpp santai',
  'kapan2 ngopi lagi',
  'okey',
  'gue lanjut kerja dulu ya',
  'oke',
];

const incoming = process.argv.slice(2).join(' ') || 'bro nanti jadi ga?';

const style = analyzeStyle(SAMPLE_MY_MESSAGES);

console.log('\n  Gaya yang terbaca:');
for (const n of style.notes) console.log('   • ' + n);

console.log(`\n  Pesan masuk : ${incoming}`);

const result = await generateReply({
  meName: config.me,
  contactName: 'Budi',
  style,
  relationship: 'Teman dekat, santai, sering bahas kerjaan dan jalan-jalan. Tidak perlu sopan formal.',
  examples: [
    { their: 'itu file udah dikirim belum?', mine: 'blm wkwk' },
    { their: 'btw kemarin lo jadi ke bandung?', mine: 'jadi dong' },
  ],
  messages: [{ direction: 'in', body: incoming }],
});

console.log(`  Balasan AI  : ${result.reply ?? '(memilih tidak membalas)'}`);
console.log(`  Confidence  : ${result.confidence.toFixed(2)}`);
console.log(`  Alasan      : ${result.reason}`);
console.log('');

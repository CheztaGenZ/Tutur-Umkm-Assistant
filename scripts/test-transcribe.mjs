/**
 * Tes transkrip pesan suara.
 * Jalankan: npm run test-transcribe -- "path\suara.ogg"
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { transcribeAudio, transcribeReady } from '../src/ai/transcribe.js';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.log('\n  Pakai: npm run test-transcribe -- "path\\suara.ogg"\n');
  process.exit(1);
}

const remote = Boolean(config.ai.transcribeUrl && config.ai.transcribeKey);
console.log('');
console.log(`  File     : ${path.basename(file)} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
console.log(`  Metode   : ${remote ? `online (${config.ai.transcribeModel})` : `lokal (${config.ai.transcribeModelLocal})`}`);
console.log(`  Siap     : ${transcribeReady()}`);
if (!remote) console.log('  Catatan  : model lokal diunduh sekali saat pertama dipakai (~150 MB).');
console.log('');

const started = Date.now();
try {
  const text = await transcribeAudio(fs.readFileSync(file), 'audio/ogg');
  console.log(`  ✓ ${((Date.now() - started) / 1000).toFixed(1)} detik`);
  console.log(`  Hasil   : ${text || '(kosong)'}`);
  console.log('');
} catch (err) {
  console.log(`  ✗ Gagal: ${err.message}\n`);
  process.exit(1);
}

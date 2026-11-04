/**
 * Tes kemampuan lihat gambar.
 * Jalankan: node scripts/test-vision.mjs "path\gambar.jpg" "pertanyaan"
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { chatJson } from '../src/ai/client.js';

const file = process.argv[2];
const question = process.argv[3] || 'Gambar ini isinya apa? Jawab singkat dalam bahasa Indonesia.';

if (!file || !fs.existsSync(file)) {
  console.log('\n  Pakai: node scripts/test-vision.mjs "path\\gambar.jpg"\n');
  process.exit(1);
}

const ext = path.extname(file).toLowerCase();
const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
const dataUrl = `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;

console.log(`\n  Model   : ${config.ai.model}`);
console.log(`  Gambar  : ${path.basename(file)} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
console.log(`  Ukuran base64: ${Math.round(dataUrl.length / 1024)} KB\n`);

const started = Date.now();
try {
  const out = await chatJson(
    [
      { role: 'system', content: 'Kamu mengamati gambar. Balas HANYA JSON.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: `${question}\nBalas JSON: {"deskripsi": "..."}` },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    { temperature: 0.2 },
  );
  console.log(`  ✓ ${Date.now() - started} ms`);
  console.log(`  Jawaban: ${JSON.stringify(out)}\n`);
} catch (err) {
  console.log(`  ✗ Gagal: ${err.message}\n`);
  process.exit(1);
}

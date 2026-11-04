/**
 * Ubah gambar jadi stiker WhatsApp (.webp) + deskripsi isinya.
 *
 * Jalankan: npm run import-stickers
 *           npm run import-stickers -- "C:\path\folder"
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { chatJson } from '../src/ai/client.js';
import { config } from '../src/config.js';

const require = createRequire(import.meta.url);
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

const srcDir = process.argv[2] || 'C:\\Users\\Chezta\\Documents\\stiker';
const outDir = path.resolve(config.stickers.dir);
const catalogPath = path.join(outDir, 'catalog.json');

fs.mkdirSync(outDir, { recursive: true });

const catalog = fs.existsSync(catalogPath)
  ? JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  : {};

const IMG = /\.(jpe?g|png|webp|gif)$/i;
const files = fs.readdirSync(srcDir).filter((f) => IMG.test(f));

function convert(input, output) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      input,
      '-vf',
      'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white',
      '-c:v',
      'libwebp',
      '-quality',
      '82',
      '-loop',
      '0',
      '-an',
      output,
    ]);
    const errs = [];
    proc.stderr.on('data', (c) => errs.push(c));
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(Buffer.concat(errs).toString().slice(0, 200))),
    );
  });
}

async function describe(file) {
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const dataUrl = `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;

  const out = await chatJson(
    [
      {
        role: 'system',
        content:
          'Kamu mengamati gambar stiker WhatsApp. Balas HANYA JSON valid dengan {"deskripsi": "..."}.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Deskripsikan stiker ini dalam 8-15 kata bahasa Indonesia. Sebutkan objek, ekspresi, dan teks yang tertulis. Fokus pada apa yang lucu atau menonjol, supaya bisa dipilih sesuai konteks obrolan.',
          },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    { temperature: 0.2 },
  );

  return String(out.deskripsi || '').trim().slice(0, 160);
}

console.log(`\n  ${files.length} gambar ditemukan\n`);

for (const file of files) {
  const abs = path.join(srcDir, file);
  const hash = crypto.createHash('md5').update(fs.readFileSync(abs)).digest('hex').slice(0, 12);
  const name = `${hash}.webp`;
  const out = path.join(outDir, name);

  if (!fs.existsSync(out)) {
    try {
      await convert(abs, out);
      console.log(`  ✓ ${file} → ${name}`);
    } catch (err) {
      console.log(`  ✗ ${file}: ${err.message}`);
      continue;
    }
  } else {
    console.log(`  = ${file} sudah ada (${name})`);
  }

  if (!catalog[name]?.desc) {
    try {
      const desc = await describe(abs);
      catalog[name] = { desc, source: file };
      console.log(`     deskripsi: ${desc}`);
    } catch (err) {
      catalog[name] = { desc: 'stiker tanpa deskripsi', source: file };
      console.log(`     deskripsi gagal: ${err.message}`);
    }
  }
}

fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
console.log(`\n  ${Object.keys(catalog).length} stiker di katalog.\n`);

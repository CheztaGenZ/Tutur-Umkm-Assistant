/**
 * Import langsung dari terminal (tanpa buka browser).
 * Server harus sedang jalan.
 *
 * Jalankan: npm run import-file -- "C:\Users\...\Mamah.zip"
 *           npm run import-file -- "Ayah new.zip" "Mamah.zip" --me "Chesta"
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';

const base = process.env.BASE_URL || `http://localhost:${config.port}`;
const args = process.argv.slice(2);

let meName = config.me;
const meIdx = args.indexOf('--me');
if (meIdx !== -1) {
  meName = args[meIdx + 1];
  args.splice(meIdx, 2);
}

const files = args.filter((a) => fs.existsSync(a));
if (!files.length) {
  console.log('\n  Pakai: npm run import-file -- "file.zip" ["file2.zip" ...] [--me "Nama"]\n');
  process.exit(1);
}

async function post(url, body) {
  const res = await fetch(base + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/** Tebak "aku": cocokkan nama konfigurasi, lalu "Anda"/"You", lalu terbanyak. */
function pickMe(authors) {
  const norm = (s) => String(s).toLowerCase().trim();
  const byConfig = authors.find((a) => norm(a.name) === norm(meName));
  if (byConfig) return byConfig.name;
  const generic = authors.find((a) => ['anda', 'you', 'kamu'].includes(norm(a.name)));
  if (generic) return generic.name;
  return [...authors].sort((a, b) => b.count - a.count)[0]?.name;
}

for (const file of files) {
  const name = path.basename(file);
  console.log(`\n  ${name}`);

  let docs = [];
  if (/\.zip$/i.test(file)) {
    const b64 = fs.readFileSync(file).toString('base64');
    const res = await post('/api/ingest/unzip', { file: b64 });
    docs = res.files;
    console.log(`   zip berisi ${docs.length} file teks`);
  } else {
    docs = [{ name, raw: fs.readFileSync(file, 'utf8') }];
  }

  for (const doc of docs) {
    try {
      const preview = await post('/api/ingest/preview', { raw: doc.raw });
      if (!preview.total) {
        console.log(`   ✗ ${doc.name}: tidak ada pesan terbaca`);
        continue;
      }
      const me = pickMe(preview.authors);
      const others = preview.authors.filter((a) => a.name !== me);
      if (!others.length) {
        console.log(`   ✗ ${doc.name}: tidak ada lawan bicara`);
        continue;
      }
      const contact = others.sort((a, b) => b.count - a.count)[0].name;

      const r = await post('/api/ingest', {
        raw: doc.raw,
        meName: me,
        contactName: contact,
      });
      const label = r.group ? `grup ${contact} (latihan gaya)` : contact;
      console.log(`   ✓ ${label}: ${r.myMessages} pesanmu, ${r.pairs} pasangan (kamu = "${me}")`);
    } catch (err) {
      console.log(`   ✗ ${doc.name}: ${err.message}`);
    }
  }
}

console.log('');

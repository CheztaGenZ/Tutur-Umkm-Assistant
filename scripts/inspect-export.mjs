/**
 * Diagnosa file export WhatsApp (zip atau txt).
 * Jalankan: node scripts/inspect-export.mjs "file.zip" ["file2.zip" ...]
 */
import fs from 'node:fs';
import AdmZip from 'adm-zip';
import { parseExport } from '../src/ingest/parseExport.js';

const args = process.argv.slice(2);
if (!args.length) {
  console.log('\n  Pakai: node scripts/inspect-export.mjs "path\\file.zip" ["folder"]\n');
  process.exit(1);
}

// Kalau diberi folder, cek semua .zip di dalamnya.
const files = [];
for (const a of args) {
  if (fs.existsSync(a) && fs.statSync(a).isDirectory()) {
    for (const f of fs.readdirSync(a)) {
      if (/\.zip$/i.test(f)) files.push(`${a}\\${f}`);
    }
  } else {
    files.push(a);
  }
}

const brief = files.length > 1;

function readDoc(file) {
  if (/\.zip$/i.test(file)) {
    const zip = new AdmZip(fs.readFileSync(file));
    const entries = zip.getEntries();
    const txt = entries.filter((e) => !e.isDirectory && /\.txt$/i.test(e.entryName));
    if (!txt.length) return null;
    return { raw: txt[0].getData().toString('utf8'), label: txt[0].entryName, entries };
  }
  return { raw: fs.readFileSync(file, 'utf8'), label: file, entries: [] };
}

for (const file of files) {
  let doc;
  try {
    doc = readDoc(file);
  } catch {
    continue; // bukan zip yang bisa dibaca / file rusak
  }
  if (!doc) continue;

  const parsed = parseExport(doc.raw, { meName: null });
  if (!parsed.messages.length) continue; // bukan export chat WhatsApp

  if (brief) {
    const names = parsed.authors.map((a) => `${a.name}(${a.count})`).join(', ');
    const kind = parsed.authors.length > 2 ? 'GRUP?' : '1-on-1';
    console.log(
      `${file.split('\\').pop().padEnd(34)} ${String(parsed.messages.length).padStart(6)} pesan | ${kind.padEnd(6)} | ${names.slice(0, 90)}`,
    );
    continue;
  }

  console.log(`\n  File    : ${doc.label}`);
  console.log(`  Ukuran  : ${doc.raw.length} karakter`);
  console.log('\n  --- 20 baris pertama ---');
  console.log(
    doc.raw
      .split('\n')
      .slice(0, 20)
      .map((l) => '  ' + l.slice(0, 150))
      .join('\n'),
  );
  console.log('\n  --- Hasil parse ---');
  console.log(`  Pesan terbaca : ${parsed.messages.length}`);
  console.log(`  Terdeteksi "aku": ${parsed.detectedMe}`);
  for (const a of parsed.authors.slice(0, 15)) console.log(`   - ${a.name} → ${a.count} pesan`);

  const myName = parsed.detectedMe;
  if (myName) {
    const mine = parsed.messages.filter((m) => m.author === myName);
    console.log(`\n  Kalau "${myName}" = kamu: ${mine.length} pesanmu`);
    console.log('  Contoh pesanmu:');
    for (const m of mine.slice(0, 6)) console.log(`   > ${m.text.slice(0, 100)}`);
  }
}

console.log('');


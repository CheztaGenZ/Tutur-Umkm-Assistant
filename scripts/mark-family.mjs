/**
 * Tandai kontak keluarga sebagai "keluarga" (wajib sopan).
 *
 * Jalankan: npm run mark-family
 *           npm run mark-family -- "C:\path\Keluarga Bahagia.zip"
 */
import fs from 'node:fs';
import AdmZip from 'adm-zip';
import { openDb, listContacts, setContactRegister, isFamilyName } from '../src/db.js';
import { config } from '../src/config.js';
import { parseExport } from '../src/ingest/parseExport.js';

const file = process.argv[2] || 'C:\\Users\\Chezta\\Downloads\\Keluarga Bahagia.zip';
const db = openDb(config.dataDir);

const names = new Set(['mamah', 'ayah new', 'koko rifqi achmad', 'koko rifqi achmad~']);

if (fs.existsSync(file)) {
  const zip = new AdmZip(fs.readFileSync(file));
  const txt = zip.getEntries().find((e) => !e.isDirectory && /\.txt$/i.test(e.entryName));
  if (txt) {
    const parsed = parseExport(txt.getData().toString('utf8'), { meName: 'Anda' });
    for (const a of parsed.authors) {
      const n = a.name.toLowerCase();
      if (n === 'anda' || n.includes('chesta')) continue;
      names.add(n);
    }
    console.log(`\n  ${parsed.authors.length} nama ditemukan di grup keluarga`);
  }
}

let changed = 0;
for (const raw of names) {
  const contact = db
    .prepare('SELECT * FROM contacts WHERE lower(name) = ? OR lower(import_name) = ? LIMIT 1')
    .get(raw, raw);
  if (!contact) continue;
  setContactRegister(db, contact.jid, 'keluarga');
  console.log(`  ${contact.name.padEnd(24)} → KELUARGA`);
  changed++;
}

// Pindai semua kontak: nama seperti Mamah/Ayah/Koko/Kakak otomatis keluarga.
for (const c of listContacts(db, '')) {
  if (c.register !== 'auto' && c.register !== 'sopan') continue;
  if (!isFamilyName(c.name)) continue;
  setContactRegister(db, c.jid, 'keluarga');
  console.log(`  ${String(c.name).padEnd(24)} → KELUARGA (otomatis)`);
  changed++;
}

console.log(`\n  ${changed} kontak ditandai keluarga.\n`);

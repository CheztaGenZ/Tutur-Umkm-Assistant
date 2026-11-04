/**
 * Tampilkan profil gaya ngetik yang sudah dipelajari.
 * Jalankan: npm run profile
 */
import { openDb, kvGet, listContacts } from '../src/db.js';
import { config } from '../src/config.js';
import { groupSampleCount, rebuildGroupStyle } from '../src/ingest/groupStyle.js';

const db = openDb(config.dataDir);
if (process.argv.includes('--rebuild')) {
  rebuildGroupStyle(db);
  console.log('  (profil grup dibangun ulang dari semua sampel)');
}

// Kalau ada nama kontak, tampilkan profil kontak itu saja.
const nameArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (nameArg) {
  const contact = listContacts(db, nameArg)[0];
  if (!contact) {
    console.log(`\n  Kontak "${nameArg}" tidak ditemukan.\n`);
    process.exit(1);
  }
  const style = contact.style_profile ? JSON.parse(contact.style_profile) : null;
  console.log(`\n  ${contact.name} (${contact.register}) — ${contact.sample_count} sampel\n`);
  if (!style) {
    console.log('  Belum ada profil.\n');
    process.exit(0);
  }
  for (const n of style.notes || []) console.log(`   • ${n}`);
  console.log('');
  process.exit(0);
}
const parse = (v) => {
  try {
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
};

const group = parse(kvGet(db, 'group_style'));
const global = parse(kvGet(db, 'global_style'));

console.log('');
console.log('  === GAYA NGETIK YANG DIPELAJARI ===');
console.log(`  Sampel dari grup    : ${groupSampleCount(db)} pesan`);
if (group) {
  console.log(`  Sampel profil aktif : ${group.sampleSize} pesan`);
  console.log('');
  for (const n of group.notes || []) console.log(`   • ${n}`);
  console.log('');
  if (group.examples?.length) {
    console.log('  Contoh pesanmu yang dianggap paling khas:');
    for (const e of group.examples.slice(0, 8)) console.log(`   > ${e}`);
  }
}

if (global && global.sampleSize !== group?.sampleSize) {
  console.log('');
  console.log(`  (profil global dari import: ${global.sampleSize} pesan)`);
}
console.log('');

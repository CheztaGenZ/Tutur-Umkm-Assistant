/**
 * Tes pilih stiker sesuai konteks.
 * Jalankan: npm run pick-sticker -- "aku kesel banget cok"
 */
import { chooseSticker, stickerCatalog } from '../src/ai/stickerPicker.js';

const msg = process.argv.slice(2).join(' ').trim() || 'halo';

const list = stickerCatalog();
console.log(`\n  ${list.length} stiker di katalog`);
console.log(`  Pesan: ${msg}\n`);

const picked = await chooseSticker({
  messages: [{ direction: 'in', body: msg }],
  reply: '',
  contactName: 'Hangga',
  meName: 'Chesta',
});

if (picked) {
  const desc = list.find((s) => s.file === picked.file)?.desc;
  console.log(`  ✓ Dipilih: ${picked.file}`);
  console.log(`    ${desc}`);
  console.log(`    Alasan: ${picked.reason}\n`);
} else {
  console.log('  (tidak ada stiker yang cocok)\n');
}

/**
 * Tes koneksi ke API DeepSeek (atau provider OpenAI-compatible apa pun).
 * Jalankan: npm run test-ai
 */
import { config } from '../src/config.js';
import { chatJson } from '../src/ai/client.js';

const line = (s) => console.log(s);

line('');
line('  Konfigurasi yang terbaca:');
line(`  BASE URL : ${config.ai.baseUrl}`);
line(`  MODEL    : ${config.ai.model}`);
line(`  THINKING : ${config.ai.thinking}`);
line(`  API KEY  : ${config.ai.apiKey ? config.ai.apiKey.slice(0, 6) + '…' + config.ai.apiKey.slice(-4) : '(kosong)'}`);
line('');

if (!config.ai.apiKey) {
  line('  ✗ AI_API_KEY belum diisi.');
  line('');
  line('  Buka file .env di folder ini, isi baris:');
  line('    AI_API_KEY=sk-...');
  line('');
  line('  Ambil key di https://platform.deepseek.com/api_keys');
  line('  Simpan, lalu jalankan lagi: npm run test-ai');
  line('');
  process.exit(1);
}

const started = Date.now();
try {
  const out = await chatJson(
    [
      { role: 'system', content: 'Kamu mesin uji. Balas HANYA JSON valid.' },
      { role: 'user', content: 'Balas JSON: {"ok": true, "pesan": "siap"}' },
    ],
    { temperature: 0 },
  );
  const ms = Date.now() - started;
  line(`  ✓ Tersambung. Respons dalam ${ms} ms`);
  line(`    ${JSON.stringify(out)}`);
  line('');
  line('  Kalau mengubah key lewat tab Setting, perubahan langsung aktif.');
  line('  Kalau mengubah .env manual, restart server (tutup jendela lalu jalankan start.bat).');
  line('');
} catch (err) {
  const status = err.status;
  line(`  ✗ Gagal (${msSince(started)} ms)`);
  line(`    ${err.message.slice(0, 300)}`);
  line('');
  if (status === 401) {
    line('  Penyebab: API key salah atau sudah dihapus.');
    line('  Cek ulang di https://platform.deepseek.com/api_keys');
  } else if (status === 402) {
    line('  Penyebab: saldo DeepSeek habis. Isi ulang dulu.');
  } else if (status === 429) {
    line('  Penyebab: kena rate limit. Tunggu sebentar lalu coba lagi.');
  } else if (status === 404) {
    line('  Penyebab: AI_BASE_URL atau AI_MODEL salah.');
    line('  DeepSeek: AI_BASE_URL=https://api.deepseek.com/v1 dan AI_MODEL=deepseek-chat');
  } else if (!status) {
    line('  Penyebab: tidak bisa menghubungi server. Cek koneksi internet / firewall.');
  }
  line('');
  process.exit(1);
}

function msSince(t) {
  return Date.now() - t;
}

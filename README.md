# WA Reply AI

Auto-reply WhatsApp yang meniru cara ngetik kamu — dengan pagar pengaman supaya AI tidak
asal jawab orang penting dan tidak pernah menyentuh grup.

## Cara kerja

Bukan fine-tune model. Tiga lapis konteks disuntik ke prompt setiap kali membalas:

1. **Persona** — hasil analisis pesan-pesanmu dari export chat: panjang balasan, kebiasaan
   huruf kecil, tanda baca, emoji favorit, singkatan khas (`wkwk`, `bgt`, `otw`).
2. **Relationship card** — ringkasan AI tentang siapa orang itu bagimu, topik yang sering
   dibahas, dan hal yang harus dihindari.
3. **Few-shot** — pasangan chat asli (pesan dia → balasanmu) sebagai contoh ritme.

## Siapa yang dibalas

Default-nya **tidak membalas siapa pun**. Setiap kontak punya satu dari tiga mode:

| Mode | Perilaku |
|---|---|
| `auto` | AI membalas sendiri, tetap dibatasi rate limit + ambang keyakinan |
| `draft` | AI menyiapkan balasan, kamu yang tekan kirim di dashboard |
| `jangan` | AI diam total, tidak menyimpan apa pun ke AI |

Selain itu, **selalu diabaikan** tanpa pengecualian:

- Grup, status/broadcast, channel
- Nomor di `VIP_NUMBERS` (.env)
- Saat jam tenang (`QUIET_HOURS`)
- Saat sistem dijeda (tombol di dashboard)
- Pesan lebih tua dari 3 menit (backlog saat baru konek)

Catatan soal grup: **tidak pernah dibalas**, tapi pesanmu di grup tetap
dibaca dan dipakai melatih gaya ngetik. Justru di grup biasanya gaya paling
santai muncul, termasuk bahasa daerah.

Bahkan di mode `auto`, balasan **tidak dikirim** kalau:

- AI menilai pesan tidak butuh jawaban (`ok`, `sip`, info sepihak) → `reply: null`
- Confidence di bawah `AUTO_CONFIDENCE_MIN` → turun jadi draft
- Topik sensitif (uang, konflik, keluarga, kesehatan) → confidence dipaksa rendah
- Batas harian/jam/jeda per-kontak tercapai

## Instalasi

```bash
npm ci
cp .env.example .env     # Windows: copy .env.example .env
# lalu isi AI_API_KEY dan MY_NAME
npm start
```

Buka <http://localhost:3000>, scan QR dengan WhatsApp di HP
(**Perangkat tertaut → Tautkan perangkat**).

Butuh **Node.js 22+** (memakai `node:sqlite` bawaan, tanpa database eksternal).

Default-nya dashboard hanya terbuka di PC (`BIND_HOST=127.0.0.1`). Kalau mau
dibuka dari HP di Wi-Fi yang sama, ubah ke `BIND_HOST=0.0.0.0` dan baca bagian
keamanan di bawah. **Jangan buka port ini ke internet tanpa VPN/PIN/reverse proxy
ber-auth.**

## Model & biaya

Bot mendukung provider apa pun yang kompatibel OpenAI. Untuk Google Gemini:

```env
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
AI_API_KEY=...
AI_MODEL=gemini-3.1-flash-lite
# Kosongkan AI_VISION_MODEL kalau gambar/video mau ikut model teks.
AI_VISION_MODEL=
AI_THINKING=auto
```

Untuk OpenRouter:

```env
AI_BASE_URL=https://openrouter.ai/api/v1
AI_API_KEY=sk-or-...
AI_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free
AI_VISION_MODEL=nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
AI_THINKING=auto
```

`AI_VISION_MODEL` dipakai otomatis kalau pesan berisi gambar atau video. Kalau
dikosongkan, bot memakai `AI_MODEL` untuk semua pesan.

`AI_THINKING=off` penting untuk DeepSeek. DeepSeek menyalakan *thinking mode* secara
default — model menulis rantai penalaran panjang sebelum menjawab, jadi token output
membengkak dan balasan jadi lambat. Untuk provider lain, gunakan `auto`.

Sekali balas biasanya cuma ~1.500 token input (prompt + profil + contoh) dan ~30 token
output. Harga tergantung provider dan model yang dipilih.

## Setting dari dashboard

Buka tab **Setting** untuk mengganti provider AI tanpa menyentuh terminal:

- Pilih preset **DeepSeek / OpenAI / OpenRouter / Groq**, atau isi base URL sendiri.
- Isi **API key**. Key yang sudah tersimpan hanya ditampilkan sebagian (`sk-…a1b2`);
  biarkan kosong kalau tidak mau mengganti.
- Isi **Model teks** dan **Model gambar/video**, lalu tekan **Tes koneksi** untuk mengecek key, latency, dan token.
- Tekan **Simpan & aktifkan**. Perubahan langsung dipakai server yang sedang jalan, dan
  `.env` ikut diperbarui supaya tetap sama setelah restart.

Kalau base URL pindah origin (skema + host + port, misalnya DeepSeek → OpenRouter atau
https → http), API key lama **tidak** ikut dikirim ke origin baru. Key yang sedang diketik
di form juga dikosongkan saat origin berubah. Isi key baru kalau provider itu membutuhkannya.

Dashboard bisa dibuka dari HP di Wi-Fi yang sama, tetapi tab Setting dari HP hanya mode
lihat saja. Perubahan provider/API key sengaja dikunci ke PC.

Catatan: kalau server dijalankan dengan environment variable dari shell/PM2/Docker, nilai
env itu yang menang atas `.env`. Dashboard menampilkan nilai yang benar-benar dipakai.

## Keamanan akses

- Dashboard bisa dibaca dari HP di Wi-Fi yang sama, tetapi **semua aksi tulis** (kirim draft,
  pause, logout, import, status, aktivitas, setting) hanya bisa dari PC. Request tulis dari
  LAN mendapat `403`.
- QR pairing hanya dikirim ke PC, tidak ke HP/LAN.
- API hanya menerima koneksi dari loopback dan jaringan privat (RFC1918/link-local/ULA/
  Tailscale). IP publik ditolak.
- `BIND_HOST=0.0.0.0` membuat server hanya listen IPv4 dan bisa diakses HP. Set
  `BIND_HOST=127.0.0.1` kalau dashboard hanya dipakai dari PC.
- Kalau memakai hostname lokal (bukan IP/localhost), tambahkan ke `ALLOWED_HOSTS` di `.env`.
- Dashboard memakai header keamanan (CSP, X-Frame-Options, nosniff, no-store) dan guard
  CSRF/Origin. Ini bukan pengganti HTTPS/VPN: koneksi LAN tetap HTTP biasa.
- Kalau Wi-Fi dipakai orang lain, gunakan VPN/Tailscale atau tambahkan PIN dashboard.
  Pembatasan saat ini melindungi dari perubahan data, bukan dari pembacaan data privat
  oleh perangkat yang sudah ada di jaringan privat.

## Sebelum push ke GitHub

Repo ini sudah menyiapkan `.gitignore` untuk data pribadi:

- `.env` — API key dan konfigurasi lokal
- `data/` — database, sesi WhatsApp, gambar aktivitas/status
- `profile.md` — profil pribadi
- `import-inbox/` — file export chat
- `stickers/*.webp|png|jpg` dan `stickers/catalog.json` — stiker dari chat pribadi
- `.taste-skill/` dan `.superpowers/` — screenshot/backup/workspace lokal

Jangan pernah `git add -f` file-file itu. Cek sekali lagi dengan `git status` sebelum commit.
Kalau mau membuat repo baru:

```bash
git init
git add .
git status                 # pastikan tidak ada .env/data/profile/stiker pribadi
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/USERNAME/wa-reply-ai.git
git push -u origin main
```

Lisensi: **MIT** (lihat `LICENSE`). CI ada di `.github/workflows/test.yml` dan
menjalankan `npm test` tanpa connect ke WhatsApp.

Ini alat **self-hosted untuk satu pengguna**, bukan SaaS multi-user. Jangan buka port-nya
ke internet tanpa VPN/auth. WhatsApp Web tidak resmi, jadi risiko ban nomor tetap ada.

## Token AI

Setiap panggilan AI yang berhasil dicatat ke SQLite (`ai_usage`) memakai data `usage`
asli dari provider. Total token dan token hari ini tampil di kartu kecil kiri bawah
sidebar; klik kartu itu untuk membuka rincian di tab Setting.

Rinciannya berisi input/output, jumlah panggilan, panggilan terakhir, dan pecahan per
jenis pekerjaan (balas pesan, profil kontak, memori, stiker, tes koneksi). Provider yang
tidak mengirim `usage` tetap bisa dipakai; tokennya tercatat 0 dan UI memberi catatan.

## Profil kamu

Edit **`profile.md`** untuk info yang boleh dipakai AI: nama, umur, asal, kampus, dsb.
File ini dibaca ulang setiap kali membalas, jadi tidak perlu restart.

Belum punya file? Salin template-nya:

```bash
cp profile.example.md profile.md   # Windows: copy profile.example.md profile.md
```

`profile.md` tidak ikut di-commit. Jangan taruh alamat lengkap, nomor rekening, atau data
yang tidak ingin dibocorkan. AI diinstruksikan menjawab dengan sudut pandang orang pertama,
tapi **tidak** menyebut nama lengkap, alamat, atau kampus ke orang yang belum jelas siapa.

## Bahasa daerah

Gaya bahasa ikut contoh chat, bukan disetel manual. Kalau pesanmu sehari-hari
campur Jawa, balasannya ikut Jawa. Tingkat tutur dijaga:

- Teman sebaya → ngoko / kasar, sesuai contoh
- Orang tua & keluarga → krama/halus atau Indonesia sopan, walau contohnya campur

Profil gaya dipilih otomatis dari yang sampelnya paling banyak: profil per-kontak,
gaya umum dari grup, atau gaya global.

## Melatih gaya ngetik

1. Di WhatsApp: buka chat → ⋮ → **More** → **Export chat** → **Without media**.
2. Dashboard → tab **Import** → upload `.txt`-nya.
   Bisa **banyak file sekaligus**: satu file = satu kontak. Nama kamu dideteksi otomatis
   dari nama yang muncul di hampir semua file.
3. Pilih nama kamu di export, pilih kontak, simpan.
4. Ulangi untuk kontak-kontak yang penting. Semakin banyak pesanmu, semakin mirip hasilnya.

Kontak hasil import yang belum punya nomor akan otomatis terhubung saat dia mengirim
pesan pertama (dicocokkan lewat nama).

### Soal backup WhatsApp

Backup Android (`msgstore.db.crypt14`) terenkripsi dengan key yang hanya bisa dibaca
lewat root, jadi **tidak bisa diupload langsung**. Backup iPhone juga hanya kebaca
kalau tidak dipassword.

Kalau tidak mau export satu-satu, ada dua jalan tanpa root:

- **Belajar sendiri** — setiap ~20 pesan baru, profil gaya diperbarui otomatis dari
  pesan yang lewat di WhatsApp.
- **Tombol ↻** di tab Kontak untuk memaksa perbarui saat itu juga.

## Soal risiko ban

Nomor bisa di-ban karena ini klien tidak resmi. Mitigasi yang sudah ditanam:

- Hanya **membalas**, tidak pernah memulai percakapan
- Rate limit harian/jam + jeda minimum per kontak
- Delay acak 4–12 detik dengan indikator "typing"
- Jam tenang supaya tidak seperti bot 24 jam
- Tidak ada template identik ke banyak orang (selalu digenerate ulang)

Tetap disarankan: **pakai nomor kedua**, jangan nomor utama. Kalau nomor itu penting,
pakai WhatsApp Business Cloud API resmi (tapi tidak bisa baca history lama).

## Struktur

```
src/
  config.js            konfigurasi + pagar
  settings.js          setting provider AI dari dashboard + penulis .env
  db.js                skema SQLite + query
  policy.js            SATU-SATUNYA tempat keputusan balas/tidak
  server.js            API + SSE
  ai/client.js         klien OpenAI-compatible
  ai/usage.js          normalisasi + pencatat pemakaian token
  ai/prompt.js         3 lapis prompt + kontrak JSON
  ingest/parseExport.js parser export WA (iOS & Android)
  ingest/style.js      analisis gaya ngetik
  wa/client.js         koneksi Baileys + QR
  wa/handler.js        alur pesan masuk
public/                dashboard
```

`policy.js` sengaja dipisah: kalau mau mengubah aturan siapa yang boleh dibalas,
itu satu-satunya file yang perlu disentuh.

## Perintah

```bash
npm start                          # jalankan
npm run dev                        # jalankan dengan auto-reload
npm run test-ai                    # cek koneksi API + status key
npm test                           # tes: parser, gaya, kebijakan, alur balas, status, setting/token, API, zip
npm run simulate -- "mamah" "halo" # coba balasan tanpa mengirim
npm run reset-import               # buang profil hasil import (impor ulang)
```

`npm test` tidak butuh WhatsApp login maupun API key — AI diganti server tiruan.

## Cara mengetes

**1. Tanpa kirim apa pun** — paling aman

```bash
npm run simulate -- "mamah" "chesta udah makan?"
```

Keluarannya: balasan yang akan dikirim, confidence, dan keputusan akhir
(langsung kirim atau masuk draft).

**2. Lewat dashboard**
Set kontak ke `draft`, minta orang lain kirim pesan. Draft muncul di tab Draft —
bisa diedit, dikirim, atau dibuang.

**3. Auto-reply penuh**
Set kontak ke `auto`, minta orang lain kirim pesan lagi. Balasan terkirim sendiri.
Pantau tab **Log** untuk melihat alasannya kalau tidak terkirim.

Yang sering bikin tes gagal:

- **Server mati** → tidak ada yang membalas. Harus `npm start` / `start.bat`.
- **Pesan lebih tua dari 3 menit** diabaikan, biar tidak balas chat semalam.
- **Jam tenang** (default 01:00–07:00) memblokir auto-reply. Set `QUIET_HOURS=off` sementara.
- **Jeda per kontak** — kalau baru saja membalas kontak itu, pesan berikutnya dalam
  `MIN_GAP_PER_CONTACT_SEC` detik akan diabaikan.

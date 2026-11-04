# Security Policy

## Versi yang didukung

Hanya versi terbaru di branch `main` yang menerima perbaikan keamanan.

## Cara melaporkan masalah

Jangan buka issue publik untuk masalah keamanan. Gunakan **GitHub Security
Advisories** di repository ini, atau hubungi pemilik repository secara privat.

Sertakan:

- langkah reproduksi
- dampak yang mungkin
- versi Node.js dan OS
- apakah masalah terjadi dari localhost, LAN, atau lewat reverse proxy

## Batas keamanan

- Default `BIND_HOST=127.0.0.1`; dashboard hanya untuk PC yang menjalankan bot.
- Jika diubah ke `0.0.0.0`, siapa pun di jaringan yang sama bisa membaca data
  yang diizinkan endpoint LAN. Gunakan VPN/PIN/reverse proxy ber-auth.
- Jangan mengekspos port ke internet tanpa perlindungan tambahan.
- `.env`, `data/`, `profile.md`, dan `import-inbox/` berisi data sensitif dan
  tidak boleh di-commit.
- WhatsApp Web tidak resmi. Risiko ban nomor dan perubahan API tetap ada.

## Secret

API key, sesi WhatsApp, dan database tidak boleh dilampirkan ke issue publik.
Redaksi nomor telepon dan isi chat sebelum melaporkan bug.

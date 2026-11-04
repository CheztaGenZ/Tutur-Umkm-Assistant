# Contributing

Terima kasih sudah mau bantu. Proyek ini kecil, jadi aturannya sederhana.

## Setup

```bash
git clone https://github.com/CheztaGenZ/WhatsApp-Auto-Reply.git
cd WhatsApp-Auto-Reply
npm ci
cp .env.example .env
npm test
```

Tidak perlu connect WhatsApp untuk menjalankan test. Test memakai DB sementara dan
WhatsApp palsu.

## Sebelum PR

- Jalankan `npm test` dan pastikan semua lulus.
- Jangan commit `.env`, `data/`, `profile.md`, `import-inbox/`, atau stiker pribadi.
- Jangan menambah API key, nomor telepon asli, atau isi chat ke test/fixture.
- Untuk perubahan UI, sertakan screenshot (tanpa data pribadi).
- Untuk perubahan perilaku, jelaskan sebelum/sesudah.

## Gaya kode

- Node.js ESM (`import`/`export`).
- Tanpa framework frontend; dashboard memakai HTML/CSS/JS biasa.
- Pertahankan pola yang sudah ada; jangan refactor besar tanpa issue.
- Komentar secukupnya, bahasa Indonesia atau Inggris boleh.

## Commit

Gunakan pesan yang jelas:

```text
fix: jangan buang pesan kedua saat lock
feat: tambah fallback model vision
docs: perjelas setup LAN
```

## Keamanan

Jangan buka issue publik untuk vulnerability. Ikuti [SECURITY.md](SECURITY.md).

# FAQ

## Apakah butuh Postgres atau Supabase?

Tidak. Database-nya SQLite lokal di `data/app.db`. Tidak ada server database eksternal.
Postgres/Supabase baru relevan kalau proyek jadi multi-user atau SaaS.

## Kenapa kontak tampil sebagai “Orang”?

WhatsApp memakai LID (`@lid`) untuk chat dan PN (`@s.whatsapp.net`) untuk nomor telepon.
Kalau nama buku kontak tidak ketemu, bot memakai “Orang”. Versi terbaru sudah memetakan
LID → PN dan memperbaiki kontak lama saat WhatsApp ready. Beberapa kontak bisa tetap
“Orang” kalau namanya tidak ada di `wa_contacts`; rename manual dari dashboard.

## Kenapa API key ditawari simpan password oleh Chrome/Google?

Dulu field-nya `type=password`. Sekarang `type=text` + CSS mask + `autocomplete=off` +
atribut anti-password-manager. Kalau Chrome masih menawarkan, hapus entri `localhost:3000`
di `chrome://settings/passwords`.

## Kenapa balasannya lambat?

Latency tergantung provider AI. Handler dibatasi maksimal 2 percobaan per pesan, dan
timeout per percobaan 20 detik. Untuk respons lebih cepat, pilih model Flash/Lite atau
provider yang lebih dekat. Cek `AI_MODEL` dan `AI_BASE_URL`.

## Apakah aman dibuka dari HP?

Bisa, tapi default-nya hanya PC (`BIND_HOST=127.0.0.1`). Kalau diubah ke `0.0.0.0`,
perangkat di Wi-Fi yang sama bisa membaca data yang diizinkan. Jangan buka ke internet
tanpa VPN/PIN/reverse proxy ber-auth. Baca [SECURITY.md](../SECURITY.md).

## Apakah nomor saya bisa dibanned?

WhatsApp Web tidak resmi. Otomasi berisiko ban. Gunakan nomor cadangan, jangan spam,
dan hormati kuota/jeda. Tidak ada jaminan.

## Di mana data disimpan?

```text
data/app.db          database SQLite
data/auth/           sesi WhatsApp
data/status/         gambar status
.env                 API key + konfigurasi
profile.md           profil persona
stickers/            stiker
```

## Cara backup?

Stop bot, copy seluruh folder `data/`, lalu copy `.env`, `profile.md`, dan `stickers/`.
Jangan copy `app.db` sendirian saat server hidup karena ada WAL.

## Apakah video didukung?

Saat ini gambar dan stiker dikirim ke model vision; pesan suara ditranskrip. Video masih
dilewati. Dukungan video ada di roadmap.

## Apakah grup dibalas?

Tidak. Grup hanya dipakai untuk mempelajari gaya ngetik; tidak pernah dibalas.

## Cara update?

```bash
git pull
npm ci
npm start
```

Cek [CHANGELOG.md](../CHANGELOG.md) untuk perubahan yang breaking.

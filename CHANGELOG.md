# Changelog

Semua perubahan penting dicatat di sini. Format mengikuti Keep a Changelog.

## [0.1.0] - 2026-11-05

### Added

- Dashboard lokal dengan mode terang/gelap.
- Mode kontak `auto`, `draft`, dan `jangan`.
- Persona dari export chat, relationship card, few-shot, memori.
- Multi-provider AI (OpenAI-compatible).
- Gambar/stiker vision dan transkrip suara.
- Status WhatsApp: jadwal, kirim, tarik, privasi fail-closed.
- SQLite lokal + tracking token AI.
- Import `.txt`/`.zip`.
- Test suite: handler, status, settings, security, smoke.
- MIT license, SECURITY.md, docs, issue templates, CI.

### Fixed

- Pesan kedua tidak lagi hilang saat lock.
- `forceDraft` TDZ crash.
- Status dobel dan kuota bypass.
- Privasi Status mode 1 fail-open.
- Draft dobel saat kirim bersamaan.
- Retry AI berlebihan.
- Kontak LID tampil “Orang”.
- API key dianggap password manager.
- Kebocoran isi chat lewat SSE LAN.

# Changelog

All notable changes are documented here. The format follows Keep a Changelog.

## [1.0.0] - 2026-11-07

Tutur, the Bali DigiFest 2026 submission.

### Added

- Business profile onboarding with jam buka, lokasi, keunggulan, kontak, and catatan.
- Email/password, Google, and Facebook accounts with terms and privacy consent.
- Payment settings for cash, QRIS, and bank transfer, including QRIS image upload.
- AI payment replies that attach the owner's QRIS image or bank details.
- Order capture from chat with customer name, items, and total.
- Orders dashboard with done, cancelled, and reopen controls.
- Coba Chat at `/coba`, with owner personalization and decision trace.
- Product catalog with image upload and automatic knowledge sync.
- Per-owner knowledge, products, business profile, and orders.
- Grounded answer evaluation: 28 questions, 28/28 correct with retrieval, 0 invented prices.
- Business profile and Coba Chat documentation, screenshots, and deployment bundle.

### Fixed

- Bank details not saving from the business profile form.
- Business knowledge rows overwriting each other across accounts.
- Order bubble showing "tanpa nama" in Coba Chat.
- Coba Chat showing the demo business name after an owner signed in.
- Orders from WhatsApp drafts not being recorded.
- Dashboard showing the demo persona name instead of the signed-in owner.

### Security

- 42/42 security checks passing.
- Scrypt password hashing, hashed sessions, login rate limiting, CSP, HTTPS redirect, and HSTS.
- Owner-scoped order updates. Cross-account updates return 404.

## [0.1.0] - 2026-11-05

### Added

- Local dashboard with light/dark themes.
- Per-contact `auto`, `draft`, and `ignore` modes.
- Persona engine from exported chats, relationship cards, few-shot examples, memory.
- Multi-provider AI (OpenAI-compatible).
- Image/sticker vision and voice transcription.
- WhatsApp statuses: schedule, post, revoke, privacy fail-closed.
- Local SQLite storage and AI token tracking.
- `.txt`/`.zip` import.
- Test suite: handler, status, settings, security, smoke.
- MIT license, security policy, docs, issue templates, CI.

### Fixed

- The second message is no longer dropped while a chat is locked.
- `forceDraft` TDZ crash.
- Duplicate statuses and status quota bypass.
- Status privacy mode 1 fail-open.
- Duplicate draft send race.
- Excessive AI retries.
- LID contacts showing as “Orang”.
- API key being treated as a password by password managers.
- Chat content leaking through LAN SSE.

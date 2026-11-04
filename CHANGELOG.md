# Changelog

All notable changes are documented here. The format follows Keep a Changelog.

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

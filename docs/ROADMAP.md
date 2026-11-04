# Roadmap

## Shipped

- [x] Per-contact modes: auto, draft, ignore
- [x] Persona from exported chats
- [x] Local dashboard with live events
- [x] Multi-provider AI (OpenAI-compatible)
- [x] Image and sticker vision
- [x] Voice transcription
- [x] Status scheduling and revoke
- [x] Status privacy fail-closed
- [x] Local SQLite storage
- [x] `.txt` / `.zip` import
- [x] Handler lock queue and AI retry cap
- [x] LID → PN contact repair

## Next

- [ ] PIN/token authentication for LAN
- [ ] Authenticated reverse-proxy support
- [ ] Draft only the remaining bubbles after a partial send
- [ ] Atomic cross-contact quota reservation
- [ ] Media redelivery race fix
- [ ] SSRF guard for `/api/settings/test`
- [ ] Rate limits for read APIs, AI, and imports
- [ ] Video support
- [ ] Coverage report
- [ ] Formal schema migrations

## Later

- [ ] Multi-user / SaaS
- [ ] Postgres/Supabase adapter
- [ ] Docker image
- [ ] Desktop app installer
- [ ] Plugin/provider registry

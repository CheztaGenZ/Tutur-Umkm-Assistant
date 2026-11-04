# Verification

This page lists what is actually tested, what is demonstrated, and what is not covered.

## Test suites

Run everything:

```bash
npm test
```

| Suite | Checks | Covers |
|---|---:|---|
| Handler | 47 | auto/draft/ignore, locks, duplicate messages, drafts, media routing, LID/PN, safety fallbacks |
| Status | 11 | sends, message keys, atomic claims, quota, privacy fail-closed, transient errors |
| Settings | 3 | `.env` persistence, masking, provider host changes, usage |
| Security | 42 | headers, CSRF, Host guard, LAN read-only, QR redaction, SSE redaction, traversal, zip limits, key leaks |
| Smoke | 31 | real server boot, dashboard, settings live update, import, SSE, contacts, drafts |

## CI

The GitHub Actions workflow runs `npm test` on every push and pull request:

<https://github.com/CheztaGenZ/WhatsApp-Auto-Reply/actions/workflows/test.yml>

Latest `main` result: **success**.

## What the demo shows

The demo video and screenshots use a local database with fake contacts, fake drafts,
and a fake WhatsApp connection. No real chats, names, or phone numbers are included.

Covered visually:

- draft queue and confidence badges
- per-contact modes and register
- activity editor
- status scheduling and privacy banner
- provider settings and model selection
- CI success page

## What is not covered

Be clear about the boundary:

- No end-to-end test against a real WhatsApp account in CI.
- No automated quality score for “sounds like me”; style quality is subjective.
- Voice transcription is exercised only as a skip path in tests unless local/online
  transcription is configured.
- Video input is not implemented yet; images and stickers are.
- WhatsApp automation is unofficial and may lead to a ban.

## Reproduce the demo

The screenshots/video were generated from a demo database and a fake WhatsApp client.
The public repository does not include any personal data.

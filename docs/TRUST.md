# Trust and Transparency

This page explains what stays on your machine, what leaves it, and how to verify the bot.

## What stays local

- WhatsApp session: `data/auth/`
- messages, contacts, drafts, style profiles: `data/app.db`
- persona: `profile.md`
- stickers: `stickers/`
- status images: `data/status/`
- API keys and config: `.env`

There is no cloud database. The dashboard talks to the local Express server. The GitHub
repository contains code and docs only; it does not contain your chats.

## What leaves your machine

Only these external calls happen:

1. **WhatsApp servers** — to send/receive messages and sync your WhatsApp session.
2. **Your AI provider** — the prompt context (recent messages, style examples,
   relationship card, memory) is sent to generate a reply.
3. **Optional transcription provider** — only if you configure `AI_TRANSCRIBE_URL`.

There is no analytics, telemetry, or third-party dashboard.

## How to verify

```bash
npm test
npm run stats
npm run diag
```

You can also inspect the SQLite database directly:

```bash
node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('data/app.db'); console.log(db.prepare('SELECT COUNT(*) n FROM messages').get());"
```

The dashboard log shows decisions: sent, drafted, skipped, AI errors, and rate limits.

## Kill switches

- Pause button in the dashboard.
- `VIP_NUMBERS` to never answer specific numbers.
- `QUIET_HOURS` to stop automatic replies at night.
- `MAX_MSGS_PER_DAY` / `MAX_MSGS_PER_HOUR` to cap volume.
- Set a contact to `draft` or `ignore`.
- Stop the process (`Ctrl+C`).

## Start safely

1. Use a spare WhatsApp number if possible.
2. Keep contacts in `draft` for the first few days.
3. Test with one contact.
4. Set `MAX_MSGS_PER_DAY=5` while testing.
5. Review drafts before enabling `auto`.
6. Never expose the dashboard to the internet without VPN/PIN/auth proxy.

## Data deletion

Stop the bot, back up what you need, then remove `data/` and `profile.md`. The next
start creates a fresh database and asks you to link WhatsApp again.

## Limitations

This is a beta, single-user, self-hosted project. It is not a hosted service, has no
multi-user authentication, and uses unofficial WhatsApp automation. See
[ROADMAP.md](ROADMAP.md) for known work remaining.

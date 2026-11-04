# FAQ

## Do I need Postgres or Supabase?

No. The database is local SQLite at `data/app.db`. No external database server is
required. Postgres/Supabase only makes sense if the project becomes multi-user or SaaS.

## Why does a contact show up as “Orang” (Person)?

WhatsApp uses LID (`@lid`) for chats and PN (`@s.whatsapp.net`) for phone numbers. If
the address-book name cannot be resolved, the bot falls back to “Orang”. The latest
version maps LID to PN and repairs old contacts when WhatsApp becomes ready. A few
contacts may remain “Orang” if their name is missing from `wa_contacts`; rename them
from the dashboard.

## Why does Chrome/Google offer to save the API key as a password?

The field used to be `type=password`. It is now `type=text` with CSS masking,
`autocomplete=off`, and password-manager ignore attributes. If Chrome still offers to
save it, remove the `localhost:3000` entry in `chrome://settings/passwords`.

## Why are replies slow?

Latency depends on the AI provider. The handler is capped at two attempts per message,
with a 20-second timeout per attempt. For faster replies, use a Flash/Lite model or a
provider with lower latency. Check `AI_MODEL` and `AI_BASE_URL`.

## Is it safe to open from my phone?

It can be, but the default is PC-only (`BIND_HOST=127.0.0.1`). If you change it to
`0.0.0.0`, devices on the same Wi-Fi can read the data allowed by the LAN endpoints.
Never expose it to the internet without VPN/PIN/authenticated reverse proxy. See
[SECURITY.md](../SECURITY.md).

## Can my number get banned?

WhatsApp Web automation is unofficial. Automation carries a ban risk. Use a spare
number, avoid spam, and respect the quota/cooldowns. There is no guarantee.

## Where is data stored?

```text
data/app.db          SQLite database
data/auth/           WhatsApp session
data/status/         status images
.env                 API keys and config
profile.md           persona profile
stickers/            sticker collection
```

## How do I back up?

Stop the bot, copy the whole `data/` folder, then copy `.env`, `profile.md`, and
`stickers/`. Do not copy `app.db` alone while the server is running; SQLite uses WAL.

## Is video supported?

Images and stickers are sent to the vision model; voice notes are transcribed. Video is
currently skipped. Video support is on the roadmap.

## Does it reply to groups?

No. Groups are only used to learn your typing style; they are never answered.

## How do I update?

```bash
git pull
npm ci
npm start
```

Check [CHANGELOG.md](../CHANGELOG.md) for breaking changes.

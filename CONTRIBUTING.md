# Contributing

Thanks for helping. This is a small project, so the rules are simple.

## Setup

```bash
git clone https://github.com/CheztaGenZ/WhatsApp-Auto-Reply.git
cd WhatsApp-Auto-Reply
npm ci
cp .env.example .env
npm test
```

You do not need WhatsApp to run the test suite. Tests use a temporary database and a
fake WhatsApp client.

## Before opening a PR

- Run `npm test` and make sure everything passes.
- Never commit `.env`, `data/`, `profile.md`, `import-inbox/`, or private stickers.
- Never add API keys, real phone numbers, or chat content to tests or fixtures.
- For UI changes, include a screenshot with personal data removed.
- For behavior changes, explain the before/after.

## Code style

- Node.js ESM (`import`/`export`).
- No frontend framework; the dashboard uses plain HTML/CSS/JS.
- Follow existing patterns; avoid large refactors without an issue.
- Comments in English are preferred for new code.

## Commit messages

Use clear messages:

```text
fix: keep the second message when a chat is locked
feat: add vision model fallback
docs: clarify LAN setup
```

## Security

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md).

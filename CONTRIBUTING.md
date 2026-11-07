# Contributing

Thanks for helping. Tutur is a small project, so the rules are simple.

## Setup

Node.js 22 or newer is required.

```bash
git clone https://github.com/CheztaGenZ/tutur.git
cd tutur
npm ci
cp .env.example .env
npm test
```

You do not need WhatsApp to run the test suite. Tests use a temporary database and a fake WhatsApp client.

## Before opening a pull request

- Run `npm test` and make sure everything passes.
- Run `node scripts/security.test.mjs` if you touched auth, uploads, headers, or API routes.
- Never commit `.env`, `data/`, `profile.md`, `import-inbox/`, or private stickers.
- Never add API keys, real phone numbers, or chat content to tests or fixtures.
- For UI changes, include a screenshot with personal data removed.
- For behavior changes, explain the before and after.

## Code style

- Node.js ESM (`import` and `export`).
- No frontend framework. The dashboard uses plain HTML, CSS, and ES modules.
- Follow existing patterns. Avoid large refactors without an issue.
- Comments in English are preferred for new code.
- Keep user-facing copy in Indonesian for the product and English for code comments.

## Commit messages

Use clear messages:

```text
fix: keep the second message when a chat is locked
feat: add vision model fallback
docs: clarify LAN setup
```

## Security

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your work is released under the MIT license.

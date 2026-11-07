# AI and Technology Disclosure

Product: Tutur
Competition: Bali DigiFest 2026, AI Web Innovation Challenge
Category: Mahasiswa/Umum
Date: 2026-11-07

| Component | What is used |
|---|---|
| Product name | Tutur |
| Framework / frontend | Plain HTML, CSS, and ES modules. No framework or build step |
| Backend / runtime | Node.js 22 or newer, Express 4 |
| Database / storage | SQLite through the built-in `node:sqlite` module |
| Hosting / deployment | Node web service with a persistent disk (see `docs/DEPLOY.md`) |
| AI model / API | OpenAI-compatible chat completions. Default model `deepseek-chat` through `https://api.deepseek.com/v1`. The settings page also supports Gemini, OpenAI, OpenRouter, Groq, and Ollama |
| Role of AI in the product | Reads the customer message, writes the reply in the owner's style, classifies intent, decides escalation, and grounds facts in the business knowledge base. AI is part of the main reply path, not a side feature |
| Dataset / data source | No external dataset. Demo knowledge base and synthetic chat export were written for this submission. No real customer data is deployed |
| Open-source libraries | `express`, `dotenv`, `@whiskeysockets/baileys`, `qrcode`, `pino`, `adm-zip`, `@ffmpeg-installer/ffmpeg`, `@huggingface/transformers`. See `package.json` for versions |
| Template / boilerplate | None. The dashboard and playground were written for this project |
| AI coding assistant | OpenCode with DeepSeek models was used as a development assistant for code editing, review, and documentation. The team reviewed and tested the resulting code |
| Pre-existing components | Persona engine, policy engine, WhatsApp transport, dashboard, and import pipeline come from the author's earlier project WA Reply AI. See `PRE-EXISTING.md` |
| Third-party assets / credits | Google Fonts: Fraunces, Plus Jakarta Sans, JetBrains Mono. All other UI assets are CSS and inline SVG written for this project |

## How AI is used at runtime

1. The customer message enters through WhatsApp or the playground.
2. The retriever selects up to three knowledge base rows.
3. The policy gate checks mode, quota, quiet hours, VIP status, and spam intent.
4. The AI call receives the owner persona, conversation history, and the selected
   business facts. It returns a reply, confidence, intent, escalation flag, and
   the sources it used.
5. `applyIntentGuards` and `detectRiskyIntent` enforce safety rules that do not
   depend on model obedience. Booking, order, and complaint messages always go to
   a draft. Spam is never sent.
6. The decision and trace are stored without the message body.

## Data and privacy

- The deployed demo uses synthetic data for a fictional business, Sari Kitchen.
- The author's real WhatsApp database is excluded from the repository and from
  deployment.
- Playground events store intent, action, escalation flag, and latency. They do
  not store message text.
- API keys live in environment variables. `.env.example` lists variable names
  only.
- The WhatsApp transport is disabled during judging (`WA_DISABLED=1`,
  `DEMO_MODE=1`). The playground exercises the same AI and policy code over HTTP.

## Statement

We declare that the information above is accurate and complete. We are
responsible for the technology, source code, data, libraries, AI models, and
assets used in this product.

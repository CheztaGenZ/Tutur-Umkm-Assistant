# Tutur

AI concierge for Balinese warungs and homestays. It answers customer chat the way
the owner writes, uses only the business's own data for prices and hours, and
holds back when a human should decide.

**Competition:** Bali DigiFest 2026, AI Web Innovation Challenge
**Category:** Mahasiswa/Umum
**Version:** v1.0-submission

- Coba Chat: `/coba` on the deployment URL
- No login required for Coba Chat
- Dashboard access uses an admin token provided to the judges

## Problem and target user

A warung or homestay in Ubud receives messages in Indonesian and English at
hours when the owner is cooking, driving, or asleep. Quick replies cannot answer
"do you have vegan options" or "can I book a table for six". A generic chatbot
invents prices, confirms tables that do not exist, and annoys the owner with
questions they did not need to see.

Target user: the owner of a small hospitality business with 1 to 10 staff, no
dedicated customer service team, and WhatsApp as the main channel.

## Accounts and product catalog

Owners can create an account with email and password, or sign in with Google and
Facebook. The account stores the business knowledge base and the product
catalog, so the menu does not need to be filled in again on the next visit.

The catalog lives at `/katalog`. Every product saved there is written into the
knowledge base automatically, so the AI answers price and availability
questions from the same data. Deleting or updating a product updates the AI
source in the same step.

OAuth needs provider credentials. Without them the buttons explain that the
provider is not configured yet and email login still works. Setup steps are in
`docs/DEPLOY.md`.

## What Tutur does

1. **Writes like the owner.** The style engine learns message length, casing,
   slang, and emoji habits from a chat export.
2. **Answers from the business data.** Prices, opening hours, menu, location,
   and policy come from a knowledge base. If the answer is not there, Tutur says
   it will check with the owner instead of inventing it.
3. **Knows when to stay quiet.** Booking, order, complaint, and allergy messages
   always become a draft for the owner. Spam is ignored. VIP numbers are never
   answered automatically.
4. **Shows its reasoning.** The Coba Chat returns a decision trace:
   policy verdict, confidence, message intent, business sources, model, and
   response time.

## Coba Chat

Open `/coba`. Pick a customer role, send a message in Indonesian or
English, and read the trace panel.

Preset scenarios: price question, table booking, opening hours, an unknown fact,
a complaint, and spam. Each one triggers a different policy outcome on purpose.

Coba Chat calls the same `generateReply` and `decide` functions that the
WhatsApp transport uses. The only difference is the entrance: HTTP instead of a
WhatsApp socket. No mock data is hardcoded into the answer.

## AI implementation

| Part | How it works |
|---|---|
| Grounding | Query tokens are matched against the knowledge base (title, keywords, body). The top 3 rows are injected into the system prompt as the only allowed source of facts |
| Generation | OpenAI-compatible chat completion. Default: DeepSeek `deepseek-chat`. Also supports Gemini, OpenAI, OpenRouter, Groq, and Ollama through settings |
| Intent | The model returns `intent` and `needs_owner`. A deterministic keyword guard also catches booking, order, and complaint messages when the model mislabels them |
| Policy | `src/policy.js` decides auto, draft, or ignore. Escalation always wins over auto. Spam is ignored even for a new contact |
| Style | `src/ai/prompt.js` builds a persona from the owner's real messages, plus relationship context and few-shot examples |
| Vision and voice | Optional image understanding and local Whisper transcription for voice notes |

### Evaluation

`npm run eval` runs 20 questions twice: once without the knowledge base, once
with retrieval. Results are written to [docs/eval-results.md](docs/eval-results.md).

Latest run with `deepseek-chat`:

| Metric | Without KB | Tutur |
|---|---|---|
| Correct answers | 11/20 | 20/20 |
| Invented prices on missing facts | - | 0 |

These numbers come from the included test set and an automated keyword check,
not from a human panel. The method is described in the result file.

## Architecture

```text
Customer (playground or WhatsApp)
        |
        v
  policy gate  ->  ignore
        |
        v
  knowledge retrieval (SQLite)
        |
        v
  AI generation (OpenAI-compatible)
        |
        v
  auto / draft / ignore + decision trace
        |
        v
  dashboard, draft queue, impact metrics
```

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 or newer |
| HTTP | Express 4 |
| Database | SQLite through `node:sqlite` |
| AI | OpenAI-compatible endpoint (`deepseek-chat` by default) |
| Frontend | Plain HTML, CSS, and ES modules. No build step |
| WhatsApp transport | Baileys, disabled during judging |
| Hosting | Any Node host with a persistent disk |

## Run locally

```bash
cp .env.example .env
# fill AI_API_KEY and AI_MODEL
npm install
npm start
```

Open `http://localhost:3000` for the dashboard and
`http://localhost:3000/coba` for the judge demo.

Demo mode:

```bash
DEMO_MODE=1 WA_DISABLED=1 ADMIN_TOKEN=change-me npm start
```

`DEMO_MODE=1` seeds the Sari Kitchen demo, disables WhatsApp, uses the business
prompt, and requires `ADMIN_TOKEN` for dashboard APIs. Coba Chat stays
public and rate limited.

## Tests

```bash
npm test      # unit, integration, security, and smoke tests
npm run eval  # 20-question grounded answer evaluation (needs an AI key)
```

## Deployment

See [docs/DEPLOY.md](docs/DEPLOY.md). The current target is a Node web service
with a persistent disk mounted at the data directory. SQLite needs real disk, not
an ephemeral filesystem.

## Known limitations

- WhatsApp transport is disabled for judging to avoid account risk. The web
  Coba Chat exercises the same AI and policy code.
- Accounts isolate the product catalog and business knowledge. Chat history and
  typing-style training still use one workspace in this MVP, so they are not yet
  separated per account.
- Retrieval is keyword based. It handles the demo knowledge base well, but a
  larger catalogue needs embeddings or a proper search index.
- SQLite suits a single-tenant deployment. Multi-tenant SaaS would need Postgres.
- The evaluation set has 20 questions and uses keyword scoring. It is a signal,
  not a benchmark.
- No real customer pilot yet. Impact numbers on Coba Chat are labeled as
  simulation plus live session data.

## Pre-existing work

Tutur builds on the author's earlier project, WA Reply AI. The disclosure is in
[PRE-EXISTING.md](PRE-EXISTING.md). The repository history and the commit dates
show what existed before the competition and what was built for this submission.

## Third-party resources

See [AI-TECHNOLOGY-DISCLOSURE.md](AI-TECHNOLOGY-DISCLOSURE.md) and
[docs/LEGACY-README.md](docs/LEGACY-README.md) for the original project notes.

Landing photo: "Nasi campur as art, Ubud, Indonesia" by Vyacheslav Argenberg,
licensed CC BY 4.0, via Wikimedia Commons. Gallery photos: Gunawan Kartapranata
(CC BY-SA 3.0), Crisco 1492 (CC BY-SA 3.0), mararie (CC BY-SA 2.0), via
Wikimedia Commons.

## Team

Filled by the team before submission. See `proposal/README.md`.

## License

MIT. See [LICENSE](LICENSE).

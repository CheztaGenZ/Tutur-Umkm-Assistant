# Pre-existing work disclosure

Tutur is built on WA Reply AI, a self-hosted WhatsApp auto-reply project by
Chesta Adabi Naufal, published at
https://github.com/CheztaGenZ/WhatsApp-Auto-Reply.

The competition rules allow pre-existing projects when the team owns the work,
the product has not been commercially mass-distributed, and the previous state is
disclosed. This file records that split.

## Already existed before the competition

- WhatsApp connection through Baileys, including QR pairing and session storage.
- Message handler and debounce for consecutive chat bubbles.
- Style analysis from exported chats, relationship cards, and few-shot examples.
- Persona prompt with personal register, language, and safety rules.
- Policy engine with auto, draft, and ignore modes plus quotas, quiet hours, and
  VIP numbers.
- SQLite schema for contacts, messages, drafts, examples, activities, status
  jobs, and AI usage.
- Express dashboard with contacts, drafts, activities, status scheduling,
  settings, import, and live logs.
- Multi-provider AI client with fallbacks and usage tracking.
- Image understanding and local Whisper transcription.
- Test suite, security hardening, and project documentation.

Commit history before 2026-11-07 shows this state.

## Built for this competition submission

- Business knowledge base with retrieval (`src/knowledge.js`, `knowledge` table).
- Grounded business prompt with abstain rules (`buildBusinessPrompt`).
- Intent fields and deterministic risky-intent guard (`applyIntentGuards`,
  `detectRiskyIntent`).
- Escalation that forces draft for booking, order, and complaint messages.
- Public judge playground with session memory, rate limiting, and decision trace
  (`src/playground.js`, `/playground`).
- Demo seed for Sari Kitchen, including a synthetic chat export and knowledge
  base (`src/demo/`).
- Impact metrics that combine a labeled 30-day simulation with live sessions.
- 20-question evaluation harness and results (`scripts/eval.mjs`, `evals/`).
- Playground redesign and accessibility pass (`DESIGN.md`).
- Submission documentation and deployment configuration.

## Commercial status

The project has no paying customers and has not been mass-commercialized. The
repository is public under the MIT license.

## Responsibility

The author wrote and understands the source code, including the AI call path,
the policy decisions, and the retrieval logic. AI coding assistants were used as
development tools and are listed in the technology disclosure.

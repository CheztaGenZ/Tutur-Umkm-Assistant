# How It Works

This page explains exactly how a WhatsApp message becomes an automatic reply.

## 1. Message arrives

The WhatsApp client (Baileys) receives a message event. Groups, statuses, channels,
and messages you sent yourself are not answered.

## 2. Bubbles are merged

Consecutive messages are debounced so the AI sees one coherent message instead of
replying to every bubble separately.

## 3. Policy check

Before any AI call, the policy layer checks:

- contact mode: `auto`, `draft`, or `ignore`
- global pause
- quiet hours
- daily and hourly quotas
- per-contact cooldown
- VIP numbers
- message age (old backlog messages are skipped)

If the contact is in `ignore` mode or a guardrail blocks the message, no AI call is made.

## 4. Context is built

The prompt contains:

- **persona/style profile** learned from exported chats
- **relationship card** for that contact
- **few-shot examples** of real conversations
- **memory** of previous conversations
- **recent messages** in the current chat
- **current activity** (optional, for “what are you doing?” questions)
- **safety rules** for family, friends, sensitive topics, and language

## 5. AI writes a reply

The AI provider returns JSON:

```json
{
  "reply": "okee siap",
  "confidence": 0.95,
  "sticker": null,
  "attach_activity": false,
  "reason": "short explanation"
}
```

The app supports any OpenAI-compatible provider: Google Gemini, OpenRouter, DeepSeek,
OpenAI, Groq, or a local Ollama server.

## 6. Safety filters

Before sending, the app checks:

- repeated phrases and stale jokes
- reply length
- profanity level for the contact
- identity/orientation slurs
- language lock (for contacts set to Indonesian)
- confidence threshold
- maximum two AI attempts per message

If a reply is risky or uncertain, it becomes a **draft** instead of being sent.

## 7. Decide: auto, draft, or skip

- **auto**: confidence is high, mode is `auto`, and guardrails pass → send.
- **draft**: mode is `draft`, confidence is low, or a safety rule triggers → wait for you.
- **skip**: no reply is needed, contact is ignored, group/status, or policy blocks it.

## 8. Send and record

The reply is sent through WhatsApp, then recorded in SQLite:

- `messages` — sent/received history
- `drafts` — pending, sent, or discarded replies
- `ai_usage` — token usage per call
- `status_send_log` — status quota log

The dashboard receives live events over SSE.

## Why it can reply automatically

Automation is deliberate, not magic:

1. You set a contact to `auto`.
2. You set a confidence threshold.
3. The AI writes a reply from your own style examples.
4. The safety layer can downgrade it to a draft.
5. Quotas, cooldowns, and quiet hours still apply.

If you do not trust it yet, keep contacts in `draft`. You can approve every message
manually until the style and safety look right.

## What is not automatic

- Groups and statuses are never answered.
- Old backlog messages are skipped.
- Sensitive topics are pushed toward drafts.
- VIP numbers are never answered.
- The bot never sends when paused or outside allowed quotas.

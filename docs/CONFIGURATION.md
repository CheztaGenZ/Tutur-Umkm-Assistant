# Configuration

All settings are read from `.env`. Start from `.env.example`.

## AI

| Variable | Default | Description |
|---|---|---|
| `AI_BASE_URL` | DeepSeek | OpenAI-compatible base URL |
| `AI_API_KEY` | empty | Provider API key |
| `AI_MODEL` | `deepseek-flash` | Text model |
| `AI_VISION_MODEL` | empty | Image/video model; empty = use text model |
| `AI_THINKING` | `off` | `off`, `on`, `auto` (use `auto` for non-DeepSeek providers) |
| `AI_TEMPERATURE` | `1.0` | 0â€“2 |
| `AI_MAX_TOKENS` | `2000` | Output limit |
| `AI_TIMEOUT_MS` | `20000` | Per-attempt timeout |
| `AI_REASONING_EFFORT` | `low` | DeepSeek reasoning effort when thinking is on |

## Identity and dashboard

| Variable | Default | Description |
|---|---|---|
| `MY_NAME` | `Aku` | Your name in chats |
| `PORT` | `3000` | Dashboard port |
| `BIND_HOST` | `127.0.0.1` | Use `0.0.0.0` for LAN access |
| `ALLOWED_HOSTS` | empty | Extra hostnames, comma-separated |
| `WA_DISABLED` | empty | Set to `1` for tests without WhatsApp |

## Anti-ban guardrails

| Variable | Default | Description |
|---|---|---|
| `MAX_MSGS_PER_DAY` | `40` | Global daily limit |
| `MAX_MSGS_PER_HOUR` | `20` | Global hourly limit |
| `MIN_GAP_PER_CONTACT_SEC` | `10` | Per-contact cooldown |
| `QUIET_HOURS` | `01:00-07:00` | Quiet hours, `off` to disable |
| `AUTO_CONFIDENCE_MIN` | `0.55` | Below this, reply becomes a draft |
| `VIP_NUMBERS` | empty | Numbers that are never answered |

## Chat and style

| Variable | Default | Description |
|---|---|---|
| `DEBOUNCE_MS` | `3500` | Merge consecutive bubbles |
| `DEBOUNCE_MAX_WAIT_MS` | `15000` | Maximum debounce wait |
| `FEWSHOT_COUNT` | `12` | Example chats included in the prompt |
| `HISTORY_TURNS` | `10` | Conversation history sent to the AI |

## Stickers

| Variable | Default | Description |
|---|---|---|
| `STICKER_ENABLED` | `true` | Enable stickers |
| `STICKER_CHANCE` | `0.5` | Send probability |
| `STICKER_COOLDOWN_MIN` | `30` | Per-contact cooldown |
| `STICKER_EVERY` | `5` | Minimum messages since the last sticker |

## Voice transcription

| Variable | Default | Description |
|---|---|---|
| `AI_TRANSCRIBE_LOCAL` | `true` | Use local Whisper |
| `AI_TRANSCRIBE_MODEL_LOCAL` | `Xenova/whisper-base` | Local model |
| `AI_TRANSCRIBE_URL` | empty | Online transcription endpoint |
| `AI_TRANSCRIBE_KEY` | empty | Online transcription key |
| `AI_TRANSCRIBE_MODEL` | `whisper-1` | Online transcription model |


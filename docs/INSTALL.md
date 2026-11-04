# Installation

This guide is for a fresh machine. The app stores everything locally; no database
provider is required.

## 1. Requirements

- **Node.js 22 or newer** (`node -v`)
- npm (included with Node.js)
- WhatsApp on your phone
- An AI provider key (Google Gemini, OpenRouter, DeepSeek, OpenAI-compatible, or Ollama)

## 2. Get the code

### Option A: Git

```bash
git clone https://github.com/CheztaGenZ/WhatsApp-Auto-Reply.git
cd WhatsApp-Auto-Reply
```

### Option B: ZIP

1. Open the repository page.
2. Click **Code → Download ZIP**.
3. Extract the ZIP.
4. Open a terminal in the extracted folder.

## 3. Install dependencies

```bash
npm ci
```

`npm ci` installs exactly the versions in `package-lock.json`.

> If npm warns that some install scripts are not approved, the dashboard and text
> replies still work. Voice transcription needs the `onnxruntime-node` install script.
> Approve it when npm asks, or run `npm rebuild onnxruntime-node`.

## 4. Create `.env`

macOS/Linux:

```bash
cp .env.example .env
```

Windows:

```bat
copy .env.example .env
```

Open `.env` and set at least:

```env
AI_API_KEY=your_key_here
MY_NAME=YourName
```

Provider examples:

```env
# Google Gemini
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
AI_MODEL=gemini-3.1-flash-lite
AI_THINKING=auto

# OpenRouter
# AI_BASE_URL=https://openrouter.ai/api/v1
# AI_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free
# AI_THINKING=auto
```

See [CONFIGURATION.md](CONFIGURATION.md) for every variable.

## 5. Start

```bash
npm start
```

You should see:

```text
WA Reply AI
Dashboard : http://localhost:3000
Bind      : 127.0.0.1
```

Open <http://localhost:3000>.

## 6. Link WhatsApp

1. Open WhatsApp on your phone.
2. Go to **Linked devices → Link a device**.
3. Scan the QR code shown in the dashboard.

Use a spare number if possible. Automation is unofficial and carries a ban risk.

## 7. First-run checklist

- [ ] Dashboard opens at `http://localhost:3000`.
- [ ] WhatsApp status is `open`.
- [ ] AI key is detected (`aiReady: true`).
- [ ] Send a test message from another number.
- [ ] Start with the contact in **draft** mode; approve replies manually.
- [ ] Set `auto` only after the replies look right.
- [ ] Keep `MAX_MSGS_PER_DAY` and `MIN_GAP_PER_CONTACT_SEC` conservative.
- [ ] Never expose the dashboard to the internet without VPN/PIN/auth proxy.

## 8. Verify without WhatsApp

The test suite does not need WhatsApp or a real API key:

```bash
npm test
```

## Troubleshooting

### Dashboard does not open

- Check the terminal for the actual port.
- Try `http://127.0.0.1:3000`.
- If the port is busy, set `PORT=3001` in `.env`.

### QR does not appear

- Open the dashboard from the same PC (`localhost`), not from another device.
- Check the terminal log for WhatsApp connection errors.
- Restart the app and scan again.

### No replies

Check:

- contact mode is `auto`
- bot is not paused
- current time is outside `QUIET_HOURS`
- daily/hourly quota is not exhausted
- `AI_API_KEY` and `AI_MODEL` are correct
- dashboard log for `AI HTTP`, `429`, `402`, or `AI gagal`

### Contact shows as “Orang”

WhatsApp uses LID (`@lid`) for chats and PN (`@s.whatsapp.net`) for phone numbers.
The app maps and repairs these automatically. If one remains unnamed, rename it from
the dashboard.

### Voice notes do not work

Local Whisper downloads a model on first use (~150 MB). If `onnxruntime-node` was not
installed, run:

```bash
npm rebuild onnxruntime-node
```

Or configure an online transcription endpoint in `.env`.

### I want LAN/phone access

Set:

```env
BIND_HOST=0.0.0.0
```

Then open `http://<PC-IP>:3000` from the phone. This is read-only for most data. Do not
expose it to the internet without VPN/PIN/auth proxy. See [SECURITY.md](../SECURITY.md).

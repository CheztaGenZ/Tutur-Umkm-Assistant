# Deploy Tutur for judging

Tutur needs a Node process and a real disk because SQLite writes to a file. Do
not use a host with an ephemeral filesystem unless you accept that the demo
resets on every deploy.

## Option A: Render

1. Push this repository to GitHub.
2. In Render, create a Blueprint from the repository. `render.yaml` is included.
3. Set the secret environment variables when Render asks:
   - `AI_API_KEY`
   - `ADMIN_TOKEN` (generate a random string, for example with `openssl rand -hex 16`)
4. After the first deploy, copy the service hostname (for example
   `tutur-demo.onrender.com`) into `ALLOWED_HOSTS` and redeploy.
5. Open `https://<service>.onrender.com/playground`.

The blueprint creates a 1 GB disk mounted at `/var/data`. The app writes
`/var/data/app.db` because `DATA_DIR=/var/data`.

### Environment values

| Variable | Value |
|---|---|
| `DEMO_MODE` | `1` |
| `WA_DISABLED` | `1` |
| `BIND_HOST` | `0.0.0.0` |
| `DATA_DIR` | `/var/data` |
| `ADMIN_TOKEN` | random string |
| `ALLOWED_HOSTS` | your service hostname |
| `QUIET_HOURS` | `off` |
| `AI_BASE_URL` | `https://api.deepseek.com/v1` |
| `AI_MODEL` | `deepseek-chat` |
| `AI_API_KEY` | provider key |
| `BUSINESS_NAME` | `Sari Kitchen` |
| `DEMO_OWNER` | `Sari` |
| `NODE_VERSION` | `22` |

## Option B: Railway

1. Create a project from the repository.
2. Add a volume mounted at `/var/data`.
3. Set the same environment variables.
4. Set the public domain and add it to `ALLOWED_HOSTS`.

## Option C: VPS

```bash
git clone <repo> tutur
cd tutur
npm ci --omit=dev
cp .env.example .env
# edit .env
npm start
```

Put a reverse proxy in front and keep the process alive with systemd or pm2.
Set `ALLOWED_HOSTS` to the public domain.

## Verify before sending the link to judges

1. Open `/playground` from a phone on mobile data, not from localhost.
2. Run the six preset scenarios. Each should return the expected status:
   price question auto, booking draft, hours auto, unknown fact refused,
   complaint draft, spam ignored.
3. Open the dashboard with `?token=<ADMIN_TOKEN>` and confirm the knowledge page
   loads.
4. Restart the service. The knowledge base and events must still exist.
5. Check `/api/status` without a token. It must return 403, not data.
6. Confirm no API key appears in the page source or the repository.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| 403 on every page | `ALLOWED_HOSTS` does not include the public hostname | Add it and redeploy |
| 429 from the AI provider | Provider quota or rate limit | Use another key or provider, check billing |
| Demo resets after deploy | No persistent disk | Attach a disk and set `DATA_DIR` to its mount path |
| Playground says "AI gagal" | Missing or invalid key, or provider timeout | Check logs, test with `node scripts/test-ai.mjs` |
| WhatsApp QR appears in demo | `DEMO_MODE` not set to 1 | Set it and redeploy |

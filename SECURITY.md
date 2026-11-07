# Security Policy

## Supported versions

Only the latest version on `main` receives security fixes.

## Reporting a vulnerability

Do not open a public issue for a security problem. Use **GitHub Security Advisories**:

<https://github.com/CheztaGenZ/tutur/security/advisories/new>

Or contact the repository owner privately.

Please include:

- reproduction steps
- potential impact
- Node.js and OS version
- whether the issue occurs from localhost, LAN, or through a reverse proxy

## Security boundaries

- Default `BIND_HOST=127.0.0.1`; the dashboard is intended for the PC running the bot.
- If you change it to `0.0.0.0`, anyone on the same network can read the data exposed
  by LAN endpoints. Use a VPN, PIN, or authenticated reverse proxy.
- Never expose the port to the internet without additional protection.
- `.env`, `data/`, `profile.md`, and `import-inbox/` contain sensitive data and must
  never be committed.
- WhatsApp Web automation is unofficial. Ban risk and API changes remain.

## Secrets

Never attach API keys, WhatsApp sessions, or databases to public issues. Redact phone
numbers and chat content before reporting a bug.


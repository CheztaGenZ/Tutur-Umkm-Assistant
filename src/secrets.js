import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

let cachedKey = null;
let cachedDir = null;

function secretKey(dataDir) {
  const dir = path.resolve(dataDir);
  if (cachedKey && cachedDir === dir) return cachedKey;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, '.app-secret');
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8').trim();
  } catch {}
  if (!/^[a-f0-9]{64}$/i.test(raw)) {
    raw = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, raw, { mode: 0o600 });
  }
  cachedKey = Buffer.from(raw, 'hex');
  cachedDir = dir;
  return cachedKey;
}

export function encryptSecret(value, dataDir) {
  const text = String(value || '');
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(dataDir), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(value, dataDir) {
  const raw = String(value || '');
  if (!raw) return '';
  const parts = raw.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return raw;
  try {
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const data = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(dataDir), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export function maskSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 8) return 'tersimpan';
  return `${text.slice(0, 3)}...${text.slice(-4)}`;
}

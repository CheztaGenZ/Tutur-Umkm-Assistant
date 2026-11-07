/**
 * Akun pemilik usaha: email + password, sesi cookie, dan tautan OAuth.
 * Tanpa dependency tambahan. Password memakai scrypt, token sesi disimpan
 * sebagai hash supaya bocoran database tidak langsung menjadi sesi aktif.
 */
import crypto from 'node:crypto';

const SCRYPT_KEYLEN = 64;

const mapUser = (row) =>
  row
    ? {
        id: row.id,
        email: row.email,
        name: row.name,
        google_id: row.google_id,
        facebook_id: row.facebook_id,
        avatar_url: row.avatar_url,
        created_at: row.created_at,
        has_password: Boolean(row.password_hash),
        terms_accepted: Boolean(row.terms_accepted_at),
      }
    : null;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored || '').split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const candidate = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

export function findUserByEmail(db, email) {
  return mapUser(db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email)));
}

export function findUserById(db, id) {
  return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(String(id)));
}

export function createUser(db, { email, name, password }) {
  const cleanEmail = normalizeEmail(email);
  const cleanName = String(name || '').trim();
  if (!cleanEmail || !cleanEmail.includes('@')) throw new Error('Email tidak valid');
  if (cleanName.length < 2) throw new Error('Nama minimal 2 karakter');
  if (String(password || '').length < 8) throw new Error('Password minimal 8 karakter');
  if (findUserByEmail(db, cleanEmail)) throw new Error('Email sudah terdaftar');

  const id = `usr_${crypto.randomUUID()}`;
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, terms_accepted_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, cleanEmail, cleanName, hashPassword(password), Date.now(), Date.now());
  return findUserById(db, id);
}

export function authenticate(db, email, password) {
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email));
  if (!row || !row.password_hash) return null;
  return verifyPassword(password, row.password_hash) ? mapUser(row) : null;
}

/** Buat atau hubungkan akun dari Google/Facebook. */
export function upsertOAuthUser(db, { provider, providerId, email, name, avatar }) {
  if (!['google', 'facebook'].includes(provider)) throw new Error('Provider tidak dikenal');
  if (!providerId) throw new Error('ID provider kosong');
  const column = provider === 'google' ? 'google_id' : 'facebook_id';
  const cleanEmail = normalizeEmail(email);

  let row = db.prepare(`SELECT * FROM users WHERE ${column} = ?`).get(String(providerId));
  if (!row && cleanEmail) {
    row = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    if (row) {
      db.prepare(`UPDATE users SET ${column} = ?, avatar_url = COALESCE(?, avatar_url) WHERE id = ?`).run(
        String(providerId),
        avatar || null,
        row.id,
      );
      row = db.prepare('SELECT * FROM users WHERE id = ?').get(row.id);
    }
  }
  if (!row) {
    const id = `usr_${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO users (id, email, name, ${column}, avatar_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      cleanEmail || null,
      String(name || 'Pemilik').trim() || 'Pemilik',
      String(providerId),
      avatar || null,
      Date.now(),
    );
    row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }
  return mapUser(row);
}

export function createSession(db, userId, ttlMs = 7 * 24 * 60 * 60 * 1000) {
  const token = crypto.randomBytes(32).toString('base64url');
  const id = crypto.createHash('sha256').update(token).digest('hex');
  const expires = Date.now() + Math.max(0, Number(ttlMs) || 0);
  db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    String(userId),
    expires,
    Date.now(),
  );
  return token;
}

export function getSessionUser(db, token) {
  if (!token) return null;
  const id = crypto.createHash('sha256').update(String(token)).digest('hex');
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!session) return null;
  if (Number(session.expires_at) <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return null;
  }
  return findUserById(db, session.user_id);
}

export function deleteSession(db, token) {  if (!token) return false;
  const id = crypto.createHash('sha256').update(String(token)).digest('hex');
  return db.prepare('DELETE FROM sessions WHERE id = ?').run(id).changes > 0;
}

export function updateUserName(db, userId, name) {
  const cleanName = String(name || '').trim().slice(0, 80);
  if (cleanName.length < 2) throw new Error('Nama minimal 2 karakter');
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(cleanName, String(userId));
  return findUserById(db, userId);
}

export function changePassword(db, userId, currentPassword, newPassword) {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(String(userId));
  if (!row) throw new Error('Akun tidak ditemukan');
  if (!row.password_hash) throw new Error('Akun ini memakai login Google atau Facebook.');
  if (!verifyPassword(currentPassword, row.password_hash)) {
    throw new Error('Password lama salah.');
  }
  const next = String(newPassword || '');
  if (next.length < 8) throw new Error('Password baru minimal 8 karakter');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), String(userId));
  return true;
}

export function acceptTerms(db, userId) {
  db.prepare('UPDATE users SET terms_accepted_at = ? WHERE id = ?').run(Date.now(), String(userId));
  return findUserById(db, userId);
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      out[key] = part.slice(index + 1).trim();
    }
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, path = '/', httpOnly = true, secure = false, sameSite = 'Lax' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.floor(maxAge)}`);
  return parts.join('; ');
}

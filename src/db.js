import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contacts (
  jid            TEXT PRIMARY KEY,
  number         TEXT,
  name           TEXT,
  import_name    TEXT,
  mode           TEXT NOT NULL DEFAULT 'draft',
  style_profile  TEXT,
  relationship   TEXT,
  sample_count   INTEGER NOT NULL DEFAULT 0,
  last_seen_at   INTEGER,
  profiled_at    INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contacts_import_name ON contacts(import_name);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  jid        TEXT NOT NULL,
  direction  TEXT NOT NULL,
  body       TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  wa_id      TEXT,
  status     TEXT,
  reason     TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_jid_ts ON messages(jid, ts);

CREATE TABLE IF NOT EXISTS drafts (
  id            TEXT PRIMARY KEY,
  jid           TEXT NOT NULL,
  incoming_id   TEXT,
  incoming_body TEXT NOT NULL,
  reply         TEXT,
  confidence    REAL,
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    INTEGER NOT NULL,
  sent_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status, created_at);

CREATE TABLE IF NOT EXISTS examples (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  jid       TEXT NOT NULL,
  their     TEXT NOT NULL,
  mine      TEXT NOT NULL,
  ts        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_examples_jid ON examples(jid);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Nama dari buku kontak WhatsApp (nama yang KAMU simpan).
CREATE TABLE IF NOT EXISTS wa_contacts (
  jid        TEXT PRIMARY KEY,
  name       TEXT,
  updated_at INTEGER
);

-- Pesanmu di grup: dipakai untuk melatih gaya, grup tetap tidak dibalas.
CREATE TABLE IF NOT EXISTS group_samples (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Aktivitas terkini: dipakai AI untuk menjawab "lagi apa" + lampiran foto.
CREATE TABLE IF NOT EXISTS activities (
  id         TEXT PRIMARY KEY,
  text       TEXT NOT NULL,
  image_path TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Status WhatsApp terjadwal.
CREATE TABLE IF NOT EXISTS status_jobs (
  id           TEXT PRIMARY KEY,
  image_path   TEXT,
  caption      TEXT,
  scheduled_at INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  wa_message_id TEXT,
  wa_status_jids TEXT,
  created_at   INTEGER NOT NULL,
  sent_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_status_due ON status_jobs(status, scheduled_at);

-- Log kirim status yang tidak ikut terhapus saat riwayat dashboard dibersihkan.
CREATE TABLE IF NOT EXISTS status_send_log (
  job_id   TEXT PRIMARY KEY,
  sent_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_status_send_log_at ON status_send_log(sent_at);

-- Pemakaian token per panggilan AI.
CREATE TABLE IF NOT EXISTS ai_usage (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ts                INTEGER NOT NULL,
  kind              TEXT NOT NULL DEFAULT 'chat',
  model             TEXT,
  base_url          TEXT,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens      INTEGER NOT NULL DEFAULT 0,
  cached_tokens     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_ts ON ai_usage(ts);

-- Sumber fakta bisnis untuk jawaban yang ter-grounding.
CREATE TABLE IF NOT EXISTS knowledge (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL DEFAULT 'demo',
  category   TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  keywords   TEXT NOT NULL DEFAULT '',
  active     INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_active ON knowledge(active, category);

-- Akun pemilik usaha.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT,
  google_id     TEXT UNIQUE,
  facebook_id   TEXT UNIQUE,
  avatar_url    TEXT,
  terms_accepted_at INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Katalog produk milik satu akun.
CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  price       INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT 'Menu',
  image_path  TEXT,
  available   INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_owner ON products(owner_id);

-- Event playground anonim. Tidak menyimpan isi percakapan.
CREATE TABLE IF NOT EXISTS playground_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_hash TEXT NOT NULL,
  intent       TEXT,
  action       TEXT,
  needs_owner  INTEGER NOT NULL DEFAULT 0,
  latency_ms   INTEGER NOT NULL DEFAULT 0,
  ts           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_playground_events_ts ON playground_events(ts);
`;

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'app.db'));
  db.exec(SCHEMA);

  // Migrasi ringan: kolom tingkat tutur per kontak.
  const cols = db.prepare('PRAGMA table_info(contacts)').all();
  if (!cols.some((c) => c.name === 'register')) {
    db.exec("ALTER TABLE contacts ADD COLUMN register TEXT NOT NULL DEFAULT 'auto'");
  }
  if (!cols.some((c) => c.name === 'alias')) {
    db.exec('ALTER TABLE contacts ADD COLUMN alias TEXT');
  }
  if (!cols.some((c) => c.name === 'language')) {
    db.exec("ALTER TABLE contacts ADD COLUMN language TEXT NOT NULL DEFAULT 'auto'");
  }
  if (!cols.some((c) => c.name === 'burst')) {
    db.exec('ALTER TABLE contacts ADD COLUMN burst INTEGER NOT NULL DEFAULT 3');
  }
  if (!cols.some((c) => c.name === 'memory')) {
    db.exec('ALTER TABLE contacts ADD COLUMN memory TEXT');
  }

  const knowledgeCols = db.prepare('PRAGMA table_info(knowledge)').all();
  if (!knowledgeCols.some((c) => c.name === 'owner_id')) {
    db.exec("ALTER TABLE knowledge ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'demo'");
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_owner ON knowledge(owner_id)');

  const userCols = db.prepare('PRAGMA table_info(users)').all();
  if (!userCols.some((c) => c.name === 'terms_accepted_at')) {
    db.exec('ALTER TABLE users ADD COLUMN terms_accepted_at INTEGER');
  }

  const productCols = db.prepare('PRAGMA table_info(products)').all();
  if (!productCols.some((c) => c.name === 'image_path')) {
    db.exec('ALTER TABLE products ADD COLUMN image_path TEXT');
  }

  const statusCols = db.prepare('PRAGMA table_info(status_jobs)').all();  if (!statusCols.some((c) => c.name === 'wa_message_id')) {
    db.exec('ALTER TABLE status_jobs ADD COLUMN wa_message_id TEXT');
  }
  if (!statusCols.some((c) => c.name === 'wa_status_jids')) {
    db.exec('ALTER TABLE status_jobs ADD COLUMN wa_status_jids TEXT');
  }

  resetSendingStatusJobs(db);
  backfillStatusSendLog(db);
  db.prepare("UPDATE drafts SET status = 'pending' WHERE status = 'sending'").run();

  return db;
}

const now = () => Date.now();

// Nama kontak yang hampir pasti keluarga -> wajib sopan.
export const FAMILY_RE =
  /^(mamah|mama|mami|ibu|ibuk|bunda|umi|ayah|bapak|papa|abi|koko|kakak|kak|adek|adik|nenek|kakek|uti|pakde|bude|om|tante|sepupu)\b/i;

export const isFamilyName = (name) => FAMILY_RE.test(String(name || '').trim());

const normalizeWaJid = (jid) => {
  const value = String(jid || '').trim();
  if (!value.endsWith('@s.whatsapp.net')) return value;
  return `${value.split('@')[0].split(':')[0]}@s.whatsapp.net`;
};

export function setWaName(db, jid, name) {
  if (!jid || !name) return;
  db.prepare(
    'INSERT INTO wa_contacts (jid, name, updated_at) VALUES (?, ?, ?) ON CONFLICT(jid) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at',
  ).run(normalizeWaJid(jid), name, now());
}

export function getWaName(db, jid) {
  const raw = String(jid || '').trim();
  const normalized = normalizeWaJid(raw);
  return (
    db
      .prepare('SELECT name FROM wa_contacts WHERE jid = ? OR jid = ? LIMIT 1')
      .get(normalized, raw)?.name ?? null
  );
}

/* ------------------------------- contacts ------------------------------- */

export function upsertContact(db, { jid, number, name, importName }) {
  const ts = now();
  const existing = db.prepare('SELECT * FROM contacts WHERE jid = ?').get(jid);
  if (existing) {
    db.prepare(
      `UPDATE contacts SET
         number = COALESCE(?, number),
         name = COALESCE(?, name),
         import_name = COALESCE(?, import_name),
         updated_at = ?
       WHERE jid = ?`,
    ).run(number ?? null, name ?? null, importName ?? null, ts, jid);
    if (isFamilyName(name ?? existing.name)) {
      db.prepare("UPDATE contacts SET register = 'keluarga' WHERE jid = ? AND register IN ('auto','sopan')").run(jid);
    }
    return getContact(db, jid);
  }
  db.prepare(
    `INSERT INTO contacts (jid, number, name, import_name, mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?)`,
  ).run(jid, number ?? null, name ?? null, importName ?? null, ts, ts);
  if (isFamilyName(name)) {
    db.prepare("UPDATE contacts SET register = 'keluarga' WHERE jid = ? AND register IN ('auto','sopan')").run(jid);
  }
  return getContact(db, jid);
}

export function getContact(db, jid) {
  return db.prepare('SELECT * FROM contacts WHERE jid = ?').get(jid) ?? null;
}

const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Cari kontak yang dulu di-import berdasarkan nama (belum ketemu JID-nya). */
export function findContactByImportName(db, name) {
  if (!name) return null;

  const exact =
    db
      .prepare('SELECT * FROM contacts WHERE lower(import_name) = lower(?) OR lower(name) = lower(?) LIMIT 1')
      .get(name, name) ?? null;
  if (exact) return exact;

  // Fallback: cocokkan nama yang sudah dinormalisasi, tapi jangan menebak
  // prefix. "Budi" dan "Budiman" adalah orang berbeda.
  const target = normName(name);
  if (target.length < 4) return null;

  const placeholders = db.prepare("SELECT * FROM contacts WHERE jid LIKE 'name:%'").all();
  return (
    placeholders.find((row) => {
      const n = normName(row.import_name || row.name);
      return n.length >= 4 && n === target;
    }) ?? null
  );
}

export function linkContactJid(db, oldJid, newJid, number) {
  if (oldJid === newJid) return;
  const ts = now();
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE contacts SET jid = ?, number = ?, updated_at = ? WHERE jid = ?').run(
      newJid,
      number ?? null,
      ts,
      oldJid,
    );
    db.prepare('UPDATE messages SET jid = ? WHERE jid = ?').run(newJid, oldJid);
    db.prepare('UPDATE drafts SET jid = ? WHERE jid = ?').run(newJid, oldJid);
    db.prepare('UPDATE examples SET jid = ? WHERE jid = ?').run(newJid, oldJid);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function listContacts(db, q = '') {
  const like = `%${q}%`;
  return db
    .prepare(
      `SELECT * FROM contacts
       WHERE (? = '' OR name LIKE ? OR import_name LIKE ? OR number LIKE ?)
       ORDER BY last_seen_at DESC NULLS LAST, updated_at DESC
       LIMIT 500`,
    )
    .all(q, like, like, like);
}

export function setContactMode(db, jid, mode) {
  if (!['auto', 'draft', 'ignore'].includes(mode)) throw new Error('mode tidak valid');
  db.prepare('UPDATE contacts SET mode = ?, updated_at = ? WHERE jid = ?').run(mode, now(), jid);
  return getContact(db, jid);
}

export function setContactRegister(db, jid, register) {
  const allowed = ['auto', 'wajib_sopan', 'keluarga', 'temen', 'temen_dekat', 'temen_poll'];
  if (!allowed.includes(register)) throw new Error('register tidak valid');
  db.prepare('UPDATE contacts SET register = ?, updated_at = ? WHERE jid = ?').run(register, now(), jid);
  return getContact(db, jid);
}

export function setContactAlias(db, jid, alias) {
  db.prepare('UPDATE contacts SET alias = ?, updated_at = ? WHERE jid = ?').run(
    alias || null,
    now(),
    jid,
  );
  return getContact(db, jid);
}

export function setContactLanguage(db, jid, language) {
  if (!['auto', 'id', 'jv'].includes(language)) throw new Error('language tidak valid');
  db.prepare('UPDATE contacts SET language = ?, updated_at = ? WHERE jid = ?').run(
    language,
    now(),
    jid,
  );
  return getContact(db, jid);
}

export function setContactBurst(db, jid, burst) {
  const n = Math.max(1, Math.min(8, Number(burst) || 3));
  db.prepare('UPDATE contacts SET burst = ?, updated_at = ? WHERE jid = ?').run(n, now(), jid);
  return getContact(db, jid);
}

export function saveProfile(db, jid, { styleProfile, relationship, sampleCount }) {
  const ts = now();
  db.prepare(
    `UPDATE contacts SET
       style_profile = COALESCE(?, style_profile),
       relationship  = COALESCE(?, relationship),
       sample_count  = COALESCE(?, sample_count),
       profiled_at   = ?,
       updated_at    = ?
     WHERE jid = ?`,
  ).run(
    styleProfile ? JSON.stringify(styleProfile) : null,
    relationship ?? null,
    sampleCount ?? null,
    ts,
    ts,
    jid,
  );
}

/* -------------------------------- messages ------------------------------- */

export function insertMessage(db, { id, jid, direction, body, ts, waId, status, reason }) {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, jid, direction, body, ts, wa_id, status, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, jid, direction, body, ts ?? now(), waId ?? null, status ?? null, reason ?? null);
}

export function updateMessageStatus(db, id, status, reason = null) {
  db.prepare('UPDATE messages SET status = ?, reason = ? WHERE id = ?').run(status, reason, id);
}

export function touchContact(db, jid) {
  db.prepare('UPDATE contacts SET last_seen_at = ? WHERE jid = ?').run(now(), jid);
}

export function recentMessages(db, jid, limit = 20) {
  return db
    .prepare('SELECT * FROM messages WHERE jid = ? AND ts <= ? ORDER BY ts DESC LIMIT ?')
    .all(jid, now(), limit)
    .reverse();
}

export function countOutSince(db, sinceTs, jid = null) {  if (jid) {
    return db
      .prepare(
        `SELECT COUNT(*) AS n FROM messages
         WHERE direction = 'out' AND ts >= ? AND jid = ? AND status IN ('auto_sent','sent')`,
      )
      .get(sinceTs, jid).n;
  }
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM messages
       WHERE direction = 'out' AND ts >= ? AND status IN ('auto_sent','sent')`,
    )
    .get(sinceTs).n;
}

export function countOutMessages(db, jid) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE jid = ? AND direction = 'out'")
    .get(jid).n;
}

/* --------------------------------- drafts -------------------------------- */

export function createDraft(db, d) {
  const id = d.id ?? `dr_${now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    `INSERT INTO drafts (id, jid, incoming_id, incoming_body, reply, confidence, reason, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, d.jid, d.incomingId ?? null, d.incomingBody, d.reply ?? null, d.confidence ?? null, d.reason ?? null, d.status ?? 'pending', d.createdAt ?? now());
  return getDraft(db, id);
}

export function getDraft(db, id) {
  return db.prepare('SELECT * FROM drafts WHERE id = ?').get(id) ?? null;
}

export function listDrafts(db, status = 'pending') {
  return db
    .prepare(
      `SELECT d.*, c.name AS contact_name, c.number AS contact_number, c.mode AS contact_mode
       FROM drafts d LEFT JOIN contacts c ON c.jid = d.jid
       WHERE d.status = ? ORDER BY d.created_at DESC LIMIT 100`,
    )
    .all(status);
}

/** Klaim draft sebelum dikirim. Hanya satu request yang boleh menang. */
export function claimDraft(db, id, from = 'pending', to = 'sending') {
  const result = db.prepare('UPDATE drafts SET status = ? WHERE id = ? AND status = ?').run(to, id, from);
  return Number(result.changes) === 1;
}

export function updateDraft(db, id, patch) {
  const fields = [];
  const values = [];
  for (const key of ['reply', 'status', 'confidence', 'reason', 'sent_at']) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(patch[key]);
    }
  }
  if (!fields.length) return getDraft(db, id);
  values.push(id);
  db.prepare(`UPDATE drafts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getDraft(db, id);
}

export function clearDrafts(db, status = 'pending') {
  const result = db.prepare('DELETE FROM drafts WHERE status = ?').run(status);
  return Number(result.changes) || 0;
}

/* -------------------------------- examples ------------------------------- */

export function addExample(db, { jid, their, mine, ts }) {
  db.prepare('INSERT INTO examples (jid, their, mine, ts) VALUES (?, ?, ?, ?)').run(
    jid,
    their,
    mine,
    ts ?? now(),
  );
}

export function listExamples(db, jid, limit = 12) {
  const rows = db
    .prepare('SELECT their, mine FROM examples WHERE jid = ? ORDER BY ts DESC LIMIT 300')
    .all(jid);

  // Utamakan contoh pendek: gaya aslinya 2-8 kata, bukan paragraf.
  const short = rows.filter((r) => r.mine.length <= 60);
  const pool = short.length >= limit ? short : rows;

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, limit);
}

export function countExamples(db, jid) {
  return db.prepare('SELECT COUNT(*) AS n FROM examples WHERE jid = ?').get(jid).n;
}

/* ------------------------------- aktivitas ------------------------------- */

export function createActivity(db, { id, text, imagePath, expiresAt }) {
  deactivateAllActivities(db);
  db.prepare(
    'INSERT INTO activities (id, text, image_path, active, expires_at, created_at) VALUES (?, ?, ?, 1, ?, ?)',
  ).run(id, text, imagePath ?? null, expiresAt ?? null, now());
  return getActivity(db, id);
}

export function getActivity(db, id) {
  return db.prepare('SELECT * FROM activities WHERE id = ?').get(id) ?? null;
}

export function getActiveActivity(db) {
  return (
    db
      .prepare(
        'SELECT * FROM activities WHERE active = 1 AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 1',
      )
      .get(now()) ?? null
  );
}

export function listActivities(db, limit = 20) {
  return db.prepare('SELECT * FROM activities ORDER BY created_at DESC LIMIT ?').all(limit);
}

export function setActivityActive(db, id, active) {
  db.prepare('UPDATE activities SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  return getActivity(db, id);
}

export function deactivateAllActivities(db) {
  db.prepare('UPDATE activities SET active = 0 WHERE active = 1').run();
}

export function deleteActivity(db, id) {
  db.prepare('DELETE FROM activities WHERE id = ?').run(id);
}

/* ------------------------------ status jobs ------------------------------ */

export function createStatusJob(db, { id, imagePath, caption, scheduledAt }) {
  db.prepare(
    'INSERT INTO status_jobs (id, image_path, caption, scheduled_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, imagePath ?? null, caption ?? null, scheduledAt, 'pending', now());
  return getStatusJob(db, id);
}

export function getStatusJob(db, id) {
  return db.prepare('SELECT * FROM status_jobs WHERE id = ?').get(id) ?? null;
}

export function listStatusJobs(db, limit = 60) {
  return db.prepare('SELECT * FROM status_jobs ORDER BY scheduled_at DESC LIMIT ?').all(limit);
}

export function dueStatusJobs(db, at = now()) {
  return db
    .prepare("SELECT * FROM status_jobs WHERE status = 'pending' AND scheduled_at <= ? ORDER BY scheduled_at ASC")
    .all(at);
}

/** Klaim job sebelum upload. Hanya satu pemanggil yang boleh menang. */
export function claimStatusJob(db, id, from = ['pending']) {
  const statuses = from.filter(Boolean);
  if (!statuses.length) return false;
  const placeholders = statuses.map(() => '?').join(', ');
  const result = db
    .prepare(`UPDATE status_jobs SET status = 'sending' WHERE id = ? AND status IN (${placeholders})`)
    .run(id, ...statuses);
  return Number(result.changes) === 1;
}

export function logStatusSend(db, jobId, sentAt = now()) {
  db.prepare('INSERT OR IGNORE INTO status_send_log (job_id, sent_at) VALUES (?, ?)').run(jobId, sentAt);
}

/** Saat proses restart, job yang tertahan di 'sending' dikembalikan ke pending. */
export function resetSendingStatusJobs(db) {
  db.prepare("UPDATE status_jobs SET status = 'pending' WHERE status = 'sending'").run();
}

/** Isi log lama dari baris sent supaya kuota hari ini tidak ter-reset setelah upgrade. */
export function backfillStatusSendLog(db) {
  db.prepare(
    "INSERT OR IGNORE INTO status_send_log (job_id, sent_at) SELECT id, sent_at FROM status_jobs WHERE sent_at IS NOT NULL",
  ).run();
}

export function updateStatusJob(db, id, patch) {
  const fields = [];
  const values = [];
  for (const key of ['status', 'attempts', 'last_error', 'sent_at', 'wa_message_id', 'wa_status_jids']) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(patch[key]);
    }
  }
  if (!fields.length) return getStatusJob(db, id);
  values.push(id);
  db.prepare(`UPDATE status_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getStatusJob(db, id);
}

export function countStatusSentToday(db) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return db
    .prepare('SELECT COUNT(*) AS n FROM status_send_log WHERE sent_at >= ?')
    .get(start.getTime()).n;
}

/* ----------------------------------- kv ---------------------------------- */

export function kvGet(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function kvSet(db, key, value) {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    String(value),
  );
}

/* -------------------------------- ai usage ------------------------------- */

const usageInt = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

export function recordAiUsage(db, row = {}) {
  db.prepare(
    `INSERT INTO ai_usage
       (ts, kind, model, base_url, prompt_tokens, completion_tokens, total_tokens, cached_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    Number(row.ts) || Date.now(),
    String(row.kind || 'chat'),
    row.model ? String(row.model) : null,
    row.baseUrl ? String(row.baseUrl) : null,
    usageInt(row.promptTokens),
    usageInt(row.completionTokens),
    usageInt(row.totalTokens),
    usageInt(row.cachedTokens),
  );
}

export function aiUsageTotals(db) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const all = db
    .prepare(
      `SELECT
         COUNT(*) AS calls,
         COALESCE(SUM(total_tokens), 0) AS totalTokens,
         COALESCE(SUM(prompt_tokens), 0) AS promptTokens,
         COALESCE(SUM(completion_tokens), 0) AS completionTokens,
         COALESCE(SUM(cached_tokens), 0) AS cachedTokens,
         MAX(ts) AS lastAt
       FROM ai_usage`,
    )
    .get();
  const today = db
    .prepare(
      `SELECT
         COUNT(*) AS todayCalls,
         COALESCE(SUM(total_tokens), 0) AS todayTokens
       FROM ai_usage WHERE ts >= ?`,
    )
    .get(start.getTime());

  return {
    totalTokens: usageInt(all.totalTokens),
    todayTokens: usageInt(today.todayTokens),
    calls: usageInt(all.calls),
    todayCalls: usageInt(today.todayCalls),
    promptTokens: usageInt(all.promptTokens),
    completionTokens: usageInt(all.completionTokens),
    cachedTokens: usageInt(all.cachedTokens),
    lastAt: all.lastAt || null,
  };
}

export function aiUsageSummary(db) {
  const totals = aiUsageTotals(db);
  const byKind = db
    .prepare(
      `SELECT kind, COUNT(*) AS calls, COALESCE(SUM(total_tokens), 0) AS tokens
       FROM ai_usage
       GROUP BY kind
       ORDER BY tokens DESC, calls DESC`,
    )
    .all()
    .map((r) => ({ kind: r.kind, calls: usageInt(r.calls), tokens: usageInt(r.tokens) }));

  const last = db
    .prepare(
      `SELECT ts, kind, model, total_tokens
       FROM ai_usage ORDER BY ts DESC LIMIT 1`,
    )
    .get();

  return {
    ...totals,
    byKind,
    last: last
      ? {
          ts: last.ts,
          kind: last.kind,
          model: last.model,
          totalTokens: usageInt(last.total_tokens),
        }
      : null,
  };
}

/* ------------------------------- knowledge ------------------------------- */

const knowledgeSlug = (s) =>
  String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'knowledge';

const mapKnowledge = (row) =>
  row
    ? {
        id: row.id,
        owner_id: row.owner_id,
        category: row.category,
        title: row.title,
        body: row.body,
        keywords: row.keywords,
        active: row.active === 1 || row.active === true ? 1 : 0,
        updated_at: row.updated_at,
      }
    : null;

export function listKnowledge(db, { activeOnly = false, ownerId = null } = {}) {
  const where = [];
  const params = [];
  if (activeOnly) where.push('active = 1');
  if (ownerId) {
    where.push('owner_id = ?');
    params.push(ownerId);
  }
  const sql = `SELECT * FROM knowledge${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
    ORDER BY category, title`;
  return db.prepare(sql).all(...params).map(mapKnowledge);
}

export function getKnowledge(db, id) {
  return mapKnowledge(db.prepare('SELECT * FROM knowledge WHERE id = ?').get(id));
}

export function upsertKnowledge(
  db,
  { id, ownerId = 'demo', category, title, body, keywords = '', active = 1 } = {},
) {
  const cleanTitle = String(title || '').trim();
  const cleanBody = String(body || '').trim();
  if (!cleanTitle) throw new Error('Judul knowledge wajib diisi');
  if (!cleanBody) throw new Error('Isi knowledge wajib diisi');
  const cleanId = id ? String(id) : knowledgeSlug(cleanTitle);
  db.prepare(
    `INSERT INTO knowledge (id, owner_id, category, title, body, keywords, active, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       owner_id = excluded.owner_id,
       category = excluded.category,
       title = excluded.title,
       body = excluded.body,
       keywords = excluded.keywords,
       active = excluded.active,
       updated_at = excluded.updated_at`,
  ).run(
    cleanId,
    String(ownerId || 'demo'),
    String(category || 'umum').trim() || 'umum',
    cleanTitle,
    cleanBody,
    String(keywords || ''),
    active ? 1 : 0,
    Date.now(),
  );
  return getKnowledge(db, cleanId);
}

export function deleteKnowledge(db, id) {
  return db.prepare('DELETE FROM knowledge WHERE id = ?').run(String(id)).changes > 0;
}

/* ---------------------------- playground events --------------------------- */

export function recordPlaygroundEvent(db, { sessionHash, intent, action, needsOwner, latencyMs }) {
  db.prepare(
    `INSERT INTO playground_events (session_hash, intent, action, needs_owner, latency_ms, ts)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    String(sessionHash || ''),
    String(intent || ''),
    String(action || ''),
    needsOwner ? 1 : 0,
    Math.max(0, Math.round(Number(latencyMs) || 0)),
    Date.now(),
  );
}

export function playgroundEventTotals(db) {
  return db
    .prepare(
      `SELECT
         COUNT(*) AS messages,
         COALESCE(SUM(CASE WHEN action = 'auto' THEN 1 ELSE 0 END), 0) AS auto,
         COALESCE(SUM(CASE WHEN action = 'draft' THEN 1 ELSE 0 END), 0) AS draft,
         COALESCE(SUM(CASE WHEN action = 'ignore' THEN 1 ELSE 0 END), 0) AS ignored,
         COALESCE(SUM(CASE WHEN needs_owner = 1 THEN 1 ELSE 0 END), 0) AS escalated,
         COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
       FROM playground_events`,
    )
    .get();
}

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contacts (
  owner_id       TEXT NOT NULL DEFAULT 'demo',
  jid            TEXT NOT NULL,
  number         TEXT,
  name           TEXT,
  import_name    TEXT,
  mode           TEXT NOT NULL DEFAULT 'auto',
  style_profile  TEXT,
  relationship   TEXT,
  sample_count   INTEGER NOT NULL DEFAULT 0,
  last_seen_at   INTEGER,
  profiled_at    INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (owner_id, jid)
);
CREATE INDEX IF NOT EXISTS idx_contacts_import_name ON contacts(owner_id, import_name);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL DEFAULT 'demo',
  jid        TEXT NOT NULL,
  direction  TEXT NOT NULL,
  body       TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  wa_id      TEXT,
  status     TEXT,
  reason     TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_jid_ts ON messages(owner_id, jid, ts);

CREATE TABLE IF NOT EXISTS drafts (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL DEFAULT 'demo',
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
CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(owner_id, status, created_at);

CREATE TABLE IF NOT EXISTS examples (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id  TEXT NOT NULL DEFAULT 'demo',
  jid       TEXT NOT NULL,
  their     TEXT NOT NULL,
  mine      TEXT NOT NULL,
  ts        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_examples_jid ON examples(owner_id, jid);

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
  owner_id   TEXT NOT NULL DEFAULT 'demo',
  text       TEXT NOT NULL,
  image_path TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Status WhatsApp terjadwal.
CREATE TABLE IF NOT EXISTS status_jobs (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL DEFAULT 'demo',
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
  owner_id TEXT NOT NULL DEFAULT 'demo',
  sent_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_status_send_log_at ON status_send_log(owner_id, sent_at);

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

-- Profil usaha per akun, dipakai sebagai knowledge dasar.
CREATE TABLE IF NOT EXISTS business_profiles (
  owner_id   TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  category   TEXT,
  location   TEXT,
  hours      TEXT,
  specialty  TEXT,
  contact    TEXT,
  notes      TEXT,
  payment_methods TEXT,
  bank_info  TEXT,
  qris_image_path TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL,
  customer_name TEXT,
  items         TEXT NOT NULL,
  total         INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending',
  source        TEXT NOT NULL DEFAULT 'chat',
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_owner ON orders(owner_id, created_at);

-- Pengaturan AI per akun. API key disimpan terenkripsi oleh lapisan server.
CREATE TABLE IF NOT EXISTS ai_settings (
  owner_id    TEXT PRIMARY KEY,
  base_url    TEXT NOT NULL,
  api_key     TEXT NOT NULL,
  model       TEXT NOT NULL,
  vision_model TEXT,
  thinking    TEXT NOT NULL DEFAULT 'off',
  temperature REAL NOT NULL DEFAULT 0.8,
  max_tokens  INTEGER NOT NULL DEFAULT 2000,
  updated_at  INTEGER NOT NULL
);

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

  const legacyOwner = String(
    db.prepare("SELECT value FROM kv WHERE key = 'wa_owner_id'").get()?.value || 'demo',
  ).replace(/'/g, "''");

  if (!cols.some((c) => c.name === 'owner_id')) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      ALTER TABLE contacts RENAME TO contacts_old;
      CREATE TABLE contacts (
        owner_id       TEXT NOT NULL DEFAULT 'demo',
        jid            TEXT NOT NULL,
        number         TEXT,
        name           TEXT,
        import_name    TEXT,
        mode           TEXT NOT NULL DEFAULT 'auto',
        style_profile  TEXT,
        relationship   TEXT,
        sample_count   INTEGER NOT NULL DEFAULT 0,
        last_seen_at   INTEGER,
        profiled_at    INTEGER,
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL,
        register       TEXT NOT NULL DEFAULT 'auto',
        alias          TEXT,
        language       TEXT NOT NULL DEFAULT 'auto',
        burst          INTEGER NOT NULL DEFAULT 3,
        memory         TEXT,
        PRIMARY KEY (owner_id, jid)
      );
      INSERT INTO contacts
        (owner_id, jid, number, name, import_name, mode, style_profile, relationship,
         sample_count, last_seen_at, profiled_at, created_at, updated_at, register, alias,
         language, burst, memory)
      SELECT '${legacyOwner}', jid, number, name, import_name, mode, style_profile, relationship,
         sample_count, last_seen_at, profiled_at, created_at, updated_at, register, alias,
         language, burst, memory
      FROM contacts_old;
      DROP TABLE contacts_old;
    `);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_contacts_import_name ON contacts(owner_id, import_name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_contacts_last_seen ON contacts(owner_id, last_seen_at)');

  for (const table of ['messages', 'drafts', 'examples', 'activities', 'status_jobs', 'status_send_log']) {
    const tableCols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!tableCols.some((c) => c.name === 'owner_id')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'demo'`);
      if (legacyOwner !== 'demo') {
        db.exec(`UPDATE ${table} SET owner_id = '${legacyOwner}'`);
      }
    }
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_owner_jid_ts ON messages(owner_id, jid, ts)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_drafts_owner_status ON drafts(owner_id, status, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_examples_owner_jid ON examples(owner_id, jid)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_activities_owner ON activities(owner_id, active)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_status_owner_due ON status_jobs(owner_id, status, scheduled_at)');

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

  const businessCols = db.prepare('PRAGMA table_info(business_profiles)').all();
  for (const [name, type] of [
    ['payment_methods', 'TEXT'],
    ['bank_info', 'TEXT'],
    ['qris_image_path', 'TEXT'],
  ]) {
    if (!businessCols.some((c) => c.name === name)) {
      db.exec(`ALTER TABLE business_profiles ADD COLUMN ${name} ${type}`);
    }
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

export function upsertContact(db, { ownerId = 'demo', jid, number, name, importName }) {
  const ts = now();
  const owner = String(ownerId);
  const existing = db
    .prepare('SELECT * FROM contacts WHERE owner_id = ? AND jid = ?')
    .get(owner, jid);
  if (existing) {
    db.prepare(
      `UPDATE contacts SET
         number = COALESCE(?, number),
         name = COALESCE(?, name),
         import_name = COALESCE(?, import_name),
         updated_at = ?
       WHERE owner_id = ? AND jid = ?`,
    ).run(number ?? null, name ?? null, importName ?? null, ts, owner, jid);
    if (isFamilyName(name ?? existing.name)) {
      db.prepare(
        "UPDATE contacts SET register = 'keluarga' WHERE owner_id = ? AND jid = ? AND register IN ('auto','sopan')",
      ).run(owner, jid);
    }
    return getContact(db, jid, owner);
  }
  db.prepare(
    `INSERT INTO contacts (owner_id, jid, number, name, import_name, mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'auto', ?, ?)`,
  ).run(owner, jid, number ?? null, name ?? null, importName ?? null, ts, ts);
  if (isFamilyName(name)) {
    db.prepare(
      "UPDATE contacts SET register = 'keluarga' WHERE owner_id = ? AND jid = ? AND register IN ('auto','sopan')",
    ).run(owner, jid);
  }
  return getContact(db, jid, owner);
}

export function getContact(db, jid, ownerId = 'demo') {
  return (
    db
      .prepare('SELECT * FROM contacts WHERE owner_id = ? AND jid = ?')
      .get(String(ownerId), jid) ?? null
  );
}

const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Cari kontak yang dulu di-import berdasarkan nama (belum ketemu JID-nya). */
export function findContactByImportName(db, name, ownerId = 'demo') {
  if (!name) return null;
  const owner = String(ownerId);

  const exact =
    db
      .prepare(
        'SELECT * FROM contacts WHERE owner_id = ? AND (lower(import_name) = lower(?) OR lower(name) = lower(?)) LIMIT 1',
      )
      .get(owner, name, name) ?? null;
  if (exact) return exact;

  // Fallback: cocokkan nama yang sudah dinormalisasi, tapi jangan menebak
  // prefix. "Budi" dan "Budiman" adalah orang berbeda.
  const target = normName(name);
  if (target.length < 4) return null;

  const placeholders = db
    .prepare("SELECT * FROM contacts WHERE owner_id = ? AND jid LIKE 'name:%'")
    .all(owner);
  return (
    placeholders.find((row) => {
      const n = normName(row.import_name || row.name);
      return n.length >= 4 && n === target;
    }) ?? null
  );
}

export function linkContactJid(db, oldJid, newJid, number, ownerId = 'demo') {
  if (oldJid === newJid) return;
  const owner = String(ownerId);
  const ts = now();
  db.exec('BEGIN');
  try {
    db.prepare(
      'UPDATE contacts SET jid = ?, number = ?, updated_at = ? WHERE owner_id = ? AND jid = ?',
    ).run(newJid, number ?? null, ts, owner, oldJid);
    db.prepare('UPDATE messages SET jid = ? WHERE owner_id = ? AND jid = ?').run(
      newJid,
      owner,
      oldJid,
    );
    db.prepare('UPDATE drafts SET jid = ? WHERE owner_id = ? AND jid = ?').run(
      newJid,
      owner,
      oldJid,
    );
    db.prepare('UPDATE examples SET jid = ? WHERE owner_id = ? AND jid = ?').run(
      newJid,
      owner,
      oldJid,
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function listContacts(db, q = '', ownerId = 'demo') {
  const like = `%${q}%`;
  return db
    .prepare(
      `SELECT * FROM contacts
       WHERE owner_id = ? AND (? = '' OR name LIKE ? OR import_name LIKE ? OR number LIKE ?)
       ORDER BY last_seen_at DESC NULLS LAST, updated_at DESC
       LIMIT 500`,
    )
    .all(String(ownerId), q, like, like, like);
}

export function setContactMode(db, jid, mode, ownerId = 'demo') {
  if (!['auto', 'draft', 'ignore'].includes(mode)) throw new Error('mode tidak valid');
  db.prepare(
    'UPDATE contacts SET mode = ?, updated_at = ? WHERE owner_id = ? AND jid = ?',
  ).run(mode, now(), String(ownerId), jid);
  return getContact(db, jid, ownerId);
}

export function setContactRegister(db, jid, register, ownerId = 'demo') {
  const allowed = ['auto', 'wajib_sopan', 'keluarga', 'temen', 'temen_dekat', 'temen_poll'];
  if (!allowed.includes(register)) throw new Error('register tidak valid');
  db.prepare(
    'UPDATE contacts SET register = ?, updated_at = ? WHERE owner_id = ? AND jid = ?',
  ).run(register, now(), String(ownerId), jid);
  return getContact(db, jid, ownerId);
}

export function setContactAlias(db, jid, alias, ownerId = 'demo') {
  db.prepare(
    'UPDATE contacts SET alias = ?, updated_at = ? WHERE owner_id = ? AND jid = ?',
  ).run(alias || null, now(), String(ownerId), jid);
  return getContact(db, jid, ownerId);
}

export function setContactLanguage(db, jid, language, ownerId = 'demo') {
  if (!['auto', 'id', 'jv'].includes(language)) throw new Error('language tidak valid');
  db.prepare(
    'UPDATE contacts SET language = ?, updated_at = ? WHERE owner_id = ? AND jid = ?',
  ).run(language, now(), String(ownerId), jid);
  return getContact(db, jid, ownerId);
}

export function setContactBurst(db, jid, burst, ownerId = 'demo') {
  const n = Math.max(1, Math.min(8, Number(burst) || 3));
  db.prepare(
    'UPDATE contacts SET burst = ?, updated_at = ? WHERE owner_id = ? AND jid = ?',
  ).run(n, now(), String(ownerId), jid);
  return getContact(db, jid, ownerId);
}

export function saveProfile(db, jid, { styleProfile, relationship, sampleCount }, ownerId = 'demo') {
  const ts = now();
  db.prepare(
    `UPDATE contacts SET
       style_profile = COALESCE(?, style_profile),
       relationship  = COALESCE(?, relationship),
       sample_count  = COALESCE(?, sample_count),
       profiled_at   = ?,
       updated_at    = ?
     WHERE owner_id = ? AND jid = ?`,
  ).run(
    styleProfile ? JSON.stringify(styleProfile) : null,
    relationship ?? null,
    sampleCount ?? null,
    ts,
    ts,
    String(ownerId),
    jid,
  );
}

/* -------------------------------- messages ------------------------------- */

export function insertMessage(db, { ownerId = 'demo', id, jid, direction, body, ts, waId, status, reason }) {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, owner_id, jid, direction, body, ts, wa_id, status, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    String(ownerId),
    jid,
    direction,
    body,
    ts ?? now(),
    waId ?? null,
    status ?? null,
    reason ?? null,
  );
}

export function updateMessageStatus(db, id, status, reason = null, ownerId = 'demo') {
  db.prepare(
    'UPDATE messages SET status = ?, reason = ? WHERE id = ? AND owner_id = ?',
  ).run(status, reason, id, String(ownerId));
}

export function touchContact(db, jid, ownerId = 'demo') {
  db.prepare(
    'UPDATE contacts SET last_seen_at = ? WHERE owner_id = ? AND jid = ?',
  ).run(now(), String(ownerId), jid);
}

export function recentMessages(db, jid, limit = 20, ownerId = 'demo') {
  return db
    .prepare(
      'SELECT * FROM messages WHERE owner_id = ? AND jid = ? AND ts <= ? ORDER BY ts DESC LIMIT ?',
    )
    .all(String(ownerId), jid, now(), limit)
    .reverse();
}

export function countOutSince(db, sinceTs, jid = null, ownerId = 'demo') {
  const owner = String(ownerId);
  if (jid) {
    return db
      .prepare(
        `SELECT COUNT(*) AS n FROM messages
         WHERE owner_id = ? AND direction = 'out' AND ts >= ? AND jid = ? AND status IN ('auto_sent','sent')`,
      )
      .get(owner, sinceTs, jid).n;
  }
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM messages
       WHERE owner_id = ? AND direction = 'out' AND ts >= ? AND status IN ('auto_sent','sent')`,
    )
    .get(owner, sinceTs).n;
}

export function countOutMessages(db, jid, ownerId = 'demo') {
  return db
    .prepare(
      "SELECT COUNT(*) AS n FROM messages WHERE owner_id = ? AND jid = ? AND direction = 'out'",
    )
    .get(String(ownerId), jid).n;
}

/* --------------------------------- drafts -------------------------------- */

export function createDraft(db, d) {
  const id = d.id ?? `dr_${now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    `INSERT INTO drafts (id, owner_id, jid, incoming_id, incoming_body, reply, confidence, reason, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    String(d.ownerId || 'demo'),
    d.jid,
    d.incomingId ?? null,
    d.incomingBody,
    d.reply ?? null,
    d.confidence ?? null,
    d.reason ?? null,
    d.status ?? 'pending',
    d.createdAt ?? now(),
  );
  return getDraft(db, id, d.ownerId || 'demo');
}

export function getDraft(db, id, ownerId = 'demo') {
  return (
    db
      .prepare('SELECT * FROM drafts WHERE id = ? AND owner_id = ?')
      .get(id, String(ownerId)) ?? null
  );
}

export function listDrafts(db, status = 'pending', ownerId = 'demo') {
  const owner = String(ownerId);
  return db
    .prepare(
      `SELECT d.*, c.name AS contact_name, c.number AS contact_number, c.mode AS contact_mode
       FROM drafts d
       LEFT JOIN contacts c ON c.owner_id = d.owner_id AND c.jid = d.jid
       WHERE d.owner_id = ? AND d.status = ? ORDER BY d.created_at DESC LIMIT 100`,
    )
    .all(owner, status);
}

/** Klaim draft sebelum dikirim. Hanya satu request yang boleh menang. */
export function claimDraft(db, id, from = 'pending', to = 'sending', ownerId = 'demo') {
  const result = db
    .prepare('UPDATE drafts SET status = ? WHERE id = ? AND owner_id = ? AND status = ?')
    .run(to, id, String(ownerId), from);
  return Number(result.changes) === 1;
}

export function updateDraft(db, id, patch, ownerId = 'demo') {
  const fields = [];
  const values = [];
  for (const key of ['reply', 'status', 'confidence', 'reason', 'sent_at']) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(patch[key]);
    }
  }
  if (!fields.length) return getDraft(db, id, ownerId);
  values.push(id, String(ownerId));
  db.prepare(`UPDATE drafts SET ${fields.join(', ')} WHERE id = ? AND owner_id = ?`).run(...values);
  return getDraft(db, id, ownerId);
}

export function clearDrafts(db, status = 'pending', ownerId = 'demo') {
  const result = db
    .prepare('DELETE FROM drafts WHERE owner_id = ? AND status = ?')
    .run(String(ownerId), status);
  return Number(result.changes) || 0;
}

/* -------------------------------- examples ------------------------------- */

export function addExample(db, { ownerId = 'demo', jid, their, mine, ts }) {
  db.prepare(
    'INSERT INTO examples (owner_id, jid, their, mine, ts) VALUES (?, ?, ?, ?, ?)',
  ).run(String(ownerId), jid, their, mine, ts ?? now());
}

export function listExamples(db, jid, limit = 12, ownerId = 'demo') {
  const rows = db
    .prepare(
      'SELECT their, mine FROM examples WHERE owner_id = ? AND jid = ? ORDER BY ts DESC LIMIT 300',
    )
    .all(String(ownerId), jid);

  // Utamakan contoh pendek: gaya aslinya 2-8 kata, bukan paragraf.
  const short = rows.filter((r) => r.mine.length <= 60);
  const pool = short.length >= limit ? short : rows;

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, limit);
}

export function countExamples(db, jid, ownerId = 'demo') {
  return db
    .prepare('SELECT COUNT(*) AS n FROM examples WHERE owner_id = ? AND jid = ?')
    .get(String(ownerId), jid).n;
}

/* ------------------------------- aktivitas ------------------------------- */

export function createActivity(db, { ownerId = 'demo', id, text, imagePath, expiresAt }) {
  deactivateAllActivities(db, ownerId);
  db.prepare(
    'INSERT INTO activities (id, owner_id, text, image_path, active, expires_at, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
  ).run(id, String(ownerId), text, imagePath ?? null, expiresAt ?? null, now());
  return getActivity(db, id, ownerId);
}

export function getActivity(db, id, ownerId = 'demo') {
  return (
    db
      .prepare('SELECT * FROM activities WHERE id = ? AND owner_id = ?')
      .get(id, String(ownerId)) ?? null
  );
}

export function getActiveActivity(db, ownerId = 'demo') {
  return (
    db
      .prepare(
        'SELECT * FROM activities WHERE owner_id = ? AND active = 1 AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 1',
      )
      .get(String(ownerId), now()) ?? null
  );
}

export function listActivities(db, limit = 20, ownerId = 'demo') {
  return db
    .prepare('SELECT * FROM activities WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(String(ownerId), limit);
}

export function setActivityActive(db, id, active, ownerId = 'demo') {
  db.prepare(
    'UPDATE activities SET active = ? WHERE id = ? AND owner_id = ?',
  ).run(active ? 1 : 0, id, String(ownerId));
  return getActivity(db, id, ownerId);
}

export function deactivateAllActivities(db, ownerId = 'demo') {
  db.prepare('UPDATE activities SET active = 0 WHERE owner_id = ? AND active = 1').run(
    String(ownerId),
  );
}

export function deleteActivity(db, id, ownerId = 'demo') {
  db.prepare('DELETE FROM activities WHERE id = ? AND owner_id = ?').run(id, String(ownerId));
}

/* ------------------------------ status jobs ------------------------------ */

export function createStatusJob(db, { ownerId = 'demo', id, imagePath, caption, scheduledAt }) {
  db.prepare(
    'INSERT INTO status_jobs (id, owner_id, image_path, caption, scheduled_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, String(ownerId), imagePath ?? null, caption ?? null, scheduledAt, 'pending', now());
  return getStatusJob(db, id, ownerId);
}

export function getStatusJob(db, id, ownerId = 'demo') {
  return (
    db
      .prepare('SELECT * FROM status_jobs WHERE id = ? AND owner_id = ?')
      .get(id, String(ownerId)) ?? null
  );
}

export function listStatusJobs(db, limit = 60, ownerId = 'demo') {
  return db
    .prepare('SELECT * FROM status_jobs WHERE owner_id = ? ORDER BY scheduled_at DESC LIMIT ?')
    .all(String(ownerId), limit);
}

export function dueStatusJobs(db, at = now(), ownerId = 'demo') {
  return db
    .prepare(
      "SELECT * FROM status_jobs WHERE owner_id = ? AND status = 'pending' AND scheduled_at <= ? ORDER BY scheduled_at ASC",
    )
    .all(String(ownerId), at);
}

/** Klaim job sebelum upload. Hanya satu pemanggil yang boleh menang. */
export function claimStatusJob(db, id, from = ['pending'], ownerId = 'demo') {
  const statuses = from.filter(Boolean);
  if (!statuses.length) return false;
  const placeholders = statuses.map(() => '?').join(', ');
  const result = db
    .prepare(
      `UPDATE status_jobs SET status = 'sending' WHERE id = ? AND owner_id = ? AND status IN (${placeholders})`,
    )
    .run(id, String(ownerId), ...statuses);
  return Number(result.changes) === 1;
}

export function logStatusSend(db, jobId, sentAt = now(), ownerId = 'demo') {
  db.prepare(
    'INSERT OR IGNORE INTO status_send_log (job_id, owner_id, sent_at) VALUES (?, ?, ?)',
  ).run(jobId, String(ownerId), sentAt);
}

/** Saat proses restart, job yang tertahan di 'sending' dikembalikan ke pending. */
export function resetSendingStatusJobs(db) {
  db.prepare("UPDATE status_jobs SET status = 'pending' WHERE status = 'sending'").run();
}

/** Isi log lama dari baris sent supaya kuota hari ini tidak ter-reset setelah upgrade. */
export function backfillStatusSendLog(db) {
  db.prepare(
    "INSERT OR IGNORE INTO status_send_log (job_id, owner_id, sent_at) SELECT id, owner_id, sent_at FROM status_jobs WHERE sent_at IS NOT NULL",
  ).run();
}

export function updateStatusJob(db, id, patch, ownerId = 'demo') {
  const fields = [];
  const values = [];
  for (const key of ['status', 'attempts', 'last_error', 'sent_at', 'wa_message_id', 'wa_status_jids']) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(patch[key]);
    }
  }
  if (!fields.length) return getStatusJob(db, id, ownerId);
  values.push(id, String(ownerId));
  db.prepare(
    `UPDATE status_jobs SET ${fields.join(', ')} WHERE id = ? AND owner_id = ?`,
  ).run(...values);
  return getStatusJob(db, id, ownerId);
}

export function countStatusSentToday(db, ownerId = 'demo') {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return db
    .prepare(
      'SELECT COUNT(*) AS n FROM status_send_log WHERE owner_id = ? AND sent_at >= ?',
    )
    .get(String(ownerId), start.getTime()).n;
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

/* ---------------------------- business profile ---------------------------- */

export function getBusinessProfile(db, ownerId) {
  const row = db.prepare('SELECT * FROM business_profiles WHERE owner_id = ?').get(String(ownerId));
  return row
    ? {
        owner_id: row.owner_id,
        name: row.name,
        category: row.category || '',
        location: row.location || '',
        hours: row.hours || '',
        specialty: row.specialty || '',
        contact: row.contact || '',
        notes: row.notes || '',
        payment_methods: row.payment_methods || '',
        bank_info: row.bank_info || '',
        qris_image_path: row.qris_image_path || '',
        updated_at: row.updated_at,
      }
    : null;
}

export function upsertBusinessProfile(db, ownerId, data = {}) {
  const name = String(data.name || '').trim();
  if (!name) throw new Error('Nama usaha wajib diisi');
  db.prepare(
    `INSERT INTO business_profiles
       (owner_id, name, category, location, hours, specialty, contact, notes, payment_methods, bank_info, qris_image_path, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_id) DO UPDATE SET
       name = excluded.name,
       category = excluded.category,
       location = excluded.location,
       hours = excluded.hours,
       specialty = excluded.specialty,
       contact = excluded.contact,
       notes = excluded.notes,
       payment_methods = excluded.payment_methods,
       bank_info = excluded.bank_info,
       qris_image_path = COALESCE(excluded.qris_image_path, business_profiles.qris_image_path),
       updated_at = excluded.updated_at`,
  ).run(
    String(ownerId),
    name,
    String(data.category || '').trim(),
    String(data.location || '').trim(),
    String(data.hours || '').trim(),
    String(data.specialty || '').trim(),
    String(data.contact || '').trim(),
    String(data.notes || '').trim(),
    String(data.payment_methods || '').trim(),
    String(data.bank_info || '').trim(),
    data.qris_image_path || null,
    Date.now(),
  );
  return getBusinessProfile(db, ownerId);
}

export function createOrder(db, { ownerId, customerName = '', items, total = 0, status = 'pending', source = 'chat' }) {
  const id = `ord_${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(
    'INSERT INTO orders (id, owner_id, customer_name, items, total, status, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    String(ownerId),
    String(customerName || '').trim(),
    String(items || '').trim(),
    Math.max(0, Math.round(Number(total) || 0)),
    String(status || 'pending'),
    String(source || 'chat'),
    Date.now(),
  );
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

export function listOrders(db, ownerId, limit = 100) {
  return db
    .prepare('SELECT * FROM orders WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(String(ownerId), limit);
}

export function getAiSettings(db, ownerId) {
  const row = db.prepare('SELECT * FROM ai_settings WHERE owner_id = ?').get(String(ownerId));
  return row
    ? {
        owner_id: row.owner_id,
        base_url: row.base_url,
        api_key: row.api_key,
        model: row.model,
        vision_model: row.vision_model || '',
        thinking: row.thinking || 'off',
        temperature: Number(row.temperature),
        max_tokens: Number(row.max_tokens),
        updated_at: row.updated_at,
      }
    : null;
}

export function saveAiSettings(db, ownerId, data = {}) {
  db.prepare(
    `INSERT INTO ai_settings
       (owner_id, base_url, api_key, model, vision_model, thinking, temperature, max_tokens, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_id) DO UPDATE SET
       base_url = excluded.base_url,
       api_key = excluded.api_key,
       model = excluded.model,
       vision_model = excluded.vision_model,
       thinking = excluded.thinking,
       temperature = excluded.temperature,
       max_tokens = excluded.max_tokens,
       updated_at = excluded.updated_at`,
  ).run(
    String(ownerId),
    String(data.baseUrl || '').trim(),
    String(data.apiKey || '').trim(),
    String(data.model || '').trim(),
    String(data.visionModel || '').trim(),
    String(data.thinking || 'off').trim(),
    Number(data.temperature) || 0.8,
    Math.max(1, Math.round(Number(data.maxTokens) || 2000)),
    Date.now(),
  );
  return getAiSettings(db, ownerId);
}

export function updateOrderStatus(db, ownerId, id, status) {
  const allowed = ['pending', 'done', 'cancelled'];
  const cleanStatus = String(status || '').trim();
  if (!allowed.includes(cleanStatus)) throw new Error('Status pesanan tidak dikenal');
  const result = db
    .prepare('UPDATE orders SET status = ? WHERE id = ? AND owner_id = ?')
    .run(cleanStatus, String(id), String(ownerId));
  if (!result.changes) return null;
  return db.prepare('SELECT * FROM orders WHERE id = ? AND owner_id = ?').get(String(id), String(ownerId));
}

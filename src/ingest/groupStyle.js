/**
 * Gaya ngetik dari grup.
 *
 * Grup tidak pernah dibalas, tapi pesanmu di grup adalah contoh paling jujur
 * soal cara kamu ngobrol santai. Semua pesanmu dari export grup dikumpulkan
 * di tabel group_samples, lalu dianalisis jadi satu profil "gaya umum".
 */
import { analyzeStyle } from './style.js';
import * as store from '../db.js';

const MAX_SAMPLES = 20000;

/** Simpan pesan-pesanmu dari grup, lalu bangun ulang profil gaya umum. */
export function addGroupSamples(db, texts) {
  if (!texts?.length) return rebuildGroupStyle(db);

  const now = Date.now();
  const stmt = db.prepare('INSERT INTO group_samples (body, created_at) VALUES (?, ?)');
  db.exec('BEGIN');
  try {
    for (const t of texts) {
      const body = String(t || '').trim();
      if (body) stmt.run(body, now);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return rebuildGroupStyle(db);
}

export function rebuildGroupStyle(db) {
  const rows = db
    .prepare('SELECT body FROM group_samples ORDER BY id DESC LIMIT ?')
    .all(MAX_SAMPLES);

  const style = analyzeStyle(rows.map((r) => r.body));
  if (style) store.kvSet(db, 'group_style', JSON.stringify(style));
  return style;
}

export function groupSampleCount(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM group_samples').get().n;
}

/**
 * Pilih profil gaya terbaik.
 * Prioritas: profil kontak yang datanya cukup → gaya umum dari grup →
 * profil global → profil kontak yang masih tipis.
 */
export function pickStyle(db, contact) {
  const parse = (v) => {
    try {
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  };

  const own = parse(contact?.style_profile);
  const group = parse(store.kvGet(db, 'group_style'));
  const global = parse(store.kvGet(db, 'global_style'));

  if (own && (own.sampleSize || 0) >= 40) return own;
  if (group) return group;
  if (global) return global;
  return own;
}

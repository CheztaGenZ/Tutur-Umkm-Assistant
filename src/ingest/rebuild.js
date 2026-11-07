/**
 * Bangun ulang profil gaya ngetik dari pesan yang sudah tersimpan di database.
 * Dipakai untuk "belajar sambil jalan" — tanpa perlu export ulang.
 */
import { analyzeStyle } from './style.js';
import { detectRegister } from './style.js';
import { cleanMessage } from './parseExport.js';
import { generateRelationship } from '../ai/prompt.js';
import { aiConfigForOwner } from '../ai/account.js';
import { withAiConfig } from '../ai/context.js';
import { config } from '../config.js';
import * as store from '../db.js';

export async function rebuildProfile(db, jid, { withRelationship = true, ownerId = 'demo' } = {}) {
  const owner = String(ownerId);
  const contact = store.getContact(db, jid, owner);
  if (!contact) return { ok: false, reason: 'kontak tidak ditemukan' };

  const rows = db
    .prepare(
      'SELECT direction, body, ts FROM messages WHERE owner_id = ? AND jid = ? ORDER BY ts ASC',
    )
    .all(owner, jid);

  const mine = rows
    .filter((r) => r.direction === 'out')
    .map((r) => cleanMessage(r.body))
    .filter(Boolean);

  if (mine.length < 5) {
    return { ok: false, reason: `butuh minimal 5 pesanmu, baru ada ${mine.length}` };
  }

  const style = analyzeStyle(mine);

  // Pasangan (dia → kamu) yang berurutan, untuk few-shot.
  const pairs = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i - 1].direction !== 'in' || rows[i].direction !== 'out') continue;
    const their = cleanMessage(rows[i - 1].body);
    const mineText = cleanMessage(rows[i].body);
    if (!their || !mineText) continue;
    if (their.length > 300 || mineText.length > 300) continue;
    pairs.push({ their, mine: mineText, ts: rows[i].ts });
  }

  db.prepare('DELETE FROM examples WHERE owner_id = ? AND jid = ?').run(owner, jid);
  for (const p of pairs.slice(-400)) store.addExample(db, { ownerId: owner, jid, ...p });

  let relationship = null;
  const ai = aiConfigForOwner(db, owner);
  if (withRelationship && pairs.length >= 8 && ai) {
    try {
      relationship = await withAiConfig(ai, () =>
        generateRelationship({
          meName: config.me,
          contactName: contact.name || 'dia',
          pairs,
        }),
      );
    } catch {
      // Jangan gagalkan seluruh proses hanya karena ringkasan relasi.
    }
  }

  store.saveProfile(
    db,
    jid,
    {
      styleProfile: style,
      relationship: relationship ?? contact.relationship,
      sampleCount: mine.length,
    },
    owner,
  );

  // Tentukan tingkat tutur kalau belum pernah diset manual.
  if (!contact.register || contact.register === 'auto') {
    store.setContactRegister(db, jid, detectRegister(mine), owner);
  }

  return { ok: true, samples: mine.length, pairs: pairs.length };
}

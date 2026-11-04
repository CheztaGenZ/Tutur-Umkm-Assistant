/**
 * Perbaiki kontak lama yang tersimpan dengan JID LID tetapi masih bernama
 * "Orang". Mapping LID -> nomor telepon diambil dari sesi WhatsApp, lalu
 * nama dari buku kontak (wa_contacts) dipakai untuk memperbarui kontak.
 */
import * as store from '../db.js';
import { normalizePnJid, pnNumber } from './jid.js';

let repairing = null;

export async function repairLidContacts({ db, wa, bus }, { limit = 200 } = {}) {
  if (repairing) return 0;
  if (typeof wa?.resolvePn !== 'function') return 0;

  repairing = (async () => {
    const rows = db
      .prepare(
        "SELECT jid, name, number FROM contacts WHERE jid LIKE '%@lid' ORDER BY last_seen_at DESC LIMIT ?",
      )
      .all(limit);

    let fixed = 0;
    for (const row of rows) {
      const pn = normalizePnJid(await wa.resolvePn(row.jid));
      if (!pn) continue;

      const pnName = store.getWaName(db, pn) || store.getContact(db, pn)?.name || null;
      const number = pnNumber(pn);
      const generic =
        !row.name ||
        row.name === 'Orang' ||
        row.name === row.number ||
        /^\d+$/.test(row.name || '');

      // Jangan menimpa nama yang sudah dipilih manusia. Hanya kontak
      // generik ("Orang"/angka) yang boleh di-rename dari buku kontak.
      const nextName = generic && pnName ? pnName : row.name;
      if ((generic && pnName) || row.number !== number) {
        store.upsertContact(db, {
          jid: row.jid,
          name: nextName,
          number,
        });
        fixed++;
      }
      if (nextName && nextName !== 'Orang') store.setWaName(db, row.jid, nextName);
    }

    if (fixed) {
      bus?.emit?.('event', {
        type: 'log',
        message: `${fixed} kontak LID diperbaiki dari nomor telepon`,
      });
    }
    return fixed;
  })();

  try {
    return await repairing;
  } finally {
    repairing = null;
  }
}

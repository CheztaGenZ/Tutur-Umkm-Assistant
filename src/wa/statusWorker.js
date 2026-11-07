/**
 * Worker status terjadwal.
 * Aturan (opsi C):
 *  - WA tersambung + jatuh tempo + kuota < 3/hari -> kirim
 *  - WA mati -> biarkan pending
 *  - lewat 24 jam -> skipped
 */
import fs from 'node:fs';
import * as store from '../db.js';

export const MAX_PER_DAY = 3;

const MAX_ATTEMPTS = 5;

export async function sendStatusJob({ db, wa, bus, ownerId = 'demo' }, job) {
  if (!job?.image_path || !fs.existsSync(job.image_path)) {
    store.updateStatusJob(db, job.id, { status: 'skipped', last_error: 'gambar tidak ada' }, ownerId);
    return false;
  }

  if (Date.now() - job.scheduled_at > 24 * 60 * 60 * 1000) {
    store.updateStatusJob(db, job.id, { status: 'skipped', last_error: 'lewat 24 jam' }, ownerId);
    bus.emit('event', {
      type: 'log',
      ownerId,
      message: `Status "${job.caption || ''}" dilewati (lewat 24 jam)`,
    });
    return false;
  }

  if (wa.snapshot().status !== 'open') {
    return false; // tetap pending
  }

  if (store.countStatusSentToday(db, ownerId) >= MAX_PER_DAY) {
    store.updateStatusJob(db, job.id, { last_error: 'kuota status harian habis' }, ownerId);
    return false; // tetap pending, jangan kirim manual di luar kuota
  }

  // Klaim atomik: hanya satu worker/post-now yang boleh memproses job ini.
  if (!store.claimStatusJob(db, job.id, ['pending'], ownerId)) return false;

  try {
    const buffer = fs.readFileSync(job.image_path);
    // Daftar penerima status: kontak bernomor telepon, lalu filter privasi WhatsApp.
    const allRecipients = db
      .prepare(
        "SELECT jid FROM contacts WHERE owner_id = ? AND jid LIKE '%@s.whatsapp.net' UNION SELECT jid FROM wa_contacts WHERE jid LIKE '%@s.whatsapp.net'",
      )
      .all(String(ownerId))
      .map((r) => r.jid);
    const recipients = await wa.resolveStatusRecipients(allRecipients);
    if (!recipients.length) {
      throw new Error('Tidak ada penerima status setelah filter privasi WhatsApp.');
    }
    const sent = await wa.sendStatus(buffer, job.caption || '', recipients);
    const sentAt = Date.now();
    store.logStatusSend(db, job.id, sentAt, ownerId);
    store.updateStatusJob(db, job.id, {
      status: 'sent',
      sent_at: sentAt,
      attempts: (job.attempts || 0) + 1,
      last_error: null,
      wa_message_id: sent?.key?.id || null,
      wa_status_jids: JSON.stringify(recipients),
    }, ownerId);
    bus.emit('event', {
      type: 'log',
      ownerId,
      message: `Status terkirim (${recipients.length} kontak): ${job.caption || '(tanpa caption)'}`,
    });
    return true;
  } catch (err) {
    const attempts = (job.attempts || 0) + 1;
    const terminal = attempts >= MAX_ATTEMPTS;
    store.updateStatusJob(db, job.id, {
      status: terminal ? 'failed' : 'pending',
      last_error: err.message,
      attempts,
    }, ownerId);
    bus.emit('event', {
      type: 'error',
      ownerId,
      message: `Status ${terminal ? 'gagal' : 'ditunda'}: ${err.message}`,
    });
    return false;
  }
}

let processing = false;

export async function processStatusJobs({ db, wa, bus, ownerId = 'demo' }) {
  if (processing) return 0;
  processing = true;
  try {
    if (wa.snapshot().status !== 'open') return 0;

    const due = store.dueStatusJobs(db, Date.now(), ownerId);
    if (!due.length) return 0;

    let sent = 0;
    for (const job of due) {
      if (store.countStatusSentToday(db, ownerId) >= MAX_PER_DAY) break;
      const ok = await sendStatusJob({ db, wa, bus, ownerId }, job);
      if (ok) sent++;
    }
    return sent;
  } finally {
    processing = false;
  }
}


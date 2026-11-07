import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';
import pino from 'pino';
import QRCode from 'qrcode';
import { humanDelay } from '../policy.js';
import { normalizePnJid } from './jid.js';

const require = createRequire(import.meta.url);
const baileys = require('@whiskeysockets/baileys');

const makeWASocket = baileys.default;
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  downloadMediaMessage,
} = baileys;

const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });

/** Ambil teks dari berbagai bentuk pesan WhatsApp. */
export function extractText(message) {
  if (!message) return '';
  const m = message.ephemeralMessage?.message || message.viewOnceMessage?.message || message;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    ''
  );
}

export class WhatsAppClient extends EventEmitter {
  constructor({ dataDir, ownerId = 'demo' }) {
    super();
    this.ownerId = String(ownerId);
    this.authDir = path.join(dataDir, 'wa', this.ownerId, 'auth');
    this.sock = null;
    this.state = { status: 'idle', qr: null, me: null, lastError: null, since: null };
    this.stopping = false;
    this.retry = 0;
    this.statusPrivacy = null;
    this.privacyWaitMs = 5000;
    this._privacyWait = null;
  }

  snapshot() {
    return { ...this.state };
  }

  /** Ubah JID LID ke JID nomor telepon kalau mapping-nya tersedia. */
  async resolvePn(jid) {
    if (!String(jid || '').endsWith('@lid')) return null;
    try {
      const pn = await this.sock?.signalRepository?.lidMapping?.getPNForLID?.(jid);
      return normalizePnJid(pn);
    } catch {
      return null;
    }
  }

  /**
   * Ambil setting privasi Status dari WhatsApp.
   * Mode: 0 = allow list, 1 = deny list, 2 = semua kontak, 3 = teman dekat.
   */
  async ensureStatusPrivacy(force = false) {
    if (!force && this.statusPrivacy && this.statusPrivacy.mode != null) return this.statusPrivacy;
    if (!this.sock) throw new Error('WhatsApp belum terhubung.');

    let category = null;
    try {
      const settings = await this.sock.fetchPrivacySettings?.(true);
      category = settings?.status || null;
    } catch {}

    const mode = Number(this.statusPrivacy?.mode);
    const explicitMode = [0, 1, 3].includes(mode);
    if (category) {
      console.log(
        `  Privasi status WhatsApp: kategori ${category}${
          Number.isFinite(mode) ? `, mode ${mode}` : ''
        }`,
      );
    }

    if (category === 'none') {
      throw new Error('Privasi Status WhatsApp diset "none"; status tidak dikirim.');
    }
    if (category === 'contacts' || category === 'all') {
      if (mode === 2 || explicitMode) return this.statusPrivacy;
      this.statusPrivacy = { mode: 2, userJid: [] };
      return this.statusPrivacy;
    }
    // contact_blacklist / kategori tidak terbaca:
    // mode eksplisit (allow/deny/close friends) aman dipakai; mode 2 TIDAK aman
    // karena bisa saja daftar "kecualikan kontak" belum tersinkron.
    if (explicitMode) return this.statusPrivacy;

    // Jangan percaya mode 2 saat kategori menunjukkan ada pengecualian.
    this.statusPrivacy = null;

    const wait = new Promise((resolve) => {
      this._privacyWait = resolve;
      setTimeout(() => {
        if (this._privacyWait === resolve) this._privacyWait = null;
        resolve(null);
      }, this.privacyWaitMs);
    });

    try {
      await this.sock.resyncAppState?.(
        ['critical_block', 'critical_unblock_low', 'regular_high', 'regular_low', 'regular'],
        false,
      );
    } catch {}

    await wait;
    const resolvedMode = Number(this.statusPrivacy?.mode);
    if ([0, 1, 3].includes(resolvedMode)) return this.statusPrivacy;
    throw new Error(
      'Privasi Status WhatsApp belum tersinkron. Buka WhatsApp di HP, cek Status > Privasi, lalu coba lagi.',
    );
  }

  /** Filter kontak sesuai setting privasi Status WhatsApp. */
  async resolveStatusRecipients(allContacts = []) {
    const privacy = await this.ensureStatusPrivacy(true);
    const normalize = (jid) => {
      const value = String(jid || '').trim();
      if (!value.endsWith('@s.whatsapp.net')) return null;
      const user = value.split('@')[0].split(':')[0];
      return user ? `${user}@s.whatsapp.net` : null;
    };
    const all = [...new Set((allContacts || []).map(normalize).filter(Boolean))];

    const listed = async () => {
      const out = new Set();
      for (const raw of privacy.userJid || []) {
        const value = String(raw || '').trim();
        let phone = null;
        if (value.endsWith('@s.whatsapp.net')) {
          phone = normalize(value);
        } else if (value.endsWith('@lid')) {
          const pn = await this.sock?.signalRepository?.lidMapping?.getPNForLID?.(value);
          phone = normalize(pn);
        } else {
          throw new Error('Entri privasi Status tidak dikenali; status ditahan.');
        }
        if (!phone) {
          throw new Error('Gagal memetakan kontak privasi Status; status ditahan.');
        }
        out.add(phone);
      }
      return [...out];
    };

    const mode = Number(privacy.mode);
    if (mode === 2) return all;
    if (mode === 0) {
      const allowed = await listed();
      if (!allowed.length) throw new Error('Daftar "Bagikan dengan" Status kosong; status ditahan.');
      return allowed;
    }
    if (mode === 1) {
      // Daftar kosong eksplisit = tidak ada pengecualian. Daftar yang belum
      // tersinkron (undefined) tidak boleh dianggap "tidak ada pengecualian".
      if (!Array.isArray(privacy.userJid)) {
        throw new Error('Daftar pengecualian Status belum tersinkron; status ditahan.');
      }
      const denied = new Set(await listed());
      return all.filter((jid) => !denied.has(jid));
    }
    if (mode === 3) {
      const close = await listed();
      if (!close.length) throw new Error('Daftar "Teman dekat" Status kosong; status ditahan.');
      return close;
    }
    throw new Error('Mode privasi Status tidak dikenali; status ditahan.');
  }

  async start() {
    fs.mkdirSync(this.authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch {
      version = undefined; // offline: pakai versi bawaan library
    }

    this.sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      // Minta WhatsApp mengirim riwayat chat saat tersambung.
      syncFullHistory: process.env.FULL_HISTORY !== 'false',
      generateHighQualityLinkPreview: false,
    });

    this.sock.ev.on('creds.update', saveCreds);
    this.sock.ev.on('settings.update', (update) => {
      if (update?.setting !== 'statusPrivacy') return;
      this.statusPrivacy = update.value || null;
      const count = Array.isArray(this.statusPrivacy?.userJid) ? this.statusPrivacy.userJid.length : 0;
      console.log(`  Privasi status WhatsApp: mode ${this.statusPrivacy?.mode ?? '?'} (${count} kontak)`);
      if (this._privacyWait) {
        const resolve = this._privacyWait;
        this._privacyWait = null;
        resolve(this.statusPrivacy);
      }
    });
    this.sock.ev.on('connection.update', (update) => this.onConnectionUpdate(update));
    this.sock.ev.on('messages.upsert', (payload) => this.onMessages(payload));
    // Riwayat chat yang dikirim HP (bisa beberapa batch).
    this.sock.ev.on('messaging-history.set', (payload) => this.emit('history', payload));
    // Indikator "sedang mengetik" lawan bicara.
    this.sock.ev.on('presence.update', (payload) => this.emit('presence', payload));
    // Sinkronisasi buku kontak: nama yang KAMU simpan ("Mamah"), bukan nama profil dia.
    this.sock.ev.on('contacts.upsert', (list) => this.emit('contacts', list));
    this.sock.ev.on('contacts.update', (list) => this.emit('contacts', list));

    return this;
  }

  onConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      QRCode.toDataURL(qr, { margin: 1, width: 320 })
        .then((dataUrl) => {
          this.state = { ...this.state, status: 'qr', qr: dataUrl, since: Date.now() };
          this.emit('qr', dataUrl);
          this.emit('state', this.snapshot());
        })
        .catch(() => {});
    }

    if (connection === 'open') {
      this.retry = 0;
      const me = this.sock?.user ?? null;
      this.state = {
        status: 'open',
        qr: null,
        me: me ? { id: me.id, name: me.name, number: String(me.id || '').split(':')[0] } : null,
        lastError: null,
        since: Date.now(),
      };
      this.emit('state', this.snapshot());
      this.emit('ready', this.state.me);
      this.ensureStatusPrivacy(true)
        .then((privacy) => {
          const count = Array.isArray(privacy.userJid) ? privacy.userJid.length : 0;
          console.log(`  Privasi status siap: mode ${privacy.mode} (${count} kontak)`);
        })
        .catch((err) => console.warn(`  Privasi status: ${err.message}`));
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      this.statusPrivacy = null;
      this.state = { ...this.state, status: loggedOut ? 'logged_out' : 'closed', qr: null, lastError: String(code ?? '') };
      this.emit('state', this.snapshot());

      if (this.stopping) return;

      if (loggedOut) {
        // Sesi tidak valid lagi; hapus agar bisa scan ulang.
        try {
          fs.rmSync(this.authDir, { recursive: true, force: true });
        } catch {}
        this.emit('error', new Error('Sesi WhatsApp logout. Scan QR lagi setelah restart.'));
        return;
      }

      const wait = Math.min(30000, 2000 * 2 ** Math.min(this.retry++, 4));
      setTimeout(() => {
        this.start().catch((err) => this.emit('error', err));
      }, wait);
    }
  }

  onMessages({ messages, type }) {
    if (type !== 'notify') return; // 'append' = backlog/history, jangan dibalas
    for (const raw of messages) {
      try {
        this.emit('message', this.normalize(raw));
      } catch (err) {
        this.emit('error', err);
      }
    }
  }

  normalize(raw) {
    const key = raw.key || {};
    const remoteJid = key.remoteJid || '';
    const isGroup = remoteJid.endsWith('@g.us');
    const chatJid = remoteJid;
    const senderJid = isGroup ? key.participant || remoteJid : remoteJid;
    // Chat LID membawa nomor telepon asli di remoteJidAlt/participantAlt.
    const altJid = key.remoteJidAlt || key.participantAlt || null;
    const msg = raw.message || {};
    const inner = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg;
    const mediaType = inner.imageMessage
      ? 'image'
      : inner.videoMessage
        ? 'video'
        : inner.audioMessage
          ? 'audio'
          : inner.documentMessage
            ? 'document'
            : inner.stickerMessage
              ? 'sticker'
              : null;

    return {
      id: key.id,
      chatJid,
      senderJid,
      altJid,
      isGroup,
      isStatus: remoteJid === 'status@broadcast',
      isNewsletter: remoteJid.endsWith('@newsletter'),
      fromMe: !!key.fromMe,
      pushName: raw.pushName || null,
      text: extractText(raw.message).trim(),
      hasMedia: !!mediaType,
      mediaType,
      mimetype: inner.imageMessage?.mimetype || inner.audioMessage?.mimetype || null,
      timestamp: Number(raw.messageTimestamp) * 1000 || Date.now(),
      raw,
    };
  }

  /** Unduh isi media (gambar/audio) dari server WhatsApp. */
  async downloadMedia(rawMessage) {
    if (!this.sock) throw new Error('WhatsApp belum terhubung.');
    const buf = await downloadMediaMessage(
      rawMessage,
      'buffer',
      {},
      { logger, reuploadRequest: this.sock.updateMediaMessage },
    );
    return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  }

  /**
   * Minta HP mengirim riwayat chat tertentu (tanpa root, tanpa backup).
   * `anchor` = pesan terlama yang sudah kita punya, untuk melanjutkan ke sebelumnya.
   */
  async requestHistory(jid, count = 200, anchor = null) {
    if (!this.sock || this.state.status !== 'open') throw new Error('WhatsApp belum terhubung.');

    const key = anchor?.key ?? {
      remoteJid: jid,
      fromMe: false,
      id: '3EB0' + Math.random().toString(36).slice(2, 14).toUpperCase(),
    };
    const ts = anchor?.timestamp ?? Math.floor(Date.now() / 1000);
    return this.sock.fetchMessageHistory(count, key, ts);
  }

  async sendSticker(jid, buffer) {
    if (!this.sock || this.state.status !== 'open') throw new Error('WhatsApp belum terhubung.');
    return this.sock.sendMessage(jid, { sticker: buffer });
  }

  async sendImage(jid, filePath, caption = '') {
    if (!this.sock || this.state.status !== 'open') throw new Error('WhatsApp belum terhubung.');
    return this.sock.sendMessage(jid, { image: fs.readFileSync(filePath), caption });
  }

  /** Kirim status WhatsApp (foto + caption) ke daftar kontak. */
  async sendStatus(buffer, caption = '', recipients = []) {
    if (!this.sock || this.state.status !== 'open') throw new Error('WhatsApp belum terhubung.');
    return this.sock.sendMessage(
      'status@broadcast',
      { image: buffer, caption },
      { statusJidList: Array.isArray(recipients) ? recipients : [] },
    );
  }

  /** Tarik/revoke status WhatsApp yang sudah terkirim. */
  async revokeStatus(messageId, recipients = []) {
    if (!this.sock || this.state.status !== 'open') throw new Error('WhatsApp belum terhubung.');
    if (!messageId) throw new Error('ID status tidak tersedia.');
    return this.sock.sendMessage(
      'status@broadcast',
      { delete: { remoteJid: 'status@broadcast', fromMe: true, id: messageId } },
      { statusJidList: Array.isArray(recipients) ? recipients : [] },
    );
  }

  async sendText(jid, text, { simulateTyping = true } = {}) {    if (!this.sock || this.state.status !== 'open') {
      throw new Error('WhatsApp belum terhubung.');
    }
    if (simulateTyping) {
      const wait = humanDelay() + Math.min(4000, text.length * 35);
      try {
        await this.sock.sendPresenceUpdate('composing', jid);
      } catch {}
      await new Promise((r) => setTimeout(r, wait));
    }
    const sent = await this.sock.sendMessage(jid, { text });
    if (simulateTyping) {
      try {
        await this.sock.sendPresenceUpdate('paused', jid);
      } catch {}
    }
    return sent;
  }

  async stop() {
    this.stopping = true;
    try {
      this.sock?.end?.(undefined);
    } catch {}
  }

  /** Putuskan sesi (logout) lalu mulai bersih supaya bisa scan QR baru. */
  async restartFresh() {
    this.stopping = true;
    try {
      await this.sock?.logout?.();
    } catch {
      /* sesi mungkin sudah invalid */
    }
    try {
      this.sock?.end?.(undefined);
    } catch {}

    try {
      fs.rmSync(this.authDir, { recursive: true, force: true });
    } catch {}

    this.stopping = false;
    this.retry = 0;
    this.state = { status: 'idle', qr: null, me: null, lastError: null, since: null };
    this.emit('state', this.snapshot());

    await this.start();
  }
}

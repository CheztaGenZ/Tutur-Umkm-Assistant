import { config } from '../config.js';
import { decide, dayStart, hourStart, shouldAutoSend } from '../policy.js';
import { searchKnowledge } from '../knowledge.js';
import * as store from '../db.js';
import { cleanMessage } from '../ingest/parseExport.js';
import { generateReply, generateRelationship } from '../ai/prompt.js';
import { aiConfigForOwner } from '../ai/account.js';
import { withAiConfig } from '../ai/context.js';
import { rebuildProfile } from '../ingest/rebuild.js';
import { pickStyle } from '../ingest/groupStyle.js';
import { isCrude, CRUDE_RE } from '../ingest/style.js';
import { JAVANESE_RE } from '../ingest/style.js';
import { transcribeAudio, transcribeReady } from '../ai/transcribe.js';
import { updateMemory } from '../ai/memory.js';
import { SLANG } from '../ai/slang.js';
import { chooseSticker } from '../ai/stickerPicker.js';
import fs from 'node:fs';
import path from 'node:path';
import { saveSticker, pickSticker, stickerPreview } from './stickers.js';
import { splitBubbles } from './bubbles.js';
import { normalizePnJid, pnNumber } from './jid.js';

const lockChains = new Map();
const rebuildLocks = new Set();

/* ----------------------------- sinkron kontak ----------------------------- */

/**
 * Sinkronisasi buku kontak WhatsApp.
 * `name` = nama yang kamu simpan di HP (biasanya sama dengan nama di export),
 * `notify` = nama profil yang dipasang orangnya sendiri.
 */
export function createContactSync({ db, bus }) {
  return function syncContacts(list = []) {
    let linked = 0;
    let repaired = 0;

    for (const c of list) {
      const jid = c.id || c.jid;
      if (!jid) continue;
      const isPn = jid.endsWith('@s.whatsapp.net');
      const isLid = jid.endsWith('@lid');
      if (!isPn && !isLid) continue;

      const name = c.name || c.notify || c.verifiedName;
      if (!name) continue;

      const phoneJid = normalizePnJid(c.phoneNumber) || (isPn ? normalizePnJid(jid) : null);
      const number = pnNumber(phoneJid) || String(jid).split('@')[0];

      // Nama buku kontak disimpan untuk JID yang dipakai chat (LID) dan
      // nomor teleponnya (PN), supaya keduanya bisa saling menemukan.
      if (phoneJid) store.setWaName(db, phoneJid, name);
      if (isLid) store.setWaName(db, jid, name);

      const existing = store.getContact(db, jid);
      if (existing) {
        const generic =
          !existing.name ||
          existing.name === existing.number ||
          /^\d+$/.test(existing.name) ||
          existing.name === 'Orang' ||
          /chesta|adabi/i.test(existing.name);
        if (generic || (phoneJid && existing.number !== number)) {
          store.upsertContact(db, { jid, name, number });
          repaired++;
        }
        continue;
      }

      // Kontak PN baru: sambungkan ke placeholder hasil import kalau ada.
      if (isPn) {
        const pending = store.findContactByImportName(db, name);
        if (pending?.jid?.startsWith('name:')) {
          store.linkContactJid(db, pending.jid, jid, number);
          store.upsertContact(db, { jid, name, importName: pending.import_name || name });
          linked++;
        }
      }
    }

    if (linked) {
      bus.emit('event', {
        type: 'log',
        message: `${linked} kontak hasil import tersambung ke nomor WhatsApp`,
      });
    }
    if (repaired) {
      bus.emit('event', {
        type: 'log',
        message: `${repaired} kontak LID diperbarui dari buku kontak`,
      });
    }
  };
}

/* ------------------------------- riwayat HP ------------------------------- */

export function createHistoryIngest({ db, wa, bus }) {
  const rebuilding = new Set();

  return async function ingestHistory(payload = {}) {
    const messages = payload.messages || [];
    if (!messages.length) return { stored: 0, chats: 0 };

    const nameByJid = new Map();
    for (const c of [...(payload.contacts || []), ...(payload.chats || [])]) {
      const id = c.id || c.jid;
      if (id && c.name) nameByJid.set(id, c.name);
    }

    let stored = 0;
    const touched = new Map();

    for (const raw of messages) {
      try {
        const m = wa.normalize(raw);
        if (!m.id || m.isGroup || m.isStatus || m.isNewsletter) continue;
        if (!String(m.chatJid).endsWith('@s.whatsapp.net')) continue;

        const text = cleanMessage(m.text);
        if (!text) continue;
        if (db.prepare('SELECT id FROM messages WHERE id = ?').get(m.id)) continue;

        const number = String(m.chatJid).split('@')[0];
        let contact = store.getContact(db, m.chatJid);

        if (!contact) {
          const name = nameByJid.get(m.chatJid) || m.pushName;
          const pending = store.findContactByImportName(db, name);
          if (pending?.jid?.startsWith('name:')) {
            store.linkContactJid(db, pending.jid, m.chatJid, number);
            contact = store.getContact(db, m.chatJid);
          }
        }

        const bookName = store.getWaName(db, m.chatJid);
        contact =
          contact ??
          store.upsertContact(db, {
            jid: m.chatJid,
            number,
            name: nameByJid.get(m.chatJid) || bookName || 'Orang',
          });

        store.insertMessage(db, {
          id: m.id,
          jid: m.chatJid,
          direction: m.fromMe ? 'out' : 'in',
          body: text,
          ts: m.timestamp,
          status: 'history',
        });

        stored++;
        touched.set(m.chatJid, contact.name || number);
      } catch {
        /* satu pesan rusak jangan menghentikan batch */
      }
    }

    bus.emit('event', {
      type: 'log',
      message: `Riwayat dari HP: ${stored} pesan baru, ${touched.size} chat`,
    });

    (async () => {
      for (const [jid, name] of touched) {
        if (rebuilding.has(jid)) continue;
        rebuilding.add(jid);
        try {
          const res = await rebuildProfile(db, jid, { withRelationship: true });
          if (res.ok) {
            bus.emit('event', { type: 'ingest', jid, contact: name, samples: res.samples, auto: true });
          }
        } catch {
          /* lanjut */
        } finally {
          rebuilding.delete(jid);
        }
      }
    })();

    return { stored, chats: touched.size };
  };
}

/* ------------------------------ pesan masuk ------------------------------- */

export function createMessageHandler({ db, wa, bus, allowGlobalAi = false }) {
  const emit = (event) => bus.emit('event', event);

  // Satu nomor WhatsApp per deployment. Akun yang mengklaim nomor ini
  // menjadi pemilik data chat, knowledge, dan pesanan untuk balasan WA.
  const waOwner = () => store.kvGet(db, 'wa_owner_id') || config.ownerId;
  const waOwnerName = () => store.getBusinessProfile(db, waOwner())?.name || config.me;
  const resolveAi = () => (allowGlobalAi ? config.ai : aiConfigForOwner(db, waOwner()));

  async function withLock(jid, fn) {
    const prev = lockChains.get(jid) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const tail = prev.catch(() => {}).then(() => gate);
    lockChains.set(jid, tail);
    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
      if (lockChains.get(jid) === tail) lockChains.delete(jid);
    }
  }

  function maybeRebuild(contact, jid) {
    try {
      const totalOut = store.countOutMessages(db, jid);
      const base = contact.sample_count || 0;
      if (totalOut < 5 || totalOut < base + 20) return;
      if (rebuildLocks.has(jid)) return;
      rebuildLocks.add(jid);
      rebuildProfile(db, jid)
        .then(async (res) => {
          if (res.ok) {
            emit({ type: 'ingest', jid, contact: contact.name, samples: res.samples, auto: true });
          }
          try {
            const mem = await updateMemory(db, jid);
            if (mem) emit({ type: 'log', message: `Memori ${contact.name} diperbarui` });
          } catch {
            /* memori opsional */
          }
        })
        .catch((err) => emit({ type: 'error', message: `Gagal memperbarui profil: ${err.message}` }))
        .finally(() => rebuildLocks.delete(jid));
    } catch {
      /* jangan ganggu alur balas */
    }
  }

  /* --------------------- antrean bubble chat (debounce) -------------------- */

  const queue = new Map(); // jid -> { timer, firstAt, image }

  function scheduleRun(jid, image) {
    const now = Date.now();
    const entry = queue.get(jid) ?? { firstAt: now };
    if (image) entry.image = image;

    clearTimeout(entry.timer);
    const elapsed = now - entry.firstAt;
    const wait = Math.max(0, Math.min(config.chat.debounceMs, config.chat.maxWaitMs - elapsed));

    if (wait <= 0) {
      queue.delete(jid);
      // Tanpa jeda (mis. saat tes): proses langsung.
      return run(jid, entry.image);
    }

    entry.timer = setTimeout(() => {
      queue.delete(jid);
      run(jid, entry.image).catch((err) => emit({ type: 'error', message: err.message }));
    }, wait);

    queue.set(jid, entry);
    return null;
  }

  /** Lawan bicara sedang mengetik lagi: tunda balasan, jangan potong bubble-nya. */
  function notePresence(jid, presence) {
    const entry = queue.get(jid);
    if (!entry) return;
    if (presence !== 'composing' && presence !== 'available') return;

    clearTimeout(entry.timer);
    const elapsed = Date.now() - entry.firstAt;
    const wait = Math.max(0, Math.min(config.chat.debounceMs, config.chat.maxWaitMs - elapsed));
    entry.timer = setTimeout(() => {
      queue.delete(jid);
      run(jid, entry.image).catch((err) => emit({ type: 'error', message: err.message }));
    }, wait);
  }

  /* ------------------------ anti-ngulang & stiker ------------------------- */

  const normalizeText = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  function tooSimilar(a, b) {
    const na = normalizeText(a);
    const nb = normalizeText(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const A = new Set(na.split(' '));
    const B = new Set(nb.split(' '));
    const inter = [...A].filter((x) => B.has(x)).length;
    const uni = new Set([...A, ...B]).size;
    return uni > 0 && inter / uni >= 0.7;
  }

  /** Potongan 3 kata, untuk mendeteksi frasa yang diulang-ulang. */
  function shingles(text, n = 3) {
    const words = normalizeText(text).split(' ').filter(Boolean);
    const out = new Set();
    for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '));
    return out;
  }

  /** Frasa yang sudah muncul >= 2 kali di 20 balasan terakhir. */
  function bannedPhrases(jid) {
    const recent = db
      .prepare(
        "SELECT body FROM messages WHERE jid = ? AND direction = 'out' AND body != '[stiker]' ORDER BY ts DESC LIMIT 20",
      )
      .all(jid)
      .map((r) => r.body);

    const counts = new Map();
    for (const t of recent) {
      for (const s of shingles(t)) counts.set(s, (counts.get(s) || 0) + 1);
    }

    return [...counts.entries()]
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([p]) => p);
  }

  function hitsBanned(text, banned) {
    const s = shingles(text);
    return banned.filter((p) => s.has(p));
  }

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** Buang paksa frasa basi kalau AI tetap memakainya. */
  function stripPhrases(text, banned) {
    let out = String(text);
    for (const p of banned) {
      const re = new RegExp(`\\b${p.split(' ').map(escapeRe).join('\\s+')}\\b`, 'gi');
      out = out.replace(re, '');
    }
    return out
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,.!?])/g, '$1')
      .trim();
  }

  /**
   * Gacha bubble: kadang satu pesan, kadang dipecah.
   * Pemecahan hanya di batas kalimat, koma, atau jeda kata.
   */
  function planBubbles(text, cap = 3) {
    return splitBubbles(text, Math.random, cap);
  }

  /** Balasan lama (>45 menit) — untuk mendeteksi joke basi yang dipakai ulang. */
  function staleReplies(jid, minutes = 45) {
    const cutoff = Date.now() - minutes * 60000;
    return db
      .prepare(
        "SELECT body FROM messages WHERE jid = ? AND direction = 'out' AND body != '[stiker]' AND ts < ? ORDER BY ts DESC LIMIT 80",
      )
      .all(jid, cutoff)
      .map((r) => r.body);
  }

  function recentOut(jid, limit = 8) {    return db
      .prepare(
        "SELECT body FROM messages WHERE jid = ? AND direction = 'out' AND body != '[stiker]' ORDER BY ts DESC LIMIT ?",
      )
      .all(jid, limit)
      .map((r) => r.body);
  }

  /** Kirim stiker sesekali — hanya ke chat pribadi, dengan jeda panjang. */
  async function maybeSendSticker(jid, contact) {
    if (!config.stickers.enabled) return;
    if (Math.random() > config.stickers.chance) return;

    const last = Number(store.kvGet(db, `sticker:${jid}`, '0'));
    if (Date.now() - last < config.stickers.cooldownMs) return;

    const picked = pickSticker();
    if (!picked) return;

    try {
      const sent = await wa.sendSticker(jid, picked.buffer);
      store.kvSet(db, `sticker:${jid}`, String(Date.now()));
      store.insertMessage(db, {
        id: sent?.key?.id || `sticker_${Date.now()}`,
        jid,
        direction: 'out',
        body: '[stiker]',
        ts: Date.now(),
        status: 'auto_sent',
        reason: 'stiker',
      });
      emit({ type: 'sent', jid, contact: contact.name, reply: '[stiker]', confidence: 1 });
    } catch {
      /* stiker gagal tidak boleh menggagalkan balasan */
    }
  }

  /** Kirim stiker yang DIPILIH AI sesuai konteks. */
  async function sendChosenSticker(jid, contact, file, context = {}) {
    if (!config.stickers.enabled) return;
    if (contact.register === 'keluarga' || contact.register === 'wajib_sopan') return;

    // Jarak stiker: minimal 5 pesan terkirim sejak stiker terakhir.
    const sentSince = Number(store.kvGet(db, `stickerCount:${jid}`, '0'));
    if (sentSince < config.stickers.every) return;

    let chosen = file || null;

    // Belum dipilih model? Pilih sekarang, dengan peluang 50%.
    if (!chosen) {
      if (Math.random() > config.stickers.chance) return;
      try {
        const picked = await chooseSticker({
          messages: context.messages || [],
          reply: context.reply || '',
          contactName: contact.name || 'dia',
          meName: waOwnerName(),
        });
        chosen = picked?.file || null;
      } catch {
        return;
      }
    }

    if (!chosen) return;

    const safe = path.basename(String(chosen));
    if (!/\.(webp|png)$/i.test(safe)) return;

    const full = path.join(path.resolve(config.stickers.dir), safe);
    if (!fs.existsSync(full)) return;

    try {
      const sent = await wa.sendSticker(jid, fs.readFileSync(full));
      store.kvSet(db, `stickerCount:${jid}`, '0');
      store.insertMessage(db, {
        id: sent?.key?.id || `sticker_${Date.now()}`,
        jid,
        direction: 'out',
        body: '[stiker]',
        ts: Date.now(),
        status: 'auto_sent',
        reason: `stiker: ${safe}`,
      });
      emit({ type: 'sent', jid, contact: contact.name, reply: `[stiker] ${safe}`, confidence: 1 });
    } catch {
      /* stiker gagal tidak boleh menggagalkan balasan */
    }
  }

  function inboundSince(jid, sinceTs) {    return db
      .prepare(
        "SELECT id, body, ts FROM messages WHERE jid = ? AND direction = 'in' AND ts > ? ORDER BY ts ASC",
      )
      .all(jid, sinceTs);
  }

  function markInbound(rows, status, reason) {
    const stmt = db.prepare('UPDATE messages SET status = ?, reason = ? WHERE id = ?');
    for (const r of rows) stmt.run(status, reason ?? null, r.id);
  }

  async function run(jid, image = null) {
    const contact = store.getContact(db, jid);
    if (!contact) return;

    const ai = resolveAi();
    if (!ai) {
      emit({
        type: 'error',
        message: `API key AI belum diatur untuk ${waOwnerName()}. Buka Setting di dashboard.`,
      });
      return;
    }

    const number = String(jid).split('@')[0];
    const lastOut = db
      .prepare(
        "SELECT ts FROM messages WHERE jid = ? AND direction = 'out' AND ts <= ? ORDER BY ts DESC LIMIT 1",
      )
      .get(jid, Date.now());

    const decision = decide({
      jid,
      contact,
      paused: store.kvGet(db, 'paused') === '1',
      counts: {
        day: store.countOutSince(db, dayStart()),
        hour: store.countOutSince(db, hourStart()),
        contactToday: store.countOutSince(db, dayStart(), jid),
        lastContactSentAt: lastOut?.ts ?? 0,
      },
    });

    const inbound = inboundSince(jid, lastOut?.ts ?? 0);
    const incomingBody = inbound.map((r) => r.body).join('\n') || '(kosong)';

    if (decision.action === 'ignore') {
      markInbound(inbound, 'ignored', decision.reason);
      emit({ type: 'skip', jid, contact: contact.name, reason: decision.reason });
      return;
    }

    await withLock(jid, async () => {
      const register = contact.register === 'auto' ? 'temen' : contact.register || 'temen';
      const level =
        register === 'kasar'
          ? 'temen_dekat'
          : register === 'sopan'
            ? 'temen'
            : register;
      const polite = level === 'keluarga' || level === 'wajib_sopan';
      const heavy = level === 'temen_dekat' || level === 'temen_poll';
      let forceDraft = false;
      let forceDraftReason = null;

      const rawStyle = pickStyle(db, contact);
      let examples = store.listExamples(db, jid, config.style.fewShotCount);

      // Untuk level sopan: buang semua contoh dan kosakata kasar dari prompt.
      const style =
        polite && rawStyle
          ? {
              ...rawStyle,
              notes: (rawStyle.notes || []).filter((n) => !CRUDE_RE.test(n)),
              examples: (rawStyle.examples || []).filter((e) => !CRUDE_RE.test(e)),
              stats: {
                ...rawStyle.stats,
                topSlang: (rawStyle.stats?.topSlang || []).filter(([w]) => !CRUDE_RE.test(w)),
              },
            }
          : rawStyle;

      if (polite) {
        examples = examples.filter((e) => !CRUDE_RE.test(e.mine) && !CRUDE_RE.test(e.their));
      }

      const relationship = await ensureRelationship(contact, examples);
      const history = store.recentMessages(db, jid, config.style.historyTurns * 2);

      const recent = recentOut(jid, 8);
      const activeActivity = store.getActiveActivity(db);
      const banned = bannedPhrases(jid);
      const crudeExamples = heavy
        ? examples.filter((e) => isCrude(e.mine)).slice(0, 6).map((e) => e.mine)
        : [];

      const knowledge = searchKnowledge(
        store.listKnowledge(db, { activeOnly: true, ownerId: waOwner() }),
        incomingBody,
        3,
      );

      let genCalls = 0;
      const MAX_GEN_CALLS = 2;
      const gen = async (over = {}) => {
        genCalls++;
        if (genCalls > MAX_GEN_CALLS) {
          const err = new Error('Batas percobaan AI tercapai');
          err.code = 'AI_BUDGET';
          throw err;
        }
        return withAiConfig(ai, () =>
          generateReply({
            meName: waOwnerName(),
            contactName: contact.name || number,
            style,
            relationship,
            examples,
            messages: history,
            image,
            recentReplies: recent,
            avoidPhrases: banned,
            register,
            crudeExamples,
            alias: contact.alias,
            language: contact.language,
            maxBubbles: contact.burst || 3,
            memory: contact.memory,
            activity: activeActivity,
            knowledge,
            ...over,
          }),
        );
      };

      let result;
      try {
        result = await gen();
      } catch (err) {
        emit({ type: 'error', message: `AI gagal: ${err.message}` });
        markInbound(inbound, 'error', err.message);
        return;
      }

      // Spam tidak pernah dikirim, bahkan bila policy awal lolos.
      if (result.intent === 'spam') {
        markInbound(inbound, 'ignored', 'spam');
        emit({ type: 'skip', jid, reason: 'Spam/promosi — tidak dibalas' });
        return;
      }

      // Repetisi: cek kalimat utuh DAN frasa 3 kata yang sudah basi.
      const repeated = result.reply
        ? recent.some((r) => tooSimilar(r, result.reply)) || hitsBanned(result.reply, banned).length > 0
        : false;

      if (repeated) {
        try {
          const alt = await gen({
            recentReplies: [...recent, result.reply],
            avoidPhrases: [...banned, ...hitsBanned(result.reply, banned)],
          });

          const altOk =
            alt.reply &&
            !recent.some((r) => tooSimilar(r, alt.reply)) &&
            hitsBanned(alt.reply, banned).length === 0;

          if (altOk) {
            result = { ...alt, reason: `${alt.reason} (variasi ulang)` };
          } else if (alt.reply) {
            result = alt;
          }
        } catch {
          /* pakai hasil pertama kalau gagal */
        }
      }

      // Kalau masih memakai frasa basi, potong paksa.
      if (result.reply) {
        const still = hitsBanned(result.reply, banned);
        if (still.length) {
          const cleaned = stripPhrases(result.reply, still);
          if (cleaned.length >= 3) result.reply = cleaned;
        }
      }

      // Joke basi: jangan pakai kalimat yang sudah dipakai >45 menit lalu.
      const stale = staleReplies(jid, 45);
      if (result.reply && stale.some((r) => tooSimilar(r, result.reply))) {
        try {
          const alt = await gen({
            recentReplies: [...recent, result.reply],
            strictShort: true,
            extraHint:
              'Jangan pakai joke atau kalimat lama yang sudah basi. Buat reaksi baru sesuai topik yang sedang dibahas sekarang.',
          });
          if (alt.reply) {
            result = { ...alt, reason: `${alt.reason} (hindari joke basi)` };
          }
        } catch {
          /* biarkan */
        }
      }

      // Kepanjangan? Gaya aslinya 2-8 kata, jadi minta versi pendek.
      const wordCount = (s) => normalizeText(s).split(' ').filter(Boolean).length;
      const maxWords = register === 'kasar' ? 6 : 12;
      if (result.reply && wordCount(result.reply) > maxWords) {
        try {
          const short = await gen({
            recentReplies: [...recent, result.reply],
            strictShort: true,
          });
          if (short.reply && wordCount(short.reply) < wordCount(result.reply)) {
            result = { ...short, reason: `${short.reason} (dipendekkan)` };
          }
        } catch {
          /* pakai yang ada */
        }
      }

      // Sindiran bapak/ibu: boleh, tapi jangan tiap balasan.
      const PARENT_RE = /\b(bapak|bapakmu|bapake|ibumu|ibukmu|makmu|mak e|emakmu)\b/i;
      if (heavy && result.reply && PARENT_RE.test(result.reply)) {
        const recently = recent.some((r) => PARENT_RE.test(r));
        if (recently) {
          try {
            const alt = await gen({
              recentReplies: [...recent, result.reply],
              avoidPhrases: [...banned, 'bapak', 'ibumu', 'makmu'],
              strictShort: true,
            });
            if (alt.reply && !PARENT_RE.test(alt.reply)) result = alt;
          } catch {
            /* biarkan */
          }
        }
      }

      // Guyunan seksual/ancaman: boleh, tapi jangan tiap balasan.
      const CRUDE_JOKE_RE = /\b(entod|ewe|ngewe|ewean|antemi|pateni|crot)\b/i;
      if (heavy && result.reply && CRUDE_JOKE_RE.test(result.reply)) {
        const recently = recent.some((r) => CRUDE_JOKE_RE.test(r));
        if (recently) {
          try {
            const alt = await gen({
              recentReplies: [...recent, result.reply],
              avoidPhrases: [...banned, 'entod', 'ewe', 'antemi', 'crot'],
              strictShort: true,
            });
            if (alt.reply && !CRUDE_JOKE_RE.test(alt.reply)) result = alt;
          } catch {
            /* biarkan */
          }
        }
      }

      // Level TEMAN: hanya kasar ringan (anjir/anj/jir).
      const HEAVY_RE = /\b(cok|jancok|jancuk|asu|kontol|memek|matio|nolo|ngawur|babi|crot|tai|bablas)\b/i;
      if (level === 'temen' && result.reply && HEAVY_RE.test(result.reply)) {
        try {
          const alt = await gen({
            avoidPhrases: [...banned, 'cok', 'jancok', 'asu', 'matio'],
            strictShort: true,
            extraHint:
              'Level teman: kasar ringan saja (anjir, anj, jir). Jangan pakai cok, jancok, asu, matio.',
          });
          if (alt.reply && !HEAVY_RE.test(alt.reply)) {
            result = alt;
          } else {
            forceDraft = true;
            forceDraftReason = 'Balasan masih kasar untuk kontak teman';
          }
        } catch {
          forceDraft = true;
          forceDraftReason = 'Balasan masih kasar untuk kontak teman';
        }
      }

      // Jangan pernah mengirim ejekan yang menyasar identitas.
      const IDENTITY_SLUR = /\b(boti|bencong|bencongan|femboy|homo)\b/i;
      const incomingHasGay = /\bgay\b/i.test(incomingBody);
      const violates = (text) =>
        IDENTITY_SLUR.test(text) || (!incomingHasGay && /\bgay\b/i.test(text));

      if (result.reply && violates(result.reply)) {
        try {
          const safe = await gen({
            recentReplies: [...recent, result.reply],
            avoidPhrases: [...banned, 'boti', 'femboy', 'bencong', 'gay'],
            strictShort: true,
          });
          if (safe.reply && !violates(safe.reply)) {
            result = { ...safe, reason: `${safe.reason} (tanpa ejekan identitas)` };
          } else {
            forceDraft = true;
            forceDraftReason = 'Balasan menyentuh identitas/orientasi';
          }
        } catch {
          forceDraft = true;
          forceDraftReason = 'Balasan menyentuh identitas/orientasi';
        }
      }

      if (!result.reply) {
        markInbound(inbound, 'skipped', `AI: ${result.reason || 'tidak perlu dibalas'}`);
        emit({
          type: 'skip',
          jid,
          contact: contact.name,
          reason: `AI menilai tidak perlu dibalas (${result.reason || 'tanpa alasan'})`,
        });
        return;
      }

      // Jangan pura-pura tidak paham kata yang barusan dia pakai.
      const inWords = new Set(normalizeText(incomingBody).split(' ').filter(Boolean));
      const echoedDumb = Object.keys(SLANG).find(
        (w) =>
          inWords.has(w) &&
          new RegExp(`\\b${w}\\s+(opo|apa)\\b`, 'i').test(result.reply || ''),
      );
      if (echoedDumb) {
        try {
          const alt = await gen({
            strictShort: true,
            extraHint: `Kamu paham "${echoedDumb}" artinya ${SLANG[echoedDumb]}. Balas sesuai maksudnya, jangan pura-pura tidak paham.`,
          });
          if (alt.reply) result = alt;
        } catch {
          /* biarkan */
        }
      }

      // Jangan mulai balasan dengan "opo cok" sebagai jalan pintas.
      if (
        result.reply &&
        /^\s*(opo\b|maksud(mu| mu)? opo\b)/i.test(result.reply) &&
        inWords.size >= 3
      ) {
        try {
          const alt = await gen({
            strictShort: true,
            avoidPhrases: [...banned, 'opo cok'],
            extraHint:
              'Jangan pura-pura tidak paham. Pahami dulu kata/kalimatnya dari konteks, lalu balas sesuai maksudnya.',
          });
          if (alt.reply) result = alt;
        } catch {
          /* biarkan */
        }
      }

      // Keluarga wajib sopan: kasar tidak boleh lolos.
      if (polite && result.reply && (CRUDE_RE.test(result.reply) || /\b(anjir|anj|jir)\b/i.test(result.reply))) {
        try {
          const alt = await gen({
            strictShort: true,
            avoidPhrases: [...banned, 'cok', 'jancok', 'asu', 'matio'],
            extraHint:
              'Ini keluarga. Balas dengan bahasa Indonesia sopan atau Jawa halus. Jangan pakai kata kasar sama sekali.',
          });
          if (alt.reply && !CRUDE_RE.test(alt.reply)) {
            result = alt;
          } else {
            forceDraft = true;
            forceDraftReason = 'Balasan kasar untuk keluarga';
          }
        } catch {
          forceDraft = true;
          forceDraftReason = 'Balasan kasar untuk keluarga';
        }
      }

      // Bahasa dikunci Indonesia? Jangan sampai ada kata Jawa lolos.
      if (contact.language === 'id' && result.reply && JAVANESE_RE.test(result.reply)) {
        try {
          const alt = await gen({
            strictShort: true,
            extraHint:
              'Balas HANYA bahasa Indonesia santai. Jangan pakai kata Jawa sama sekali, walaupun dia memakai Jawa.',
          });
          if (alt.reply && !JAVANESE_RE.test(alt.reply)) result = alt;
        } catch {
          /* biarkan */
        }
      }

      // "trimo" = nerima. Jangan pura-pura tidak paham.
      if (/\btrimo\b/i.test(incomingBody) && /\btrimo opo\b/i.test(result.reply)) {
        try {
          const alt = await gen({
            extraHint:
              'Kamu paham "trimo" artinya nerima (terima). Balas sesuai maksudnya, jangan pura-pura tidak paham.',
          });
          if (alt.reply && !/\btrimo opo\b/i.test(alt.reply)) result = alt;
        } catch {
          /* biarkan */
        }
      }

      // Ditanya gay? Jawab tegas, jangan menuduh balik.
      if (
        /\bgay\b/i.test(incomingBody) &&
        /\b(koe|kowe|kamu)\s+(sing\s+)?gay\b/i.test(result.reply)
      ) {
        try {
          const alt = await gen({
            avoidPhrases: [...banned, 'koe gay', 'koe sing gay'],
            strictShort: true,
            extraHint: 'Jawab tegas kalau kamu bukan gay. Jangan menuduh balik lawan bicara.',
          });
          if (alt.reply && !/\b(koe|kowe|kamu)\s+(sing\s+)?gay\b/i.test(alt.reply)) {
            result = alt;
          }
        } catch {
          /* biarkan */
        }
      }

      // Ajakan mabar / VC: jangan diiyain bot, minta konfirmasi Chesta dulu.
      const invitesPlay =
        /(mabar|main|ayo|yuk|jak|ajak|invite|mampir)/i.test(incomingBody) &&
        /(valo|valorant|\bml\b|mobile legend|hsr|honkai|\bdc\b|discord|\bvc\b|call)/i.test(
          incomingBody,
        );

      if (invitesPlay) {
        forceDraft = true;
        forceDraftReason = 'Ajakan main/VC — konfirmasi dulu ke Chesta';
      }

      // Pesanan dicatat walau balasan masih berupa draft. Pemilik tetap yang
      // mengonfirmasi, tapi daftar pesanan tidak boleh kosong.
      if (result.order) {
        const order = store.createOrder(db, {
          ownerId: waOwner(),
          customerName: result.order.customerName,
          items: result.order.items,
          total: result.order.total,
          source: 'chat',
        });
        emit({ type: 'order', jid, contact: contact.name, order });
      }

      const autoOk = shouldAutoSend({
        decision,
        confidence: result.confidence,
        forceDraft,
        needsOwner: result.needsOwner,
        intent: result.intent,
      });

      if (autoOk) {
        try {
          // Kirim per-bubble seperti manusia, jumlahnya gacha.
          const parts = planBubbles(result.reply, contact.burst || 3);

          let lastId = null;
          for (let i = 0; i < parts.length; i++) {
            if (i > 0) {
              await new Promise((r) => setTimeout(r, 900 + Math.random() * 900));
            }
            const sent = await wa.sendText(jid, parts[i]);
            lastId = sent?.key?.id || `out_${Date.now()}_${i}`;
            store.insertMessage(db, {
              id: lastId,
              jid,
              direction: 'out',
              body: parts[i],
              ts: Date.now(),
              status: 'auto_sent',
              reason: `auto (conf ${result.confidence.toFixed(2)})`,
            });
          }

          const sentDraft = store.createDraft(db, {
            jid,
            incomingId: inbound.at(-1)?.id ?? null,
            incomingBody,
            reply: parts.join('\n'),
            confidence: result.confidence,
            reason: result.reason,
            status: 'sent',
            createdAt: Date.now(),
          });
          store.updateDraft(db, sentDraft.id, { sent_at: Date.now() });
          markInbound(inbound, 'answered', `auto conf ${result.confidence.toFixed(2)}`);
          emit({
            type: 'sent',
            jid,
            contact: contact.name,
            reply: parts.join(' / '),
            confidence: result.confidence,
          });

          // Hitung pesan terkirim untuk jarak stiker.
          const prevCount = Number(store.kvGet(db, `stickerCount:${jid}`, '0'));
          store.kvSet(db, `stickerCount:${jid}`, String(prevCount + parts.length));

          // Lampirkan foto aktivitas kalau AI memintanya.
          if (result.attachActivity && activeActivity?.image_path && fs.existsSync(activeActivity.image_path)) {
            try {
              await wa.sendImage(jid, activeActivity.image_path, '');
              store.insertMessage(db, {
                id: `activity_${Date.now()}`,
                jid,
                direction: 'out',
                body: '[foto aktivitas]',
                ts: Date.now(),
                status: 'auto_sent',
                reason: 'aktivitas terkini',
              });
            } catch {
              /* foto opsional */
            }
          }

          if (result.attachPayment === 'qris') {
            const profile = store.getBusinessProfile(db, waOwner());
            const rel = String(profile?.qris_image_path || '').replace(/^\/uploads\//, '');
            const file = path.join(path.resolve(config.dataDir), 'uploads', rel);
            if (rel && fs.existsSync(file)) {
              try {
                await wa.sendImage(jid, file, '');
                store.insertMessage(db, {
                  id: `qris_${Date.now()}`,
                  jid,
                  direction: 'out',
                  body: '[gambar QRIS]',
                  ts: Date.now(),
                  status: 'auto_sent',
                  reason: 'pembayaran QRIS',
                });
              } catch {
                /* QRIS opsional */
              }
            }
          }

          await sendChosenSticker(jid, contact, result.sticker, { messages: history, reply: result.reply });
          return;
        } catch (err) {
          emit({ type: 'error', message: `Gagal kirim, dialihkan ke draft: ${err.message}` });
        }
      }

      store.createDraft(db, {
        jid,
        incomingId: inbound.at(-1)?.id ?? null,
        incomingBody,
        reply: result.reply,
        confidence: result.confidence,
        reason: forceDraft
          ? forceDraftReason || 'Perlu kamu cek dulu'
          : result.confidence < config.safety.autoConfidenceMin
            ? `Confidence rendah (${result.confidence.toFixed(2)}) — ${result.reason}`
            : decision.reason,
        status: 'pending',
        createdAt: Date.now(),
      });
      markInbound(inbound, 'drafted', 'menunggu persetujuan');
      emit({ type: 'draft', jid, contact: contact.name });
    });

    maybeRebuild(contact, jid);
  }

  async function ensureRelationship(contact, examples) {
    if (contact.relationship || examples.length < 8) return contact.relationship;
    const ai = resolveAi();
    if (!ai) return contact.relationship;
    try {
      const text = await withAiConfig(ai, () =>
        generateRelationship({
          meName: waOwnerName(),
          contactName: contact.name || 'dia',
          pairs: examples,
        }),
      );
      if (text) {
        store.saveProfile(db, contact.jid, { relationship: text });
        return text;
      }
    } catch (err) {
      emit({ type: 'error', message: `Gagal membuat relationship card: ${err.message}` });
    }
    return null;
  }

  async function handle(raw) {
    if (!raw?.id) return;

    if (raw.isGroup) {
      emit({ type: 'skip', jid: raw.chatJid, reason: 'grup' });
      return;
    }
    if (raw.isStatus || raw.isNewsletter) return;

    if (db.prepare('SELECT id FROM messages WHERE id = ?').get(raw.id)) return;

    let text = raw.text || (raw.hasMedia ? '[media]' : '');
    if (!text) return;

    const number = String(raw.chatJid).split('@')[0].split(':')[0];
    const altJid = normalizePnJid(raw.altJid);
    const phoneNumber = pnNumber(altJid);

    let contact = store.getContact(db, raw.chatJid);
    if (!contact) {
      const pending = store.findContactByImportName(db, raw.pushName);
      if (pending?.jid?.startsWith('name:')) {
        store.linkContactJid(db, pending.jid, raw.chatJid, number);
        contact = store.getContact(db, raw.chatJid);
      }
    }
    const pnContact = altJid ? store.getContact(db, altJid) : null;
    const bookName =
      (altJid && store.getWaName(db, altJid)) ||
      pnContact?.name ||
      store.getWaName(db, raw.chatJid) ||
      null;
    const betterName = bookName || raw.pushName || null;

    contact =
      contact ??
      store.upsertContact(db, {
        jid: raw.chatJid,
        number: phoneNumber || number,
        name: betterName || 'Orang',
        importName: raw.pushName,
      });

    // Kalau nama lama generik/salah, pakai nama dari buku kontak/nomor PN.
    const genericName =
      !contact.name ||
      contact.name === 'Orang' ||
      contact.name === contact.number ||
      /^\d+$/.test(contact.name || '') ||
      /chesta|adabi/i.test(contact.name || '');
    if (contact && (genericName || (phoneNumber && contact.number !== phoneNumber))) {
      store.upsertContact(db, {
        jid: raw.chatJid,
        name: betterName || contact.name,
        number: phoneNumber || contact.number,
      });
      contact = store.getContact(db, raw.chatJid);
    }
    if (betterName) store.setWaName(db, raw.chatJid, betterName);
    if (altJid && betterName && !store.getWaName(db, altJid)) {
      store.setWaName(db, altJid, betterName);
    }

    // Kontak baru: ada di buku kontak -> teman; tidak dikenal -> wajib sopan.
    if (contact && (!contact.register || contact.register === 'auto')) {
      store.setContactRegister(db, raw.chatJid, bookName ? 'temen' : 'wajib_sopan');
      contact = store.getContact(db, raw.chatJid);
    }

    if (!contact.name && raw.pushName) {
      store.upsertContact(db, { jid: raw.chatJid, name: raw.pushName, importName: raw.pushName });
      contact = store.getContact(db, raw.chatJid);
    }

    store.touchContact(db, raw.chatJid);
    store.insertMessage(db, {
      id: raw.id,
      jid: raw.chatJid,
      direction: raw.fromMe ? 'out' : 'in',
      body: raw.text || text,
      ts: raw.timestamp,
      waId: raw.id,
      status: raw.fromMe ? 'manual' : 'received',
    });

    if (raw.fromMe) {
      // Stiker yang kamu kirim sendiri ikut dikoleksi untuk dipakai nanti.
      if (raw.mediaType === 'sticker') {
        try {
          const buf = await wa.downloadMedia(raw.raw);
          const saved = saveSticker(buf, raw.mimetype);
          if (saved) emit({ type: 'log', message: `Stiker kamu disimpan (${saved})` });
        } catch {
          /* abaikan */
        }
      }
      emit({ type: 'log', message: `Kamu mengetik manual ke ${contact.name || number}.` });
      maybeRebuild(contact, raw.chatJid);
      return;
    }

    const ai = resolveAi();
    if (!ai) {
      store.updateMessageStatus(db, raw.id, 'skipped', 'API key AI akun ini belum diatur');
      emit({
        type: 'error',
        message: `API key AI belum diatur untuk ${waOwnerName()}. Buka Setting di dashboard.`,
      });
      return;
    }

    if (Date.now() - raw.timestamp > 3 * 60 * 1000) {
      store.updateMessageStatus(db, raw.id, 'skipped', 'pesan lama (>3 menit), tidak dibalas');
      return;
    }

    // --- Media: gambar dilihat, suara ditranskrip ---
    let imageDataUrl = null;
    if (raw.mediaType) {
      try {
        if (raw.mediaType === 'image') {
          const buf = await wa.downloadMedia(raw.raw);
          if (buf.length > 6 * 1024 * 1024) {
            store.updateMessageStatus(db, raw.id, 'skipped', 'gambar terlalu besar (>6 MB)');
            return;
          }
          imageDataUrl = `data:${raw.mimetype || 'image/jpeg'};base64,${buf.toString('base64')}`;
          if (!raw.text) text = '[gambar]';
        } else if (raw.mediaType === 'audio') {
          if (!transcribeReady()) {
            store.updateMessageStatus(db, raw.id, 'skipped', 'pesan suara (transkrip mati)');
            return;
          }
          const transcript = await transcribeAudio(await wa.downloadMedia(raw.raw), raw.mimetype);
          if (!transcript) {
            store.updateMessageStatus(db, raw.id, 'skipped', 'pesan suara kosong');
            return;
          }
          text = raw.text ? `${raw.text}\n[suara] ${transcript}` : `[suara] ${transcript}`;
        } else if (raw.mediaType === 'sticker') {
          // Stiker: disimpan untuk koleksi, dan dilihat isinya oleh AI.
          const buf = await wa.downloadMedia(raw.raw);
          const saved = saveSticker(buf, raw.mimetype);
          const png = await stickerPreview(buf);
          if (png) {
            imageDataUrl = `data:image/png;base64,${png.toString('base64')}`;
          }
          text = '[stiker]';
          if (saved) emit({ type: 'log', message: `Stiker disimpan (${saved})` });
        } else {
          store.updateMessageStatus(db, raw.id, 'skipped', `media ${raw.mediaType} belum didukung`);
          return;
        }
      } catch (err) {
        store.updateMessageStatus(db, raw.id, 'error', `gagal unduh media: ${err.message}`);
        return;
      }

      db.prepare('UPDATE messages SET body = ? WHERE id = ?').run(text, raw.id);
    }

    // Tunda sebentar: siapa tahu dia masih mengetik bubble berikutnya.
    return scheduleRun(raw.chatJid, imageDataUrl);
  }

  return { handle, notePresence };
}

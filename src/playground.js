/**
 * Pipeline playground: memakai jalur AI + policy yang sama dengan WhatsApp,
 * tetapi masuk lewat HTTP, tanpa menulis ke messages/drafts.
 */
import crypto from 'node:crypto';
import { config } from './config.js';
import * as store from './db.js';
import { decide as defaultDecide, dayStart, hourStart } from './policy.js';
import { generateReply as defaultGenerateReply } from './ai/prompt.js';
import { searchKnowledge } from './knowledge.js';

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 300;
const MAX_TURNS = 10;
const MAX_MESSAGE_CHARS = 1000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 20;

const parseStyle = (value) => {
  if (!value) return null;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return null;
  }
};

const hash = (value) =>
  crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);

export function createPlayground({
  db,
  generateReply = defaultGenerateReply,
  decide = defaultDecide,
  now = Date.now,
}) {
  const sessions = new Map();
  const buckets = new Map();

  function rateLimited(ip) {
    const at = now();
    const list = (buckets.get(ip) || []).filter((t) => at - t < RATE_WINDOW_MS);
    if (list.length >= RATE_MAX) {
      buckets.set(ip, list);
      return true;
    }
    list.push(at);
    buckets.set(ip, list);
    return false;
  }

  function prune() {
    const at = now();
    for (const [id, s] of sessions) {
      if (at - s.lastAt > SESSION_TTL_MS) sessions.delete(id);
    }
    if (sessions.size <= MAX_SESSIONS) return;
    const oldest = [...sessions.entries()].sort((a, b) => a[1].lastAt - b[1].lastAt);
    for (const [id] of oldest.slice(0, sessions.size - MAX_SESSIONS)) sessions.delete(id);
  }

  function getSession(sessionId) {
    const id = sessionId ? String(sessionId) : crypto.randomUUID();
    let session = sessions.get(id);
    if (!session || now() - session.lastAt > SESSION_TTL_MS) {
      session = { id, messages: [], createdAt: now(), lastAt: now(), turns: 0 };
      sessions.set(id, session);
    } else {
      session.lastAt = now();
    }
    return session;
  }

  function metrics() {
    const totals = store.playgroundEventTotals(db);
    return {
      messages: Number(totals.messages) || 0,
      auto: Number(totals.auto) || 0,
      draft: Number(totals.draft) || 0,
      ignore: Number(totals.ignored) || 0,
      escalated: Number(totals.escalated) || 0,
      avgLatencyMs: Math.round(Number(totals.avg_latency_ms) || 0),
      sessions: sessions.size,
    };
  }

  async function chat({ sessionId, ip = 'unknown', personaJid, message, language = 'auto' } = {}) {
    const text = String(message || '').trim();
    if (!text) return { sessionId: null, reply: null, error: 'Pesan wajib diisi' };
    if (text.length > MAX_MESSAGE_CHARS)
      return { sessionId: sessionId || null, reply: null, error: `Pesan maksimal ${MAX_MESSAGE_CHARS} karakter` };
    if (rateLimited(ip))
      return { sessionId: sessionId || null, reply: null, error: 'Terlalu banyak pesan. Coba lagi beberapa menit lagi.' };

    prune();
    const session = getSession(sessionId);
    session.turns += 1;
    if (session.turns > MAX_TURNS) {
      session.messages = [];
      session.turns = 1;
    }

    const contact =
      store.getContact(db, personaJid) || {
        jid: personaJid,
        name: 'Pelanggan',
        mode: 'auto',
      };

    const started = now();
    try {
      const knowledge = searchKnowledge(store.listKnowledge(db), text, 3);
      const result = await generateReply({
        meName: config.me,
        contactName: contact.alias || contact.name || 'Pelanggan',
        style: parseStyle(contact.style_profile),
        relationship: contact.relationship,
        examples: store.listExamples(db, personaJid, config.style.fewShotCount),
        messages: [...session.messages, { direction: 'in', body: text, ts: now() }],
        recentReplies: session.messages.filter((m) => m.direction === 'out').map((m) => m.body).slice(-8),
        language: language || contact.language || 'auto',
        maxBubbles: contact.burst || 3,
        memory: contact.memory || null,
        knowledge,
      });

      const decision = decide({
        jid: personaJid,
        contact,
        paused: store.kvGet(db, 'paused') === '1',
        counts: {
          day: store.countOutSince(db, dayStart(new Date(now()))),
          hour: store.countOutSince(db, hourStart(new Date(now()))),
          contactToday: 0,
          lastContactSentAt: 0,
        },
        needsOwner: result.needsOwner === true,
        ownerReason: result.ownerReason,
      });

      const latencyMs = Math.max(0, now() - started);
      const sources = (result.knowledgeUsed || [])
        .map((id) => knowledge.find((k) => k.id === id))
        .filter(Boolean)
        .map((k) => ({ id: k.id, title: k.title, category: k.category }));

      session.messages.push({ direction: 'in', body: text, ts: now() });
      if (result.reply) session.messages.push({ direction: 'out', body: result.reply, ts: now() });
      session.messages = session.messages.slice(-20);

      store.recordPlaygroundEvent(db, {
        sessionHash: hash(session.id),
        intent: result.intent,
        action: decision.action,
        needsOwner: result.needsOwner,
        latencyMs,
      });

      return {
        sessionId: session.id,
        reply: result.reply,
        trace: {
          action: decision.action,
          policyReason: decision.reason,
          confidence: result.confidence,
          intent: result.intent,
          needsOwner: result.needsOwner === true,
          ownerReason: result.ownerReason || '',
          sources,
          model: config.ai.model,
          latencyMs,
          turns: session.turns,
        },
      };
    } catch (err) {
      const latencyMs = Math.max(0, now() - started);
      store.recordPlaygroundEvent(db, {
        sessionHash: hash(session.id),
        intent: 'error',
        action: 'error',
        needsOwner: false,
        latencyMs,
      });
      return {
        sessionId: session.id,
        reply: null,
        error: `AI gagal menjawab: ${err.message}`,
        trace: {
          action: 'error',
          policyReason: 'Provider AI gagal — tidak ada pesan yang dikirim.',
          confidence: 0,
          intent: 'error',
          needsOwner: false,
          ownerReason: '',
          sources: [],
          model: config.ai.model,
          latencyMs,
          turns: session.turns,
        },
      };
    }
  }

  function reset(sessionId) {
    if (sessionId) sessions.delete(String(sessionId));
    return { ok: true };
  }

  return { chat, reset, metrics, stats: () => ({ sessions: sessions.size }) };
}

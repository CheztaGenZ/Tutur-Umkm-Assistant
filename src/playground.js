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
  ownerId: defaultOwnerId = 'demo',
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
    let base = null;
    try {
      base = JSON.parse(store.kvGet(db, 'demo_baseline') || 'null');
    } catch {
      base = null;
    }
    const liveMessages = Number(totals.messages) || 0;
    const liveAuto = Number(totals.auto) || 0;
    const liveDraft = Number(totals.draft) || 0;
    const liveIgnore = Number(totals.ignored) || 0;
    const liveEscalated = Number(totals.escalated) || 0;

    const messages = liveMessages + (Number(base?.messages) || 0);
    const auto = liveAuto + (Number(base?.auto) || 0);
    const escalated = liveEscalated + (Number(base?.escalated) || 0);

    return {
      messages,
      auto,
      draft: liveDraft,
      ignore: liveIgnore,
      escalated,
      avgLatencyMs: Math.round(Number(totals.avg_latency_ms) || 0),
      sessions: sessions.size,
      liveMessages,
      simulatedDays: Number(base?.days) || 0,
      autoRate: messages ? Math.round((auto / messages) * 100) : 0,
      ownerMinutesSaved: Math.round(auto * 1.5),
      source: base ? 'simulated+live' : 'live',
    };
  }

  async function chat({ sessionId, ip = 'unknown', personaJid, message, language = 'auto', ownerId = defaultOwnerId } = {}) {
    const text = String(message || '').trim();
    if (!text) return { sessionId: null, reply: null, error: 'Pesan wajib diisi' };
    if (text.length > MAX_MESSAGE_CHARS)
      return { sessionId: sessionId || null, reply: null, error: `Pesan maksimal ${MAX_MESSAGE_CHARS} karakter` };
    if (config.demo.enabled && config.demo.dailyLimit > 0) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const used = db
        .prepare('SELECT COUNT(*) AS n FROM playground_events WHERE ts >= ?')
        .get(start.getTime()).n;
      if (Number(used) >= config.demo.dailyLimit) {
        return {
          sessionId: sessionId || null,
          reply: null,
          error: 'Kuota demo hari ini habis. Coba lagi besok atau jalankan sendiri.',
        };
      }
    }
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
        mode: 'draft',
      };

    const started = now();
    try {
      const knowledge = searchKnowledge(store.listKnowledge(db, { ownerId, activeOnly: true }), text, 3);
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
        usageKind: 'playground',
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
        intent: result.intent,
      });

      const latencyMs = Math.max(0, now() - started);
      const cited = new Set(result.knowledgeUsed || []);
      const chosen = cited.size ? knowledge.filter((k) => cited.has(k.id)) : knowledge;
      const sources = chosen.map((k) => ({ id: k.id, title: k.title, category: k.category }));

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

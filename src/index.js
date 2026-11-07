import { EventEmitter } from 'node:events';
import path from 'node:path';
import { config } from './config.js';
import { openDb, recordAiUsage } from './db.js';
import { setUsageSink } from './ai/usage.js';
import { WhatsAppManager } from './wa/manager.js';
import { createMessageHandler, createContactSync, createHistoryIngest } from './wa/handler.js';
import { repairLidContacts } from './wa/contactRepair.js';
import { watchInbox } from './ingest/autoimport.js';
import { processStatusJobs } from './wa/statusWorker.js';
import { createServer } from './server.js';
import { seedDemo } from './demo/seed.js';

const dataDir = path.resolve(config.dataDir);
const inboxDir = process.env.IMPORT_INBOX || 'import-inbox';
const db = openDb(dataDir);
setUsageSink((row) => recordAiUsage(db, row));

if (config.demo.enabled) {
  config.me = process.env.DEMO_OWNER || 'Sari';
  const seeded = seedDemo({ db });
  if (seeded.contacts || seeded.knowledge) {
    console.log(
      `  Demo     : ${seeded.contacts} kontak, ${seeded.knowledge} sumber, ${seeded.examples} contoh`,
    );
  }
}

const bus = new EventEmitter();
bus.setMaxListeners(100);

const wa = new WhatsAppManager({ dataDir });
const handlers = new Map();
const contactSyncs = new Map();
const historyIngests = new Map();

function clientFor(ownerId) {
  return wa.client(ownerId);
}

function handlerFor(ownerId) {
  let handler = handlers.get(ownerId);
  if (!handler) {
    handler = createMessageHandler({ db, wa: clientFor(ownerId), bus, ownerId });
    handlers.set(ownerId, handler);
  }
  return handler;
}

function contactSyncFor(ownerId) {
  let sync = contactSyncs.get(ownerId);
  if (!sync) {
    sync = createContactSync({ db, bus, ownerId });
    contactSyncs.set(ownerId, sync);
  }
  return sync;
}

function historyIngestFor(ownerId) {
  let ingest = historyIngests.get(ownerId);
  if (!ingest) {
    ingest = createHistoryIngest({ db, wa: clientFor(ownerId), bus, ownerId });
    historyIngests.set(ownerId, ingest);
  }
  return ingest;
}

const repairTimers = new Map();
function scheduleContactRepair(ownerId) {
  clearTimeout(repairTimers.get(ownerId));
  repairTimers.set(
    ownerId,
    setTimeout(() => {
      repairLidContacts({ db, wa: clientFor(ownerId), bus, ownerId }).catch((err) => {
        bus.emit('event', { type: 'error', ownerId, message: `Perbaikan kontak LID: ${err.message}` });
      });
    }, 3000),
  );
}

wa.on('contacts', ({ ownerId, payload }) => {
  try {
    contactSyncFor(ownerId)(payload);
    scheduleContactRepair(ownerId);
  } catch (err) {
    console.error('Sinkronisasi kontak gagal:', err.message);
  }
});

wa.on('state', ({ ownerId, payload }) => {
  bus.emit('event', { type: 'wa', ownerId, state: payload });
  if (payload.status === 'open') {
    console.log(
      `  WhatsApp ${ownerId}: terhubung sebagai ${payload.me?.name || payload.me?.number || '?'}`,
    );
  } else if (payload.status === 'qr') {
    console.log(`  WhatsApp ${ownerId}: belum login, buka dashboard untuk scan QR.`);
  }
});

wa.on('presence', ({ ownerId, payload = {} }) => {
  const handler = handlerFor(ownerId);
  const presences = payload.presences || {};
  for (const [jid, p] of Object.entries(presences)) {
    if (p?.lastKnownPresence === 'composing') handler.notePresence(jid, 'composing');
  }
});

wa.on('history', ({ ownerId, payload }) => {
  historyIngestFor(ownerId)(payload).catch((err) => {
    bus.emit('event', { type: 'error', ownerId, message: `Gagal menyerap riwayat: ${err.message}` });
  });
});

wa.on('message', ({ ownerId, payload }) => {
  handlerFor(ownerId)
    .handle(payload)
    .catch((err) => {
      bus.emit('event', { type: 'error', ownerId, message: err.message });
    });
});

wa.on('error', ({ ownerId, payload }) => {
  const message = payload?.message || String(payload);
  console.error(`  WA ${ownerId}:`, message);
  bus.emit('event', { type: 'error', ownerId, message });
});

const app = createServer({ db, wa, bus });
const bindHost = process.env.BIND_HOST || '127.0.0.1';
const server = app.listen(config.port, bindHost, () => {
  console.log('');
  console.log('  Tutur');
  console.log(`  Dashboard : http://localhost:${config.port}`);
  console.log(`  Bind      : ${bindHost}`);
  console.log(`  Model     : ${config.ai.model}`);
  console.log(`  Nama kamu : ${config.me}`);
  console.log(`  Pagar     : max ${config.safety.maxPerDay}/hari, jeda ${config.safety.minGapPerContactSec}s/kontak, quiet ${config.safety.quietHours}`);
  console.log(`  Inbox     : ${path.resolve(inboxDir)}  (taruh .zip di sini, auto-import)`);
  console.log('');
  if (!config.ai.apiKey) {
    console.warn('  AI_API_KEY server belum diisi. Akun tetap bisa memakai key masing-masing.');
  }
});

watchInbox({ db, bus, dir: inboxDir });

setInterval(() => {
  for (const ownerId of wa.clients.keys()) {
    processStatusJobs({ db, wa: clientFor(ownerId), bus, ownerId }).catch((err) => {
      bus.emit('event', { type: 'error', ownerId, message: `Worker status: ${err.message}` });
    });
  }
}, 30000);

if (config.demo.enabled && process.env.WA_ENABLED !== '1') {
  console.log('  WhatsApp : dimatikan (DEMO_MODE=1)');
} else if (process.env.WA_DISABLED === '1') {
  console.log('  WhatsApp : dimatikan (WA_DISABLED=1)');
} else {
  wa.startAll().catch((err) => {
    console.error('Gagal memulai WhatsApp:', err.message);
  });
}

async function shutdown() {
  console.log('\nMematikan...');
  await wa.stopAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

import { EventEmitter } from 'node:events';
import path from 'node:path';
import { config } from './config.js';
import { openDb, recordAiUsage } from './db.js';
import { setUsageSink } from './ai/usage.js';
import { WhatsAppClient } from './wa/client.js';
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

const wa = new WhatsAppClient({ dataDir });
const allowGlobalAi = config.demo.enabled && process.env.WA_ENABLED !== '1';
const handler = createMessageHandler({ db, wa, bus, allowGlobalAi });
const syncContacts = createContactSync({ db, bus });

let repairTimer = null;
function scheduleContactRepair() {
  clearTimeout(repairTimer);
  repairTimer = setTimeout(() => {
    repairLidContacts({ db, wa, bus }).catch((err) => {
      bus.emit('event', { type: 'error', message: `Perbaikan kontak LID: ${err.message}` });
    });
  }, 3000);
}

wa.on('contacts', (list) => {
  try {
    syncContacts(list);
    scheduleContactRepair();
  } catch (err) {
    console.error('Sinkronisasi kontak gagal:', err.message);
  }
});

wa.on('ready', scheduleContactRepair);

// Lawan bicara sedang mengetik lagi -> tunda balasan (bubble bersambung).
wa.on('presence', (payload = {}) => {
  const presences = payload.presences || {};
  for (const [jid, p] of Object.entries(presences)) {
    if (p?.lastKnownPresence === 'composing') handler.notePresence(jid, 'composing');
  }
});

const ingestHistory = createHistoryIngest({ db, wa, bus });
wa.on('history', (payload) => {
  ingestHistory(payload).catch((err) => {
    bus.emit('event', { type: 'error', message: `Gagal menyerap riwayat: ${err.message}` });
  });
});

wa.on('message', (msg) => {
  handler.handle(msg).catch((err) => {
    bus.emit('event', { type: 'error', message: err.message });
  });
});

wa.on('state', (state) => {
  bus.emit('event', { type: 'wa', state });
  if (state.status === 'open') {
    console.log(`✓ WhatsApp terhubung sebagai ${state.me?.name || state.me?.number || '?'}`);
  } else if (state.status === 'qr') {
    console.log('→ Belum login. Buka dashboard untuk scan QR.');
  }
});

wa.on('error', (err) => {
  console.error('✗ WA:', err.message);
  bus.emit('event', { type: 'error', message: err.message });
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
    console.warn('  ⚠ AI_API_KEY belum diisi — balasan tidak akan bisa dibuat.');
  }
});

// Folder auto-import: taruh file export di sini, tidak perlu buka dashboard.
watchInbox({ db, bus, dir: inboxDir });

// Worker status terjadwal: cek tiap 30 detik.
setInterval(() => {
  processStatusJobs({ db, wa, bus }).catch((err) => {
    bus.emit('event', { type: 'error', message: `Worker status: ${err.message}` });
  });
}, 30000);

if (config.demo.enabled && process.env.WA_ENABLED !== '1') {
  console.log('  WhatsApp : dimatikan (DEMO_MODE=1)');
} else if (process.env.WA_DISABLED === '1') {
  console.log('  WhatsApp : dimatikan (WA_DISABLED=1)');
} else {
  wa.start().catch((err) => {
    console.error('Gagal memulai WhatsApp:', err.message);
  });
}

async function shutdown() {
  console.log('\nMematikan...');
  await wa.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

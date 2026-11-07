import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import * as store from './db.js';
import { parseExport, buildPairs } from './ingest/parseExport.js';
import { analyzeStyle, detectRegister } from './ingest/style.js';
import { generateReply, generateRelationship } from './ai/prompt.js';
import { rebuildProfile } from './ingest/rebuild.js';
import { seedHistory } from './ingest/seed.js';
import { addGroupSamples } from './ingest/groupStyle.js';
import { pickStyle } from './ingest/groupStyle.js';
import { expandSlang } from './ai/slangExtra.js';
import { sendStatusJob } from './wa/statusWorker.js';
import { splitBubbles } from './wa/bubbles.js';
import { decide, dayStart, hourStart } from './policy.js';
import { createPlayground } from './playground.js';
import { DEMO_BUSINESS, DEMO_PERSONAS, DEMO_SCENARIOS } from './demo/personas.js';
import { getSettings, saveSettings, testSettings, isLocalRequest, isPrivateRemote, publicBaseUrl } from './settings.js';
import {
  parseCookies,
  serializeCookie,
  createUser,
  authenticate,
  createSession,
  getSessionUser,
  deleteSession,
  upsertOAuthUser,
  acceptTerms,
} from './auth.js';
import * as products from './products.js';
import { aiConfigForOwner, aiInfoForOwner } from './ai/account.js';
import { decryptSecret, encryptSecret } from './secrets.js';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'kontak';

const parseStyle = (json) => {
  if (!json) return null;
  try {
    return typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return null;
  }
};

const publicStatusJob = (job) => {
  if (!job) return null;
  let recipientCount = 0;
  try {
    recipientCount = JSON.parse(job.wa_status_jids || '[]').length;
  } catch {}
  return {
    id: job.id,
    caption: job.caption,
    scheduled_at: job.scheduled_at,
    status: job.status,
    attempts: job.attempts,
    sent_at: job.sent_at,
    has_image: Boolean(job.image_path),
    can_revoke: job.status === 'sent' && Boolean(job.wa_message_id),
    recipient_count: recipientCount,
  };
};

const publicActivity = (activity) =>
  activity
    ? {
        id: activity.id,
        text: activity.text,
        active: activity.active,
        expires_at: activity.expires_at,
        created_at: activity.created_at,
        has_image: Boolean(activity.image_path),
      }
    : null;

/** Event SSE untuk pembaca LAN: metadata saja, tanpa isi chat/identitas. */
const redactEventForLan = (event = {}) => {
  const type = String(event.type || 'event');
  if (type === 'wa') return { type, state: { status: event.state?.status || null } };
  if (type === 'sent') return { type, manual: Boolean(event.manual) };
  if (type === 'log') return { type, message: 'Aktivitas disembunyikan di mode LAN.' };
  if (type === 'error') return { type, message: 'Terjadi error. Cek log di PC.' };
  return { type };
};

export function createServer({ db, wa, bus }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.demo.enabled || String(config.auth.publicBaseUrl).startsWith('https://')) {
    app.set('trust proxy', 1);
  }

  // Paksa HTTPS saat situs sudah punya domain publik.
  app.use((req, res, next) => {
    if (!String(config.auth.publicBaseUrl).startsWith('https://')) return next();
    const proto = req.get('x-forwarded-proto') || req.protocol;
    if (proto === 'https') return next();
    return res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
  });

  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
  try {
    allowedHosts.add(os.hostname().toLowerCase());
  } catch {}
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets || []) {
      if (!net?.address) continue;
      allowedHosts.add(String(net.address).toLowerCase().replace(/^\[|\]$/g, ''));
    }
  }
  for (const host of String(process.env.ALLOWED_HOSTS || '').split(',')) {
    const clean = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (clean) allowedHosts.add(clean);
  }

  const hostAllowed = (req) => {
    const raw = String(req.headers.host || '').trim().toLowerCase();
    if (!raw) return false;
    let hostname;
    try {
      hostname = new URL(`http://${raw}`).hostname;
    } catch {
      return false;
    }
    hostname = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return allowedHosts.has(hostname);
  };

  app.use((req, res, next) => {
    res.set({
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
    });
    if (String(config.auth.publicBaseUrl).startsWith('https://')) {
      res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  app.use((req, res, next) => {
    if (!hostAllowed(req)) return res.status(403).json({ error: 'Host tidak diizinkan.' });
    next();
  });

  const adminAllowed = (req) => {
    if (req.user) return true;
    if (!config.demo.enabled) return false;
    const token = config.demo.adminToken;
    if (!token) return false;
    if (req.get('x-admin-token') === token) return true;
    // Query token hanya untuk SSE, karena EventSource tidak bisa mengirim header.
    return req.path.endsWith('/events') && req.query?.token === token;
  };

  const dashboardAllowed = (req) =>
    adminAllowed(req) || (!config.demo.enabled && isPrivateRemote(req));

  const playground = createPlayground({ db });

  app.use((req, res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    req.sessionToken = req.cookies.tutur_session || '';
    req.user = getSessionUser(db, req.sessionToken);
    next();
  });

  app.use(
    '/uploads',
    express.static(path.join(path.resolve(config.dataDir), 'uploads'), {
      maxAge: '7d',
      fallthrough: true,
    }),
  );

  // ---------------------- public playground (tanpa login) ----------------------
  const publicHits = new Map();
  app.use('/api/public', express.json({ limit: '16kb' }));
  app.use('/api/public', (req, res, next) => {
    const ip = String(req.ip || 'unknown');
    const now = Date.now();
    const hits = (publicHits.get(ip) || []).filter((t) => now - t < 60_000);
    if (hits.length >= 30) {
      return res.status(429).json({ error: 'Terlalu banyak permintaan. Coba lagi sebentar.' });
    }
    hits.push(now);
    publicHits.set(ip, hits);
    next();
  });

  app.get('/api/public/playground/state', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const profile = req.user ? store.getBusinessProfile(db, req.user.id) : null;
    res.json({
      personal: Boolean(profile),
      business: {
        name: profile?.name || config.demo.businessName,
        tagline: profile?.specialty || DEMO_BUSINESS.tagline,
        location: profile?.location || DEMO_BUSINESS.location,
      },
      personas: DEMO_PERSONAS.map(({ jid, name, label, language, mode }) => ({
        jid,
        name,
        label,
        language,
        mode,
      })),
      scenarios: DEMO_SCENARIOS,
      metrics: playground.metrics(),
      model: config.ai.model,
    });
  });

  app.post('/api/public/playground/chat', async (req, res) => {
    const personaJid = DEMO_PERSONAS.some((p) => p.jid === req.body?.personaJid)
      ? req.body.personaJid
      : DEMO_PERSONAS[0].jid;
    const ip = String(req.ip || 'unknown');
    const aiConfig = req.user ? aiConfigForOwner(db, req.user.id) : config.ai;
    if (req.user && !aiConfig) {
      return res.status(400).json({
        error: 'API key AI belum diatur untuk akun ini. Buka Setting di dashboard.',
      });
    }
    const result = await playground.chat({
      sessionId: req.body?.sessionId,
      ip,
      personaJid,
      message: req.body?.message,
      language: req.body?.language,
      ownerId: req.user?.id || 'demo',
      meName: req.user?.name || config.me,
      aiConfig,
    });
    res.status(result.error && !result.trace ? 400 : 200).json(result);
  });

  app.post('/api/public/playground/reset', (req, res) => {
    res.json(playground.reset(req.body?.sessionId));
  });

  app.get('/api/public/impact', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(playground.metrics());
  });

  /* ---------------------------------- akun ---------------------------------- */

  const sessionCookie = (req, res, token) => {
    const secure = String(config.auth.publicBaseUrl || '').startsWith('https') || req.secure;
    res.append(
      'Set-Cookie',
      serializeCookie('tutur_session', token, {
        maxAge: 7 * 24 * 60 * 60,
        secure,
        sameSite: 'Lax',
      }),
    );
  };

  const originBase = (req) => config.auth.publicBaseUrl || `${req.protocol}://${req.get('host')}`;

  const publicUser = (user) =>
    user
      ? {
          id: user.id,
          email: user.email,
          name: user.name,
          avatar: user.avatar_url || '',
          termsAccepted: Boolean(user.terms_accepted),
          needsProfile: !store.getBusinessProfile(db, user.id),
        }
      : null;

  const authAttempts = new Map();
  const authLimiter = (req, res, next) => {
    const ip = String(req.ip || 'unknown');
    const now = Date.now();
    const hits = (authAttempts.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
    if (hits.length >= 10) {
      return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi 10 menit lagi.' });
    }
    hits.push(now);
    authAttempts.set(ip, hits);
    next();
  };

  app.post('/api/public/auth/register', authLimiter, (req, res) => {
    if (req.body?.acceptedTerms !== true) {
      return res.status(400).json({ error: 'Setujui Ketentuan Layanan dan Kebijakan Privasi dulu.' });
    }
    try {
      const user = createUser(db, {
        name: req.body?.name,
        email: req.body?.email,
        password: req.body?.password,
      });
      const token = createSession(db, user.id);
      sessionCookie(req, res, token);
      res.json({ user: publicUser(user) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/public/auth/login', authLimiter, (req, res) => {
    const user = authenticate(db, req.body?.email, req.body?.password);
    if (!user) return res.status(401).json({ error: 'Email atau password tidak cocok.' });
    const token = createSession(db, user.id);
    sessionCookie(req, res, token);
    res.json({ user: publicUser(user) });
  });

  app.post('/api/public/auth/logout', (req, res) => {
    deleteSession(db, req.sessionToken);
    res.append('Set-Cookie', serializeCookie('tutur_session', '', { maxAge: 0 }));
    res.json({ ok: true });
  });

  app.get('/api/public/auth/me', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ user: publicUser(req.user) });
  });

  app.post('/api/public/auth/accept-terms', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Silakan masuk dulu.' });
    const user = acceptTerms(db, req.user.id);
    res.json({ user: publicUser(user) });
  });

  /* ---------------------------- profil usaha ------------------------------- */

  app.use('/api/business', express.json({ limit: '1mb' }));

  app.get('/api/business', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Silakan masuk dulu.' });
    res.json({ profile: store.getBusinessProfile(db, req.user.id) });
  });

  app.post('/api/business', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Silakan masuk dulu.' });
    try {
      const body = req.body || {};
      let qrisPath = null;
      if (body.qrisImage) {
        const dir = path.join(path.resolve(config.dataDir), 'uploads', 'qris');
        const saved = saveImage(body.qrisImage, dir, `qris-${req.user.id}`);
        if (saved) qrisPath = `/uploads/qris/${path.basename(saved)}`;
      }
      const paymentMethods = Array.isArray(body.paymentMethods)
        ? body.paymentMethods.join(', ')
        : String(body.paymentMethods || '').trim();
      const profile = store.upsertBusinessProfile(db, req.user.id, {
        ...body,
        payment_methods: paymentMethods,
        bank_info: String(body.bank_info || body.bankInfo || '').trim(),
        qris_image_path: qrisPath,
      });
      const owner = req.user.id;
      const facts = [
        ['bisnis-jam', 'jam', 'Jam buka', profile.hours, 'jam buka, open, hours, tutup'],
        ['bisnis-lokasi', 'lokasi', 'Lokasi', profile.location, 'lokasi, alamat, location, address'],
        ['bisnis-keunggulan', 'umum', 'Keunggulan', profile.specialty, 'keunggulan, spesial, menu andalan'],
        ['bisnis-kontak', 'umum', 'Kontak', profile.contact, 'kontak, telepon, whatsapp, wa'],
        ['bisnis-catatan', 'umum', 'Catatan usaha', profile.notes, 'catatan, info, kebijakan'],
        [
          'bisnis-pembayaran',
          'kebijakan',
          'Pembayaran',
          [profile.payment_methods, profile.bank_info].filter(Boolean).join('. '),
          'bayar, pembayaran, payment, qris, transfer, bank, tunai, cash',
        ],
      ];
      for (const [id, category, title, bodyText, keywords] of facts) {
        const legacy = store.getKnowledge(db, id);
        if (legacy && legacy.owner_id === owner) store.deleteKnowledge(db, id);
        if (!bodyText) continue;
        store.upsertKnowledge(db, {
          id: `${id}-${owner}`,
          ownerId: owner,
          category,
          title,
          body: bodyText,
          keywords,
          active: 1,
        });
      }
      res.json({ profile, user: publicUser(req.user) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/orders', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Silakan masuk dulu.' });
    res.json({ orders: store.listOrders(db, req.user.id) });
  });

  app.patch('/api/orders/:id', express.json({ limit: '16kb' }), (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Silakan masuk dulu.' });
    try {
      const saved = store.updateOrderStatus(
        db,
        req.user.id,
        req.params.id,
        req.body?.status,
      );
      if (!saved) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
      res.json({ saved, orders: store.listOrders(db, req.user.id) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  const startOAuth = (provider) => (req, res) => {
    const conf = config.auth;
    const id = provider === 'google' ? conf.googleId : conf.facebookId;
    if (!id || (provider === 'google' ? !conf.googleSecret : !conf.facebookSecret)) {
      return res.redirect(`/masuk?error=${provider}_belum_diatur`);
    }
    const state = crypto.randomBytes(16).toString('hex');
    const secure = String(conf.publicBaseUrl || '').startsWith('https') || req.secure;
    res.append('Set-Cookie', serializeCookie('oauth_state', state, { maxAge: 600, secure }));
    const redirect = `${originBase(req)}/auth/${provider}/callback`;
    const url =
      provider === 'google'
        ? `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
            client_id: id,
            redirect_uri: redirect,
            response_type: 'code',
            scope: 'openid email profile',
            state,
            prompt: 'select_account',
          })}`
        : `https://www.facebook.com/v19.0/dialog/oauth?${new URLSearchParams({
            client_id: id,
            redirect_uri: redirect,
            scope: 'email,public_profile',
            state,
          })}`;
    res.redirect(url);
  };

  app.get('/auth/google', startOAuth('google'));
  app.get('/auth/facebook', startOAuth('facebook'));

  const finishOAuth = (provider) => async (req, res) => {
    try {
      const state = req.cookies?.oauth_state;
      if (!state || state !== req.query.state) throw new Error('State OAuth tidak cocok.');
      const code = String(req.query.code || '');
      if (!code) throw new Error('Kode OAuth kosong.');
      const conf = config.auth;
      const redirect = `${originBase(req)}/auth/${provider}/callback`;
      let profile;

      if (provider === 'google') {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: conf.googleId,
            client_secret: conf.googleSecret,
            redirect_uri: redirect,
            grant_type: 'authorization_code',
          }),
        });
        if (!tokenRes.ok) throw new Error('Gagal menukar kode Google.');
        const token = await tokenRes.json();
        const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { Authorization: `Bearer ${token.access_token}` },
        });
        if (!infoRes.ok) throw new Error('Gagal mengambil profil Google.');
        const info = await infoRes.json();
        profile = {
          providerId: info.sub,
          email: info.email,
          name: info.name,
          avatar: info.picture,
        };
      } else {
        const tokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?${new URLSearchParams({
          client_id: conf.facebookId,
          client_secret: conf.facebookSecret,
          redirect_uri: redirect,
          code,
        })}`;
        const tokenRes = await fetch(tokenUrl);
        if (!tokenRes.ok) throw new Error('Gagal menukar kode Facebook.');
        const token = await tokenRes.json();
        const infoRes = await fetch(
          `https://graph.facebook.com/me?${new URLSearchParams({
            fields: 'id,name,email,picture',
            access_token: token.access_token,
          })}`,
        );
        if (!infoRes.ok) throw new Error('Gagal mengambil profil Facebook.');
        const info = await infoRes.json();
        profile = {
          providerId: info.id,
          email: info.email,
          name: info.name,
          avatar: info.picture?.data?.url,
        };
      }

      const user = upsertOAuthUser(db, { provider, ...profile });
      const token = createSession(db, user.id);
      sessionCookie(req, res, token);
      res.append('Set-Cookie', serializeCookie('oauth_state', '', { maxAge: 0 }));
      if (!user.terms_accepted) return res.redirect('/persetujuan');
      return res.redirect(store.getBusinessProfile(db, user.id) ? '/katalog' : '/profil-usaha');
    } catch (err) {
      res.redirect(`/masuk?error=${provider}_gagal`);
    }
  };

  app.get('/auth/google/callback', finishOAuth('google'));
  app.get('/auth/facebook/callback', finishOAuth('facebook'));

  app.use(
    ['/api/products', '/api/knowledge', '/api/business'],
    express.json({ limit: '8mb' }),
  );

  /* -------------------------------- katalog -------------------------------- */

  const ownerId = (req) => req.user?.id || 'demo';
  const waOwnerId = () => store.kvGet(db, 'wa_owner_id') || null;
  const phoneDigits = (value) => {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('62')) digits = '0' + digits.slice(2);
    return digits;
  };
  // Kalau nomor WhatsApp sama dengan kontak di salah satu profil usaha,
  // ikat otomatis supaya tidak salah akun saat ada beberapa akun login.
  const autoClaimByPhone = () => {
    if (waOwnerId()) return;
    const waNumber = phoneDigits(wa.snapshot().me?.number);
    if (waNumber.length < 9) return;
    const rows = db
      .prepare(
        "SELECT owner_id, contact FROM business_profiles WHERE contact IS NOT NULL AND TRIM(contact) != ''",
      )
      .all();
    const matches = rows.filter((row) => phoneDigits(row.contact) === waNumber);
    if (matches.length === 1) store.kvSet(db, 'wa_owner_id', matches[0].owner_id);
  };
  const ownsWhatsApp = (req) => {
    if (!req.user) return true;
    const owner = waOwnerId();
    return Boolean(owner) && owner === req.user.id;
  };
  const canReadChat = (req) => {
    if (!req.user) return true;
    return ownsWhatsApp(req);
  };

  app.get('/api/products', (req, res) => {
    if (!dashboardAllowed(req)) return res.status(403).json({ error: 'Silakan masuk terlebih dahulu.' });
    res.json({ products: products.listProducts(db, ownerId(req)) });
  });

  app.post('/api/products', (req, res) => {
    if (!dashboardAllowed(req)) return res.status(403).json({ error: 'Silakan masuk terlebih dahulu.' });
    try {
      const item = products.createProduct(db, { ownerId: ownerId(req), ...(req.body || {}) });
      res.json({ products: products.listProducts(db, ownerId(req)), saved: item });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/products/:id', (req, res) => {
    if (!dashboardAllowed(req)) return res.status(403).json({ error: 'Silakan masuk terlebih dahulu.' });
    try {
      const item = products.updateProduct(db, req.params.id, ownerId(req), req.body || {});
      res.json({ products: products.listProducts(db, ownerId(req)), saved: item });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/products/:id', (req, res) => {
    if (!dashboardAllowed(req)) return res.status(403).json({ error: 'Silakan masuk terlebih dahulu.' });
    const ok = products.deleteProduct(db, req.params.id, ownerId(req));
    if (!ok) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    res.json({ products: products.listProducts(db, ownerId(req)) });
  });

  app.use('/api', (req, res, next) => {
    if (adminAllowed(req)) return next();
    if (config.demo.enabled) {
      return res.status(403).json({ error: 'Butuh token admin untuk mengakses dashboard.' });
    }
    if (!isPrivateRemote(req)) {
      return res.status(403).json({ error: 'API hanya bisa diakses dari jaringan lokal.' });
    }
    next();
  });

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.use((req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    if (!req.is('application/json')) {
      return res.status(415).json({ error: 'Content-Type harus application/json.' });
    }
    const origin = req.get('origin');
    if (origin) {
      const expected = `${req.protocol}://${req.get('host')}`;
      if (origin !== expected) {
        return res.status(403).json({ error: 'Origin tidak diizinkan.' });
      }
    }
    next();
  });

  app.use('/api', (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    if (adminAllowed(req)) return next();
    if (config.demo.enabled) {
      return res.status(403).json({ error: 'Butuh token admin untuk mengubah data.' });
    }
    if (!isLocalRequest(req)) {
      return res.status(403).json({ error: 'Aksi hanya bisa dilakukan dari PC.' });
    }
    next();
  });

  const jsonParser = express.json({ limit: '30mb' });
  app.use((req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    return jsonParser(req, res, next);
  });

  app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'landing.html'));
  });

  app.use(express.static(publicDir, { dotfiles: 'deny' }));

  app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.get('/coba', (req, res) => {
    res.sendFile(path.join(publicDir, 'playground.html'));
  });
  app.get('/playground', (req, res) => {
    res.redirect(302, '/coba');
  });
  app.get('/masuk', (req, res) => {
    res.sendFile(path.join(publicDir, 'masuk.html'));
  });
  app.get('/daftar', (req, res) => {
    res.sendFile(path.join(publicDir, 'daftar.html'));
  });
  app.get('/katalog', (req, res) => {
    res.sendFile(path.join(publicDir, 'katalog.html'));
  });
  app.get('/persetujuan', (req, res) => {
    res.sendFile(path.join(publicDir, 'persetujuan.html'));
  });
  app.get('/profil-usaha', (req, res) => {
    res.sendFile(path.join(publicDir, 'profil-usaha.html'));
  });
  app.get('/pesanan', (req, res) => {
    res.sendFile(path.join(publicDir, 'pesanan.html'));
  });
  app.get('/playground.css', (req, res) => {
    res.type('text/css').sendFile(path.join(publicDir, 'playground.css'));
  });

  let eventClients = 0;
  const eventClientsByIp = new Map();

  /* ------------------------------- knowledge -------------------------------- */

  app.get('/api/knowledge', (req, res) => {
    if (!dashboardAllowed(req)) return res.status(403).json({ error: 'Silakan masuk terlebih dahulu.' });
    res.json({ knowledge: store.listKnowledge(db, { ownerId: ownerId(req) }) });
  });

  app.post('/api/knowledge', (req, res) => {
    if (!dashboardAllowed(req)) return res.status(403).json({ error: 'Silakan masuk terlebih dahulu.' });
    try {
      const row = store.upsertKnowledge(db, { ...(req.body || {}), ownerId: ownerId(req) });
      res.json({
        knowledge: store.listKnowledge(db, { ownerId: ownerId(req) }),
        saved: row,
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/knowledge/:id', (req, res) => {
    if (!dashboardAllowed(req)) return res.status(403).json({ error: 'Silakan masuk terlebih dahulu.' });
    const row = store.getKnowledge(db, req.params.id);
    if (!row || row.owner_id !== ownerId(req)) {
      return res.status(404).json({ error: 'Sumber tidak ditemukan.' });
    }
    store.deleteKnowledge(db, req.params.id);
    res.json({ knowledge: store.listKnowledge(db, { ownerId: ownerId(req) }) });
  });

  /* --------------------------------- status -------------------------------- */

  app.get('/api/status', (req, res) => {
    res.set('Cache-Control', 'no-store');
    autoClaimByPhone();
    const owner = waOwnerId();
    const claimed = Boolean(owner);
    const ownedByMe = !owner ? true : !req.user || owner === req.user.id;
    let snapshot = wa.snapshot();
    if (req.user && owner && owner !== req.user.id) {
      snapshot = { status: 'idle', qr: null, me: null, lastError: null, since: null };
    }
    snapshot.claimed = claimed;
    snapshot.ownedByMe = ownedByMe;
    if (!isLocalRequest(req)) {
      snapshot.qr = null;
      snapshot.me = null;
    }
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    const accountAi = req.user ? aiConfigForOwner(db, req.user.id) : null;
    res.json({
      wa: snapshot,
      paused: store.kvGet(db, 'paused') === '1',
      sentToday: ownedByMe ? store.countOutSince(db, day.getTime()) : 0,
      aiReady: req.user ? Boolean(accountAi) : Boolean(config.ai.apiKey),
      canWrite: isLocalRequest(req),
      config: {
        me: req.user?.name || config.me,
        model: accountAi?.model || config.ai.model,
        visionModel: accountAi?.visionModel || config.ai.visionModel || '',
        maxPerDay: config.safety.maxPerDay,
        maxPerHour: config.safety.maxPerHour,
        minGapPerContactSec: config.safety.minGapPerContactSec,
        quietHours: config.safety.quietHours,
        autoConfidenceMin: config.safety.autoConfidenceMin,
      },
      usage: store.aiUsageSummary(db),
      privacy: wa.statusPrivacy
        ? {
            mode: wa.statusPrivacy.mode ?? null,
            count: Array.isArray(wa.statusPrivacy.userJid) ? wa.statusPrivacy.userJid.length : 0,
          }
        : null,
    });
  });

  /* -------------------------------- settings ------------------------------- */

  app.get('/api/settings', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.user) {
      const info = aiInfoForOwner(db, req.user.id);
      return res.json({
        baseUrl: info.baseUrl || config.ai.baseUrl,
        model: info.model || config.ai.model,
        visionModel: info.visionModel || '',
        thinking: info.thinking || 'off',
        temperature: info.temperature,
        maxTokens: info.maxTokens,
        me: req.user.name,
        hasApiKey: info.configured,
        apiKeyMasked: info.apiKeyMasked,
        canEdit: true,
        account: true,
      });
    }
    const local = isLocalRequest(req);
    const data = getSettings();
    if (!local) {
      data.baseUrl = publicBaseUrl(data.baseUrl);
      delete data.apiKeyMasked;
    }
    res.json({ ...data, canEdit: local });
  });

  app.put('/api/settings', (req, res) => {
    if (req.user) {
      try {
        const body = req.body || {};
        const baseUrl = String(body.baseUrl || config.ai.baseUrl).trim();
        let parsed;
        try {
          parsed = new URL(baseUrl);
        } catch {
          return res.status(400).json({ error: 'Base URL tidak valid' });
        }
        if (!/^https?:$/.test(parsed.protocol)) {
          return res.status(400).json({ error: 'Base URL harus http atau https' });
        }
        const model = String(body.model || '').trim();
        if (!model) return res.status(400).json({ error: 'Model wajib diisi' });
        const visionModel = String(body.visionModel || '').trim();
        const thinking = ['off', 'on', 'auto'].includes(body.thinking) ? body.thinking : 'off';
        const temperature = Number(body.temperature ?? 0.8);
        if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
          return res.status(400).json({ error: 'Temperature harus antara 0 dan 2' });
        }
        const maxTokens = Math.round(Number(body.maxTokens ?? 2000));
        if (!Number.isFinite(maxTokens) || maxTokens < 1 || maxTokens > 8000) {
          return res.status(400).json({ error: 'Max token harus 1 sampai 8000' });
        }
        const existing = store.getAiSettings(db, req.user.id);
        const existingKey = existing?.api_key
          ? decryptSecret(existing.api_key, config.dataDir)
          : '';
        const inputKey = String(body.apiKey || '').trim();
        const apiKey = inputKey || existingKey;
        if (!apiKey) {
          return res.status(400).json({ error: 'API key wajib diisi untuk akun ini.' });
        }
        store.saveAiSettings(db, req.user.id, {
          baseUrl,
          apiKey: encryptSecret(apiKey, config.dataDir),
          model,
          visionModel,
          thinking,
          temperature,
          maxTokens,
        });
        const info = aiInfoForOwner(db, req.user.id);
        return res.json({
          baseUrl: info.baseUrl,
          model: info.model,
          visionModel: info.visionModel,
          thinking: info.thinking,
          temperature: info.temperature,
          maxTokens: info.maxTokens,
          me: req.user.name,
          hasApiKey: info.configured,
          apiKeyMasked: info.apiKeyMasked,
          canEdit: true,
          account: true,
        });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }
    if (!isLocalRequest(req)) {
      return res.status(403).json({ error: 'Pengaturan provider hanya bisa diubah dari PC.' });
    }
    try {
      const result = saveSettings(req.body || {});
      let host = '';
      try {
        host = new URL(result.baseUrl).host;
      } catch {
        host = '';
      }
      bus.emit('event', {
        type: 'log',
        message: `Provider AI diperbarui: ${result.model}${
          result.visionModel ? ` + ${result.visionModel}` : ''
        }${host ? ` Â· ${host}` : ''}`,
      });
      bus.emit('event', {
        type: 'settings',
        model: result.model,
        visionModel: result.visionModel,
        host,
      });
      res.json({ ...result, canEdit: true });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  app.post('/api/settings/test', async (req, res) => {
    let payload = req.body || {};
    if (req.user) {
      const info = aiInfoForOwner(db, req.user.id);
      const existing = store.getAiSettings(db, req.user.id);
      const existingKey = existing?.api_key
        ? decryptSecret(existing.api_key, config.dataDir)
        : '';
      payload = {
        ...payload,
        baseUrl: payload.baseUrl || info.baseUrl || config.ai.baseUrl,
        model: payload.model || info.model || config.ai.model,
        apiKey: payload.apiKey || existingKey,
      };
      if (!payload.apiKey) {
        return res.status(400).json({ ok: false, error: 'API key akun ini belum diatur.' });
      }
    } else if (!isLocalRequest(req)) {
      return res.status(403).json({ error: 'Tes provider hanya bisa dijalankan dari PC.' });
    }
    try {
      res.json(await testSettings(payload));
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, error: err.message, status: err.status || null });
    }
  });

  app.get('/api/usage', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(store.aiUsageSummary(db));
  });

  app.post('/api/pause', (req, res) => {
    store.kvSet(db, 'paused', req.body?.paused ? '1' : '0');
    res.json({ paused: store.kvGet(db, 'paused') === '1' });
  });

  // Klaim nomor WhatsApp yang sudah terhubung untuk akun yang sedang login.
  app.post('/api/wa/claim', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Silakan masuk dulu.' });
    const owner = waOwnerId();
    if (owner && owner !== req.user.id) {
      return res.status(409).json({ error: 'Nomor ini sudah dipakai akun lain.' });
    }
    if (wa.snapshot().status !== 'open') {
      return res.status(400).json({ error: 'WhatsApp belum terhubung.' });
    }
    store.kvSet(db, 'wa_owner_id', req.user.id);
    res.json({ ok: true, ownerId: req.user.id });
  });

  // Putuskan sesi WhatsApp lalu mulai bersih (QR baru).
  app.post('/api/wa/connect', async (req, res) => {
    const owner = waOwnerId();
    if (owner && req.user && owner !== req.user.id) {
      return res.status(409).json({ error: 'WhatsApp sudah terhubung ke akun lain.' });
    }
    if (req.user && !owner) store.kvSet(db, 'wa_owner_id', req.user.id);
    try {
      await wa.start();
      res.json({ ok: true, wa: wa.snapshot() });
    } catch (err) {
      res.status(500).json({ error: `Tidak bisa memulai WhatsApp: ${err.message}` });
    }
  });

  app.post('/api/wa/logout', async (req, res) => {
    const owner = waOwnerId();
    if (owner && req.user && owner !== req.user.id) {
      return res.status(403).json({ error: 'Hanya akun pemilik nomor yang bisa memutus WhatsApp.' });
    }
    try {
      if (req.user) store.kvSet(db, 'wa_owner_id', '');
      await wa.restartFresh();
      bus.emit('event', { type: 'log', message: 'Sesi WhatsApp diputus. Scan QR baru.' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /* -------------------------------- events --------------------------------- */

  app.get('/api/events', (req, res) => {
    const ip = String(req.socket.remoteAddress || 'unknown');
    const perIp = eventClientsByIp.get(ip) || 0;
    if (eventClients >= 40 || perIp >= 5) {
      return res.status(429).json({ error: 'Terlalu banyak koneksi live. Tutup tab lain dulu.' });
    }
    eventClients++;
    eventClientsByIp.set(ip, perIp + 1);

    let closed = false;
    let onEvent = null;
    let ping = null;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      eventClients = Math.max(0, eventClients - 1);
      const left = (eventClientsByIp.get(ip) || 1) - 1;
      if (left <= 0) eventClientsByIp.delete(ip);
      else eventClientsByIp.set(ip, left);
      if (ping) clearInterval(ping);
      if (onEvent) bus.off('event', onEvent);
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
    if (req.destroyed || res.destroyed) {
      cleanup();
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');

    const local = isLocalRequest(req);
    onEvent = (event) => {
      const safe = local ? event : redactEventForLan(event);
      res.write(`data: ${JSON.stringify(safe)}\n\n`);
    };
    bus.on('event', onEvent);
    ping = setInterval(() => res.write(': ping\n\n'), 25000);
  });

  /* -------------------------------- contacts ------------------------------- */

  app.get('/api/contacts', (req, res) => {
    if (!canReadChat(req)) return res.json([]);
    const rows = store.listContacts(db, String(req.query.q || ''));
    res.json(
      rows.map((c) => ({
        jid: c.jid,
        name: c.name || c.import_name || c.number || c.jid,
        number: c.number,
        mode: c.mode,
        register: c.register,
        language: c.language,
        sampleCount: c.sample_count,
        hasStyle: !!c.style_profile,
        relationship: c.relationship,
        lastSeenAt: c.last_seen_at,
      })),
    );
  });

  app.patch('/api/contacts/:jid', (req, res) => {
    const jid = req.params.jid;
    const { mode, name, register, language } = req.body || {};
    try {
      if (name && String(name).trim().length > 100) {
        return res.status(400).json({ error: 'Nama kontak maksimal 100 karakter' });
      }
      if (mode) store.setContactMode(db, jid, mode);
      if (register) store.setContactRegister(db, jid, register);
      if (language) store.setContactLanguage(db, jid, language);
      if (name) store.upsertContact(db, { jid, name });
      const c = store.getContact(db, jid);
      if (!c) return res.status(404).json({ error: 'Kontak tidak ditemukan' });
      res.json({ jid: c.jid, name: c.name, mode: c.mode, register: c.register, language: c.language });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  /* --------------------------------- drafts -------------------------------- */

  app.get('/api/drafts', (req, res) => {
    if (!canReadChat(req)) return res.json([]);
    const status = String(req.query.status || 'pending');
    if (!isLocalRequest(req) && status !== 'pending') {
      return res.status(403).json({ error: 'Riwayat draft hanya bisa dibaca dari PC.' });
    }
    res.json(store.listDrafts(db, status));
  });

  app.delete('/api/drafts', (req, res) => {
    const status = String(req.query.status || 'pending');
    if (status !== 'pending') {
      return res.status(400).json({ error: 'Hanya draft pending yang bisa dibersihkan.' });
    }
    const deleted = store.clearDrafts(db, status);
    bus.emit('event', { type: 'log', message: `${deleted} draft dibersihkan` });
    res.json({ ok: true, deleted });
  });

  app.patch('/api/drafts/:id', (req, res) => {
    const { reply } = req.body || {};
    if (String(reply ?? '').length > 4000) {
      return res.status(400).json({ error: 'Balasan maksimal 4000 karakter' });
    }
    const draft = store.getDraft(db, req.params.id);
    if (!draft) return res.status(404).json({ error: 'Draft tidak ditemukan' });
    res.json(store.updateDraft(db, draft.id, { reply: String(reply ?? '') }));
  });

  app.post('/api/drafts/:id/send', async (req, res) => {
    const draft = store.getDraft(db, req.params.id);
    if (!draft) return res.status(404).json({ error: 'Draft tidak ditemukan' });
    if (draft.status !== 'pending') return res.status(409).json({ error: 'Draft sudah diproses' });

    const text = String(req.body?.reply ?? draft.reply ?? '').trim();
    if (!text) return res.status(400).json({ error: 'Balasan kosong' });
    if (text.length > 4000) return res.status(400).json({ error: 'Balasan maksimal 4000 karakter' });

    // Klaim sebelum await: dua tab/retry tidak boleh mengirim draft yang sama.
    if (!store.claimDraft(db, draft.id)) {
      return res.status(409).json({ error: 'Draft sudah diproses' });
    }

    try {
      const sent = await wa.sendText(draft.jid, text);
      store.insertMessage(db, {
        id: sent?.key?.id || `manual_${Date.now()}`,
        jid: draft.jid,
        direction: 'out',
        body: text,
        ts: Date.now(),
        status: 'sent',
        reason: 'disetujui manual dari dashboard',
      });
      store.updateDraft(db, draft.id, { reply: text, status: 'sent', sent_at: Date.now() });
      bus.emit('event', { type: 'sent', jid: draft.jid, reply: text, manual: true });
      res.json({ ok: true });
    } catch (err) {
      store.updateDraft(db, draft.id, { status: 'pending' });
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/drafts/:id/discard', (req, res) => {
    const draft = store.getDraft(db, req.params.id);
    if (!draft) return res.status(404).json({ error: 'Draft tidak ditemukan' });
    store.updateDraft(db, draft.id, { status: 'discarded' });
    res.json({ ok: true });
  });

  app.post('/api/drafts/:id/regenerate', async (req, res) => {
    const draft = store.getDraft(db, req.params.id);
    if (!draft) return res.status(404).json({ error: 'Draft tidak ditemukan' });
    const contact = store.getContact(db, draft.jid);
    try {
      const result = await generateReply({
        meName: req.user?.name || config.me,
        contactName: contact?.name || String(draft.jid).split('@')[0],
        style: pickStyle(db, contact),
        relationship: contact?.relationship ?? null,
        examples: store.listExamples(db, draft.jid, config.style.fewShotCount),
        messages: store.recentMessages(db, draft.jid, config.style.historyTurns * 2),
      });
      const updated = store.updateDraft(db, draft.id, {
        reply: result.reply,
        confidence: result.confidence,
        reason: result.reason,
      });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /* --------------------------------- ingest -------------------------------- */

  // Simpan gambar base64 ke folder data.
  const saveImage = (dataUrl, dir, id) => {
    const m = /^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/.exec(String(dataUrl || ''));
    if (!m) return null;
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 8 * 1024 * 1024) throw new Error('Gambar maksimal 8 MB');
    fs.mkdirSync(dir, { recursive: true });
    const full = path.join(dir, id + '.' + ext);
    fs.writeFileSync(full, buf);
    return full;
  };

  // ------------------------------- aktivitas -------------------------------
  app.get('/api/activities', (req, res) => {
    if (!canReadChat(req)) return res.json({ active: null, list: [] });
    const active = store.getActiveActivity(db);
    res.json({
      active: publicActivity(active),
      list: store.listActivities(db, 20).map(publicActivity),
    });
  });

  app.post('/api/activities', (req, res) => {
    try {
      const text = String(req.body?.text || '').trim();
      if (!text) return res.status(400).json({ error: 'Teks aktivitas wajib diisi' });
      if (text.length > 1000) {
        return res.status(400).json({ error: 'Aktivitas maksimal 1000 karakter' });
      }
      const id = 'act_' + Date.now();
      let imagePath = null;
      if (req.body?.image) {
        imagePath = saveImage(req.body.image, path.resolve('data', 'activities'), id);
      }
      const hours = Number(req.body?.hours);
      const expiresAt = Number.isFinite(hours) && hours > 0
        ? Date.now() + hours * 3600 * 1000
        : (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); })();
      const activity = store.createActivity(db, { id, text, imagePath, expiresAt });
      bus.emit('event', { type: 'log', message: `Aktivitas diperbarui: ${text}` });
      res.json(publicActivity(activity));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/activities/:id/toggle', (req, res) => {
    const a = store.getActivity(db, req.params.id);
    if (!a) return res.status(404).json({ error: 'Aktivitas tidak ditemukan' });
    res.json(store.setActivityActive(db, a.id, !a.active));
  });

  app.delete('/api/activities/:id', (req, res) => {
    const a = store.getActivity(db, req.params.id);
    if (a?.image_path) { try { fs.unlinkSync(a.image_path); } catch {} }
    store.deleteActivity(db, req.params.id);
    res.json({ ok: true });
  });

  // ------------------------------ status jobs ------------------------------
  app.get('/api/status-jobs', (req, res) => {
    res.json(store.listStatusJobs(db, 60).map(publicStatusJob));
  });

  app.post('/api/status-jobs', (req, res) => {
    try {
      const scheduledAt = Number(req.body?.scheduledAt);
      if (!Number.isFinite(scheduledAt)) return res.status(400).json({ error: 'Jadwal tidak valid' });
      if (!req.body?.image) return res.status(400).json({ error: 'Gambar status wajib diupload' });

      const id = 'st_' + Date.now();
      const imagePath = saveImage(req.body.image, path.resolve('data', 'status'), id);
      if (!imagePath) return res.status(400).json({ error: 'Format gambar tidak dikenali' });

      const job = store.createStatusJob(db, {
        id,
        imagePath,
        caption: String(req.body?.caption || '').slice(0, 500),
        scheduledAt,
      });
      bus.emit('event', {
        type: 'log',
        message: `Status dijadwalkan: ${new Date(scheduledAt).toLocaleString('id-ID')}`,
      });
      res.json(publicStatusJob(job));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/status-jobs/:id', (req, res) => {
    const job = store.getStatusJob(db, req.params.id);
    if (job?.image_path) { try { fs.unlinkSync(job.image_path); } catch {} }
    db.prepare('DELETE FROM status_jobs WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/status-jobs/:id/revoke', async (req, res) => {
    const job = store.getStatusJob(db, req.params.id);
    if (!job) return res.status(404).json({ error: 'Status tidak ditemukan' });
    if (!job.wa_message_id) {
      return res.status(409).json({
        error:
          'Status ini tidak punya ID WhatsApp (diposting sebelum fitur tarik). Hapus manual di WhatsApp/WhatsApp Web; status akan expired dalam 24 jam.',
      });
    }
    let recipients = [];
    try {
      recipients = JSON.parse(job.wa_status_jids || '[]');
    } catch {}
    try {
      await wa.revokeStatus(job.wa_message_id, recipients);
      if (job.image_path) { try { fs.unlinkSync(job.image_path); } catch {} }
      db.prepare('DELETE FROM status_jobs WHERE id = ?').run(job.id);
      bus.emit('event', {
        type: 'log',
        message: `Status ditarik dari WhatsApp: ${job.caption || '(tanpa caption)'}`,
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/status-jobs/:id/post-now', async (req, res) => {
    const job = store.getStatusJob(db, req.params.id);
    if (!job) return res.status(404).json({ error: 'Status tidak ditemukan' });
    if (job.status !== 'pending') {
      return res.status(409).json({ error: 'Status ini sudah diproses.' });
    }
    try {
      const ok = await sendStatusJob({ db, wa, bus }, job);
      res.json({ ok, status: store.getStatusJob(db, job.id)?.status });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ------------------------------- test chat -------------------------------
  app.post('/api/test-reply', async (req, res) => {
    const jid = req.body?.jid;
    const message = String(req.body?.message || '').trim();
    if (!jid || !message) return res.status(400).json({ error: 'Kontak dan pesan wajib diisi' });
    if (message.length > 4000) {
      return res.status(400).json({ error: 'Pesan maksimal 4000 karakter' });
    }

    const contact = store.getContact(db, jid);
    if (!contact) return res.status(404).json({ error: 'Kontak tidak ditemukan' });

    try {
      const style = pickStyle(db, contact);
      const examples = store.listExamples(db, jid, config.style.fewShotCount);
      const history = store.recentMessages(db, jid, config.style.historyTurns * 2);
      const activity = store.getActiveActivity(db);
      const recentReplies = db
        .prepare(
          "SELECT body FROM messages WHERE jid = ? AND direction = 'out' AND body != '[stiker]' ORDER BY ts DESC LIMIT 8",
        )
        .all(jid)
        .map((r) => r.body);

      const result = await generateReply({
        meName: req.user?.name || config.me,
        contactName: contact.name,
        style,
        relationship: contact.relationship,
        examples,
        messages: [...history, { direction: 'in', body: message }],
        recentReplies,
        avoidPhrases: [],
        register: contact.register,
        alias: contact.alias,
        language: contact.language,
        maxBubbles: contact.burst || 3,
        memory: contact.memory,
        activity,
        usageKind: 'test',
      });

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

      res.json({
        reply: result.reply,
        confidence: result.confidence,
        reason: result.reason,
        bubbles: result.reply ? splitBubbles(result.reply, Math.random, contact.burst || 3) : [],
        sticker: result.sticker || null,
        attachActivity: !!result.attachActivity,
        activityText: activity?.text ?? null,
        decision,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Tambang kosakata baru dari chat yang tersimpan.
  app.post('/api/slang/expand', (req, res) => {
    try {
      const result = expandSlang(db);
      bus.emit('event', {
        type: 'log',
        message: `Kamus diperluas: ${result.total} kata baru`,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Langkah 0: buka file .zip hasil export WhatsApp
  app.post('/api/ingest/unzip', (req, res) => {
    const { file } = req.body || {};
    if (!file) return res.status(400).json({ error: 'File zip kosong' });

    try {
      const base64 = String(file).replace(/^data:[^,]*,/, '');
      const buf = Buffer.from(base64, 'base64');
      if (buf.length > 60 * 1024 * 1024) {
        return res.status(413).json({ error: 'Zip terlalu besar (maks 60 MB)' });
      }

      const zip = new AdmZip(buf);
      const entries = zip
        .getEntries()
        .filter((e) => !e.isDirectory && /\.txt$/i.test(e.entryName));

      if (!entries.length) {
        return res.status(400).json({ error: 'Tidak ada file .txt di dalam zip ini' });
      }

      const MAX_FILE = 20 * 1024 * 1024;
      const MAX_TOTAL = 50 * 1024 * 1024;
      let total = 0;
      for (const entry of entries) {
        const size = Number(entry.header?.size) || 0;
        const compressed = Number(entry.header?.compressedSize) || 0;
        if (size > MAX_FILE || compressed > MAX_FILE || total + size > MAX_TOTAL) {
          return res.status(413).json({
            error: 'Isi zip terlalu besar (maks 20 MB per file, 50 MB total).',
          });
        }
        total += size;
      }

      const files = [];
      for (const e of entries.slice(0, 60)) {
        const buf = e.getData();
        if (buf.length > MAX_FILE) {
          return res.status(413).json({ error: 'Isi zip terlalu besar setelah dibuka.' });
        }
        files.push({
          name: e.entryName.split('/').filter(Boolean).pop() || e.entryName,
          path: e.entryName,
          raw: buf.toString('utf8'),
        });
      }

      res.json({ files });
    } catch (err) {
      res.status(400).json({ error: `Zip tidak bisa dibaca: ${err.message}` });
    }
  });

  // Langkah 1: upload teks export -> daftar author
  app.post('/api/ingest/preview', (req, res) => {
    try {
      const { raw, meName } = req.body || {};
      if (String(raw || '').length > 20 * 1024 * 1024) {
        return res.status(413).json({ error: 'Teks export terlalu besar (maks 20 MB)' });
      }
      const parsed = parseExport(raw, { meName: meName || null });
      res.json({
        authors: parsed.authors,
        total: parsed.messages.length,
        detectedMe: parsed.detectedMe,
        firstTs: parsed.messages[0]?.ts ?? null,
        lastTs: parsed.messages.at(-1)?.ts ?? null,
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Langkah 2: pilih "aku" + kontak -> simpan profil
  app.post('/api/ingest', async (req, res) => {
    const { raw, meName, contactName, jid: explicitJid } = req.body || {};
    if (!raw || !meName) return res.status(400).json({ error: 'raw dan meName wajib diisi' });
    if (String(raw).length > 20 * 1024 * 1024) {
      return res.status(413).json({ error: 'Teks export terlalu besar (maks 20 MB)' });
    }

    try {
      const parsed = parseExport(raw, { meName });
      if (!parsed.authors.some((a) => a.name === meName)) {
        return res
          .status(400)
          .json({ error: `Nama "${meName}" tidak ada di export. Pilih dari daftar author.` });
      }

      const others = parsed.authors.filter((a) => a.name !== meName);
      if (!others.length) return res.status(400).json({ error: 'Tidak ada lawan bicara di export' });

      // Grup: tetap tidak pernah dibalas, tapi pesanmu di dalamnya
      // dipakai sebagai bahan latihan gaya ngetik.
      if (others.length > 1) {
        const groupName = contactName || others[0]?.name || 'grup';
        const myTexts = parsed.messages.filter((m) => m.author === meName).map((m) => m.text);

        if (myTexts.length === 0) {
          return res.status(400).json({
            error: `Grup "${groupName}": tidak ada pesanmu di file ini.`,
          });
        }

        const style = addGroupSamples(db, myTexts);
        bus.emit('event', {
          type: 'ingest',
          jid: 'group',
          contact: `${groupName} (grup)`,
          samples: myTexts.length,
        });

        return res.json({
          ok: true,
          group: true,
          contact: `${groupName} (grup)`,
          myMessages: myTexts.length,
          pairs: 0,
          style,
          relationship: null,
          reason: 'grup hanya dipakai untuk latihan gaya, tidak dibalas',
        });
      }

      const chosen = contactName
        ? others.find((a) => a.name === contactName)
        : others[0];
      if (!chosen) return res.status(400).json({ error: `Kontak "${contactName}" tidak ada di export` });

      const myTexts = parsed.messages.filter((m) => m.author === meName).map((m) => m.text);
      if (myTexts.length < 5) {
        return res.status(400).json({ error: 'Pesanmu di export terlalu sedikit (minimal 5).' });
      }

      const style = analyzeStyle(myTexts);
      const pairs = buildPairs(parsed.messages, meName);

      // Tentukan JID: dari pilihan user > nama yang pernah di-import > placeholder.
      let targetJid = explicitJid;
      if (!targetJid) {
        const existing = store.findContactByImportName(db, chosen.name);
        targetJid = existing?.jid ?? `name:${slug(chosen.name)}`;
      }

      // Jangan biarkan file yang lebih sedikit menimpa profil yang lebih lengkap.
      const current = store.getContact(db, targetJid);
      if (current && current.sample_count > myTexts.length && !req.body?.force) {
        return res.json({
          ok: true,
          skipped: true,
          jid: targetJid,
          contact: chosen.name,
          myMessages: myTexts.length,
          pairs: pairs.length,
          relationship: current.relationship,
          style: parseStyle(current.style_profile),
          reason: `profil lama lebih lengkap (${current.sample_count} pesan, file ini ${myTexts.length})`,
        });
      }

      store.upsertContact(db, {
        jid: targetJid,
        number: targetJid.endsWith('@s.whatsapp.net') ? targetJid.split('@')[0] : null,
        name: chosen.name,
        importName: chosen.name,
      });

      db.prepare('DELETE FROM examples WHERE jid = ?').run(targetJid);
      for (const p of pairs.slice(-400)) {
        store.addExample(db, { jid: targetJid, their: p.their, mine: p.mine, ts: p.ts });
      }

      let relationship = null;
      if (pairs.length >= 8) {
        try {
          relationship = await generateRelationship({
            meName,
            contactName: chosen.name,
            pairs,
          });
        } catch (err) {
          relationship = `(gagal membuat ringkasan: ${err.message})`;
        }
      }

      store.saveProfile(db, targetJid, {
        styleProfile: style,
        relationship,
        sampleCount: myTexts.length,
      });

      const seeded = seedHistory(db, targetJid, parsed.messages, meName, 200);

      const justSaved = store.getContact(db, targetJid);
      if (!justSaved?.register || justSaved.register === 'auto') {
        store.setContactRegister(db, targetJid, detectRegister(myTexts));
      }

      // Gaya global = sampel terbesar, dipakai untuk kontak tanpa data.
      const prevGlobal = parseStyle(store.kvGet(db, 'global_style'));
      if (!prevGlobal || myTexts.length >= (prevGlobal.sampleSize || 0)) {
        store.kvSet(db, 'global_style', JSON.stringify(style));
      }

      bus.emit('event', { type: 'ingest', jid: targetJid, contact: chosen.name, samples: myTexts.length });

      res.json({
        ok: true,
        jid: targetJid,
        contact: chosen.name,
        myMessages: myTexts.length,
        pairs: pairs.length,
        seeded,
        style,
        relationship,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Tarik riwayat chat tertentu dari HP (tanpa root / tanpa backup).
  app.post('/api/contacts/:jid/history', async (req, res) => {
    const jid = req.params.jid;
    if (!String(jid).endsWith('@s.whatsapp.net')) {
      return res.status(400).json({
        error: 'Kontak ini belum tersambung ke nomor WhatsApp. Tunggu dia kirim pesan dulu.',
      });
    }
    const count = Math.min(1000, Math.max(50, Number(req.body?.count) || 300));
    const oldest = db
      .prepare('SELECT id, ts, direction FROM messages WHERE jid = ? ORDER BY ts ASC LIMIT 1')
      .get(jid);

    const anchor = oldest
      ? {
          key: { remoteJid: jid, fromMe: oldest.direction === 'out', id: oldest.id },
          timestamp: Math.floor(oldest.ts / 1000),
        }
      : null;

    try {
      const requestId = await wa.requestHistory(jid, count, anchor);
      res.json({ ok: true, requestId, note: 'Riwayat masuk beberapa detik lagi lewat sinkronisasi.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Gabungkan kontak live dengan profil hasil import.
  app.post('/api/contacts/:jid/link', (req, res) => {
    const jid = req.params.jid;
    const query = String(req.body?.query || '').trim();
    const real = store.getContact(db, jid);
    if (!real) return res.status(404).json({ error: 'Kontak tidak ditemukan' });

    const imported = store
      .listContacts(db, query)
      .find((c) => c.jid.startsWith('name:'));
    if (!imported) return res.status(404).json({ error: `Profil import "${query}" tidak ditemukan` });
    if (imported.jid === jid) return res.status(400).json({ error: 'Kontak sama' });

    try {
      db.exec('BEGIN');
      db.prepare('DELETE FROM examples WHERE jid = ?').run(jid);
      db.prepare('UPDATE examples SET jid = ? WHERE jid = ?').run(jid, imported.jid);
      db.prepare(
        `UPDATE contacts SET
           style_profile = COALESCE(?, style_profile),
           relationship  = COALESCE(?, relationship),
           sample_count  = MAX(sample_count, ?),
           language      = CASE WHEN language = 'auto' THEN ? ELSE language END,
           register      = CASE WHEN register = 'auto' THEN ? ELSE register END,
           alias         = COALESCE(alias, ?),
           import_name   = COALESCE(import_name, ?),
           updated_at    = ?
         WHERE jid = ?`,
      ).run(
        imported.style_profile,
        imported.relationship,
        imported.sample_count,
        imported.language,
        imported.register,
        imported.alias,
        imported.import_name,
        Date.now(),
        jid,
      );
      db.prepare('DELETE FROM contacts WHERE jid = ?').run(imported.jid);
      db.exec('COMMIT');

      const merged = store.getContact(db, jid);
      bus.emit('event', {
        type: 'log',
        message: `${imported.name} digabung ke ${merged.name}`,
      });
      res.json({
        ok: true,
        jid,
        name: merged.name,
        samples: merged.sample_count,
        language: merged.language,
      });
    } catch (err) {
      db.exec('ROLLBACK');
      res.status(500).json({ error: err.message });
    }
  });

  /* --------------------------------- helper -------------------------------- */

  // Bangun ulang profil dari pesan yang sudah tersimpan (belajar sambil jalan).
  app.post('/api/contacts/:jid/rebuild', async (req, res) => {
    const jid = req.params.jid;
    if (!store.getContact(db, jid)) return res.status(404).json({ error: 'Kontak tidak ditemukan' });
    try {
      const result = await rebuildProfile(db, jid);
      if (!result.ok) return res.status(400).json({ error: result.reason });
      bus.emit('event', {
        type: 'ingest',
        jid,
        contact: store.getContact(db, jid)?.name,
        samples: result.samples,
        auto: false,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/contacts/:jid/context', (req, res) => {
    if (!isLocalRequest(req)) {
      return res.status(403).json({ error: 'Konteks chat hanya bisa dibaca dari PC.' });
    }
    const c = store.getContact(db, req.params.jid);
    if (!c) return res.status(404).json({ error: 'Kontak tidak ditemukan' });
    res.json({
      jid: c.jid,
      name: c.name,
      mode: c.mode,
      style: parseStyle(c.style_profile),
      relationship: c.relationship,
      sampleCount: c.sample_count,
      messages: store.recentMessages(db, c.jid, 30),
      examples: store.listExamples(db, c.jid, 8),
    });
  });

  // Jangan bocorkan stack/body parser ke client.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'JSON tidak valid.' });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Body terlalu besar.' });
    }
    console.error('Server error:', err?.message || err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  });

  return app;
}


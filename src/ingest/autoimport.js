/**
 * Import otomatis dari folder: taruh file .zip / .txt di sana,
 * aplikasi memprosesnya sendiri tanpa perlu buka dashboard.
 */
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { parseExport, buildPairs } from './parseExport.js';
import { analyzeStyle } from './style.js';
import { detectRegister } from './style.js';
import { addGroupSamples } from './groupStyle.js';
import { seedHistory } from './seed.js';
import { generateRelationship } from '../ai/prompt.js';
import { config } from '../config.js';
import * as store from '../db.js';

const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'kontak';

/** Tebak "aku": nama di .env, lalu "Anda"/"You", lalu pengirim terbanyak. */
function pickMe(authors, meName) {
  const norm = (s) => String(s).toLowerCase().trim();
  const byConfig = authors.find((a) => norm(a.name) === norm(meName));
  if (byConfig) return byConfig.name;
  const generic = authors.find((a) => ['anda', 'you', 'kamu'].includes(norm(a.name)));
  if (generic) return generic.name;
  return [...authors].sort((a, b) => b.count - a.count)[0]?.name;
}

export async function importDoc(db, { raw }) {
  const parsed = parseExport(raw, { meName: null });
  if (!parsed.messages.length) return { ok: false, reason: 'tidak ada pesan terbaca' };

  const me = pickMe(parsed.authors, config.me);
  const others = parsed.authors.filter((a) => a.name !== me);
  if (!others.length) return { ok: false, reason: 'tidak ada lawan bicara' };

  const contact = others[0].name;
  const myTexts = parsed.messages.filter((m) => m.author === me).map((m) => m.text);

  // Grup: bukan profil kontak, tapi bahan latihan gaya.
  if (others.length > 1) {
    if (myTexts.length === 0) {
      return { ok: false, reason: `grup "${contact}": tidak ada pesanmu` };
    }
    const style = addGroupSamples(db, myTexts);
    return {
      ok: true,
      group: true,
      contact: `${contact} (grup)`,
      samples: myTexts.length,
      pairs: 0,
      style,
    };
  }
  if (myTexts.length < 5) {
    return { ok: false, reason: `pesanmu cuma ${myTexts.length}, minimal 5` };
  }

  const style = analyzeStyle(myTexts);
  const pairs = buildPairs(parsed.messages, me);

  const existing = store.findContactByImportName(db, contact);
  const jid = existing?.jid ?? `name:${slug(contact)}`;

  // File yang lebih sedikit tidak boleh menimpa profil yang lebih lengkap.
  const current = store.getContact(db, jid);
  if (current && current.sample_count > myTexts.length) {
    return {
      ok: true,
      skipped: true,
      jid,
      contact,
      samples: myTexts.length,
      pairs: pairs.length,
      reason: `profil lama lebih lengkap (${current.sample_count} pesan)`,
    };
  }

  store.upsertContact(db, {
    jid,
    name: contact,
    importName: contact,
    number: jid.endsWith('@s.whatsapp.net') ? String(jid).split('@')[0] : null,
  });

  db.prepare('DELETE FROM examples WHERE jid = ?').run(jid);
  for (const p of pairs.slice(-400)) store.addExample(db, { jid, ...p });

  let relationship = null;
  if (pairs.length >= 8) {
    try {
      relationship = await generateRelationship({ meName: config.me, contactName: contact, pairs });
    } catch {
      /* ringkasan relasi opsional */
    }
  }

  store.saveProfile(db, jid, { styleProfile: style, relationship, sampleCount: myTexts.length });

  seedHistory(db, jid, parsed.messages, me, 200);

  const nowContact = store.getContact(db, jid);
  if (!nowContact?.register || nowContact.register === 'auto') {
    store.setContactRegister(db, jid, detectRegister(myTexts));
  }

  const prevGlobal = (() => {
    try {
      return JSON.parse(store.kvGet(db, 'global_style'));
    } catch {
      return null;
    }
  })();
  if (!prevGlobal || myTexts.length >= (prevGlobal.sampleSize || 0)) {
    store.kvSet(db, 'global_style', JSON.stringify(style));
  }

  return { ok: true, jid, contact, samples: myTexts.length, pairs: pairs.length };
}

/** Proses satu file (zip berisi txt, atau txt langsung). */
export async function importFile(db, filePath) {
  const buf = fs.readFileSync(filePath);
  const results = [];

  if (/\.zip$/i.test(filePath)) {
    const zip = new AdmZip(buf);
    const txt = zip
      .getEntries()
      .filter((e) => !e.isDirectory && /\.txt$/i.test(e.entryName))
      .slice(0, 20);

    if (!txt.length) return [{ ok: false, reason: 'tidak ada .txt di dalam zip' }];

    const MAX_FILE = 20 * 1024 * 1024;
    const MAX_TOTAL = 50 * 1024 * 1024;
    let total = 0;
    for (const e of txt) {
      const size = Number(e.header?.size) || 0;
      const compressed = Number(e.header?.compressedSize) || 0;
      if (size > MAX_FILE || compressed > MAX_FILE || total + size > MAX_TOTAL) {
        return [{ ok: false, reason: 'isi zip terlalu besar (maks 20 MB per file, 50 MB total)' }];
      }
      total += size;
    }

    for (const e of txt) {
      const content = e.getData();
      if (content.length > MAX_FILE) {
        return [{ ok: false, reason: 'isi zip terlalu besar setelah dibuka' }];
      }
      results.push(await importDoc(db, { raw: content.toString('utf8') }));
    }
    return results;
  }

  return [await importDoc(db, { raw: buf.toString('utf8') })];
}

/** Pantau folder, impor file baru, lalu pindahkan ke subfolder "sudah". */
export function watchInbox({ db, bus, dir }) {
  const inbox = path.resolve(dir);
  const doneDir = path.join(inbox, 'sudah');
  fs.mkdirSync(doneDir, { recursive: true });

  let busy = false;

  async function scan() {
    if (busy) return;
    busy = true;
    try {
      const entries = fs.readdirSync(inbox, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!/\.(zip|txt)$/i.test(entry.name)) continue;

        const full = path.join(inbox, entry.name);
        try {
          const results = await importFile(db, full);
          for (const r of results) {
            bus.emit('event', {
              type: r.ok ? 'ingest' : 'error',
              jid: r.jid,
              contact: r.contact,
              samples: r.samples,
              message: r.ok
                ? undefined
                : `${entry.name}: ${r.reason}`,
            });
          }
          fs.renameSync(full, path.join(doneDir, entry.name));
          const ok = results.filter((r) => r.ok);
          console.log(
            `  ↳ ${entry.name}: ${
              ok.length ? ok.map((r) => `${r.contact} (${r.samples} pesan)`).join(', ') : 'ditolak'
            }`,
          );
        } catch (err) {
          bus.emit('event', { type: 'error', message: `${entry.name}: ${err.message}` });
          try {
            fs.renameSync(full, path.join(doneDir, entry.name));
          } catch {}
        }
      }
    } finally {
      busy = false;
    }
  }

  const timer = setInterval(scan, 4000);
  scan();
  return () => clearInterval(timer);
}

/**
 * Koleksi stiker.
 *
 * Stiker dikumpulkan otomatis dari chat pribadi (yang kamu kirim atau terima),
 * disimpan di folder `stickers/`, lalu sesekali dipakai bot untuk membalas.
 * Bisa juga kamu taruh file .webp sendiri di folder itu.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

const dir = () => path.resolve(config.stickers.dir);

const EXT = /\.(webp|png|jpe?g)$/i;

function ensureDir() {
  fs.mkdirSync(dir(), { recursive: true });
}

/** Simpan stiker baru (dedupe berdasarkan isi). Mengembalikan nama file. */
export function saveSticker(buffer, mimetype = 'image/webp') {
  if (!buffer?.length || buffer.length > 1.5 * 1024 * 1024) return null;
  ensureDir();

  const hash = crypto.createHash('md5').update(buffer).digest('hex').slice(0, 16);
  const ext = mimetype.includes('png') ? 'png' : mimetype.includes('jpeg') ? 'jpg' : 'webp';
  const name = `${hash}.${ext}`;
  const full = path.join(dir(), name);

  if (!fs.existsSync(full)) fs.writeFileSync(full, buffer);
  return name;
}

export function listStickers() {
  try {
    return fs.readdirSync(dir()).filter((f) => EXT.test(f));
  } catch {
    return [];
  }
}

export function pickSticker() {
  const files = listStickers();
  if (!files.length) return null;
  const file = files[Math.floor(Math.random() * files.length)];
  try {
    return { name: file, buffer: fs.readFileSync(path.join(dir(), file)) };
  } catch {
    return null;
  }
}

export function stickerCount() {
  return listStickers().length;
}

/**
 * Ubah stiker (webp, bisa animasi) jadi satu frame PNG supaya bisa "dilihat" AI.
 */
export async function stickerPreview(buffer) {
  const { spawn } = await import('node:child_process');
  const { createRequire } = await import('node:module');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const require = createRequire(import.meta.url);
  let ffmpegPath;
  try {
    ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
  } catch {
    return null;
  }

  // Lewat file sementara: decoding webp dari pipe tidak selalu berhasil.
  const tmp = path.join(os.tmpdir(), `wa-sticker-${Date.now()}-${Math.random().toString(36).slice(2)}.webp`);
  try {
    fs.writeFileSync(tmp, buffer);
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      tmp,
      '-vframes',
      '1',
      '-f',
      'image2pipe',
      '-vcodec',
      'png',
      'pipe:1',
    ]);

    const chunks = [];
    proc.stdout.on('data', (c) => chunks.push(c));
    proc.on('error', () => {
      try {
        fs.unlinkSync(tmp);
      } catch {}
      resolve(null);
    });
    proc.on('close', (code) => {
      try {
        fs.unlinkSync(tmp);
      } catch {}
      if (code !== 0 || !chunks.length) return resolve(null);
      resolve(Buffer.concat(chunks));
    });

    proc.stdin.end();
  });
}

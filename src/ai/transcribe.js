/**
 * Transkrip pesan suara.
 *
 * Dua jalur:
 *  1. Layanan online (kalau AI_TRANSCRIBE_URL + KEY diisi) - OpenAI/Groq, cepat.
 *  2. Whisper lokal (default) - onnxruntime + model HuggingFace, tanpa akun.
 *     Model ~150 MB diunduh sekali saat pesan suara pertama.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { config } from '../config.js';
import { redactSecrets } from './client.js';

const require = createRequire(import.meta.url);

const remoteReady = () => Boolean(config.ai.transcribeUrl && config.ai.transcribeKey);

export const transcribeReady = () => remoteReady() || config.ai.transcribeLocal;

/** Ubah audio apa pun (ogg/opus/m4a) jadi PCM float32 16 kHz mono. */
function toPcm(buffer) {
  return new Promise((resolve, reject) => {
    let ffmpegPath;
    try {
      ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    } catch {
      return reject(new Error('ffmpeg tidak tersedia di server ini'));
    }
    const proc = spawn(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-f',
      'f32le',
      'pipe:1',
    ]);

    const chunks = [];
    const errs = [];

    proc.stdout.on('data', (c) => chunks.push(c));
    proc.stderr.on('data', (c) => errs.push(c));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffmpeg gagal (${code}): ${Buffer.concat(errs).toString().slice(0, 200)}`));
      }
      const buf = Buffer.concat(chunks);
      // Copy supaya alignment Float32Array aman.
      const copy = new ArrayBuffer(buf.length);
      new Uint8Array(copy).set(buf);
      resolve(new Float32Array(copy));
    });

    proc.stdin.on('error', () => {});
    proc.stdin.end(buffer);
  });
}

let pipelinePromise = null;
function getPipeline() {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      return pipeline('automatic-speech-recognition', config.ai.transcribeModelLocal);
    })().catch((err) => {
      pipelinePromise = null;
      throw err;
    });
  }
  return pipelinePromise;
}

async function transcribeRemote(buffer, mimetype) {
  const ext = mimetype?.includes('mp4') ? 'm4a' : mimetype?.includes('mpeg') ? 'mp3' : 'ogg';
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimetype || 'audio/ogg' }), `audio.${ext}`);
  form.append('model', config.ai.transcribeModel);

  const res = await fetch(config.ai.transcribeUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.ai.transcribeKey}` },
    body: form,
    signal: AbortSignal.timeout(60000),
    redirect: 'error',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const safe = redactSecrets(text, config.ai.transcribeKey);
    throw new Error(`Transkrip gagal (HTTP ${res.status}): ${safe.slice(0, 200)}`);
  }

  const data = await res.json();
  return typeof data.text === 'string' ? data.text.trim() : null;
}

async function transcribeLocal(buffer) {
  const pcm = await toPcm(buffer);
  const asr = await getPipeline();
  const out = await asr(pcm, {
    language: 'indonesian',
    task: 'transcribe',
    chunk_length_s: 30,
  });
  const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out?.text;
  return typeof text === 'string' ? text.trim() : null;
}

export async function transcribeAudio(buffer, mimetype = 'audio/ogg') {
  if (!transcribeReady()) return null;
  if (remoteReady()) return transcribeRemote(buffer, mimetype);
  return transcribeLocal(buffer);
}

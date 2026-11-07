import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('dist/video-raw');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({
  executablePath: chrome,
  headless: false,
  args: ['--window-size=1920,1080', '--force-device-scale-factor=1'],
});
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
  locale: 'id-ID',
});
const page = await context.newPage();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const slide = (title, body, foot) => `<!doctype html><html><head><meta charset="utf-8"><style>
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700&family=Figtree:wght@400;600&display=swap');
body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#f4efe5;color:#221c17;font-family:Figtree,system-ui,sans-serif}
.box{max-width:1100px;padding:0 80px}
h1{font-family:Fraunces,Georgia,serif;font-size:96px;line-height:0.98;margin:0 0 24px;letter-spacing:-0.02em}
p{font-size:30px;line-height:1.45;color:#5f5347;margin:0 0 20px;max-width:28ch}
small{font-size:20px;color:#a94b25;font-weight:600}
.dot{width:64px;height:64px;border-radius:16px;background:#a94b25;color:#fff8ef;display:grid;place-items:center;font-family:Georgia,serif;font-size:38px;margin-bottom:32px}
</style></head><body><div class="box"><div class="dot">T</div><h1>${title}</h1><p>${body}</p><small>${foot}</small></div></body></html>`;

await page.setContent(slide('Tutur', 'Chat pelanggan dibalas seperti pemilik warung. Booking dan komplain ditahan untuk Anda.', 'Bali DigiFest 2026 · AI Web Innovation Challenge'));
await sleep(6500);

await page.goto('http://127.0.0.1:3211/', { waitUntil: 'networkidle' });
await sleep(2500);
await page.locator('.nav a[href="/coba"]').first().click();
await page.waitForLoadState('networkidle');
await sleep(1500);

await page.getByRole('button', { name: /Tanya harga \(EN\)/i }).click();
await page.waitForSelector('text=Data bisnis yang relevan', { timeout: 30000 }).catch(() => {});
await sleep(3500);

await page.getByRole('button', { name: /Booking meja/i }).click();
await page.waitForSelector('text=Butuh pemilik', { timeout: 30000 }).catch(() => {});
await sleep(4500);

await page.getByRole('button', { name: /Spam \/ promo/i }).click();
await page.waitForSelector('text=sengaja tidak dibalas', { timeout: 30000 }).catch(() => {});
await sleep(3000);

await page.setContent(slide('Balasan yang tahu batas.', '28 dari 28 pertanyaan uji benar. Nol harga karangan. Booking dan komplain selalu menjadi draft.', 'tuturku.biz.id · github.com/CheztaGenZ/WhatsApp-Auto-Reply'));
await sleep(6000);

const video = page.video();
await context.close();
await browser.close();
const file = await video.path();
console.log(file);

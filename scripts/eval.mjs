/**
 * Eval 20 pertanyaan: baseline (tanpa knowledge base) vs Tutur (grounded).
 * Jalankan: npm run eval  (butuh AI_API_KEY)
 */
import fs from 'node:fs';
import path from 'node:path';

process.env.DEMO_MODE = '1';
process.env.MY_NAME = process.env.MY_NAME || 'Sari';
process.env.AI_TIMEOUT_MS = process.env.AI_TIMEOUT_MS || '45000';

const { openDb, listKnowledge } = await import('../src/db.js');
const { seedDemo } = await import('../src/demo/seed.js');
const { searchKnowledge } = await import('../src/knowledge.js');
const { generateReply } = await import('../src/ai/prompt.js');
const { decide } = await import('../src/policy.js');
const { config } = await import('../src/config.js');

const dir = path.resolve('data-eval');
fs.rmSync(dir, { recursive: true, force: true });
const db = openDb(dir);
seedDemo({ db });
const rows = listKnowledge(db);
const questions = JSON.parse(fs.readFileSync(path.resolve('evals/questions.json'), 'utf8'));

const has = (text, words) => words.some((w) => String(text || '').toLowerCase().includes(String(w).toLowerCase()));
const hasAll = (text, words) => words.every((w) => String(text || '').toLowerCase().includes(String(w).toLowerCase()));

function judge(question, result, decision) {
  const exp = question.expect || {};
  const reply = result.reply || '';
  if (exp.mustInclude && !hasAll(reply, exp.mustInclude)) return false;
  if (exp.mustIncludeAny && !has(reply, exp.mustIncludeAny)) return false;
  if (exp.mustNotInclude && has(reply, exp.mustNotInclude)) return false;
  if (exp.refuseAny && !has(reply, exp.refuseAny)) return false;
  if (exp.needsOwner && result.needsOwner !== true) return false;
  if (exp.intent && result.intent !== exp.intent) return false;
  if (question.type === 'spam' && decision && decision.action !== 'ignore') return false;
  return true;
}

function looksHallucinatedPrice(question, reply) {
  if (question.type !== 'tidak_ada') return false;
  return /\d{2,3}[.,]?000/.test(String(reply || ''));
}

async function runOne(question, knowledge, extraHint) {
  const result = await generateReply({
    meName: 'Sari',
    contactName: 'Pelanggan',
    style: null,
    relationship: 'Calon pelanggan.',
    examples: [],
    messages: [{ direction: 'in', body: question.message, ts: Date.now() }],
    knowledge,
    extraHint,
  });
  const decision = decide({
    jid: 'eval@s.whatsapp.net',
    contact: { mode: 'auto' },
    counts: {},
    needsOwner: result.needsOwner,
    ownerReason: result.ownerReason,
    intent: result.intent,
  });
  return { result, decision };
}

async function runWithRetry(question, knowledge, extraHint) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await runOne(question, knowledge, extraHint);
    } catch (err) {
      lastErr = err;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

const report = [];
const failures = [];

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

await mapLimit(questions, 3, async (q) => {
  const kb = searchKnowledge(rows, q.message, 3);
  const [baselineSettled, groundedSettled] = await Promise.allSettled([
    runWithRetry(q, [], null),
    runWithRetry(q, kb, null),
  ]);

  const baseline =
    baselineSettled.status === 'fulfilled'
      ? baselineSettled.value
      : { result: { reply: null }, decision: null, ok: false, error: baselineSettled.reason?.message };
  if (baselineSettled.status === 'fulfilled') baseline.ok = judge(q, baseline.result, baseline.decision);

  const grounded =
    groundedSettled.status === 'fulfilled'
      ? groundedSettled.value
      : { result: { reply: null }, decision: null, ok: false, error: groundedSettled.reason?.message };
  if (groundedSettled.status === 'fulfilled') grounded.ok = judge(q, grounded.result, grounded.decision);

  const row = {
    id: q.id,
    type: q.type,
    baseline: Boolean(baseline.ok),
    grounded: Boolean(grounded.ok),
    hallucinated: looksHallucinatedPrice(q, grounded.result?.reply),
    sources: kb.map((k) => k.id),
    reply: grounded.result?.reply || '',
    error: grounded.error || null,
  };
  report.push(row);
  if (!row.grounded) failures.push({ ...row, message: q.message });
  console.log(
    `${q.id} ${q.type.padEnd(9)} baseline=${row.baseline ? 'PASS' : 'FAIL'} tutur=${row.grounded ? 'PASS' : 'FAIL'}`,
  );
});

report.sort((a, b) => a.id.localeCompare(b.id));
failures.sort((a, b) => a.id.localeCompare(b.id));

const types = ['fakta', 'tidak_ada', 'jebakan', 'booking', 'komplain', 'spam'];
const summary = types.map((type) => {
  const items = report.filter((r) => r.type === type);
  return {
    type,
    total: items.length,
    baseline: items.filter((r) => r.baseline).length,
    grounded: items.filter((r) => r.grounded).length,
    hallucinated: items.filter((r) => r.hallucinated).length,
  };
});

const total = report.length;
const basePass = report.filter((r) => r.baseline).length;
const groundedPass = report.filter((r) => r.grounded).length;
const hallucinations = report.filter((r) => r.hallucinated).length;

const lines = [
  '# Hasil Evaluasi Tutur',
  '',
  `Tanggal: ${new Date().toISOString().slice(0, 10)}`,
  `Model: ${config.ai.model}`,
  `Pertanyaan: ${total}`,
  '',
  '## Ringkasan per jenis',
  '',
  '| Jenis | Jumlah | Tanpa knowledge base | Dengan knowledge base | Harga mengarang |',
  '|---|---|---|---|---|',
  ...summary.map(
    (s) => `| ${s.type} | ${s.total} | ${s.baseline}/${s.total} | ${s.grounded}/${s.total} | ${s.hallucinated} |`,
  ),
  `| **Total** | **${total}** | **${basePass}/${total}** | **${groundedPass}/${total}** | **${hallucinations}** |`,
  '',
  '## Kegagalan pada mode grounded',
  '',
  failures.length
    ? failures
        .map((f) => `- \`${f.id}\` (${f.type}): "${f.message}" -> jawaban: "${f.reply}"${f.error ? ` (error: ${f.error})` : ''}`)
        .join('\n')
    : 'Tidak ada.',
  '',
  '## Catatan metode',
  '',
  '- Baseline memakai prompt dan model yang sama, hanya tanpa blok knowledge base.',
  '- Mode Tutur memakai retrieval top-3 dari knowledge base Sari Kitchen.',
  '- "Harga mengarang" dihitung bila jawaban memuat angka ribuan pada pertanyaan yang datanya tidak tersedia.',
  '- Jawaban dinilai otomatis dengan aturan kata kunci; bukan penilaian manusia.',
  '',
].join('\n');

fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync(path.resolve('docs/eval-results.md'), lines);
console.log('');
console.log(`Tutur: ${groundedPass}/${total} | baseline: ${basePass}/${total} | harga mengarang: ${hallucinations}`);
console.log('Detail: docs/eval-results.md');

db.close();
fs.rmSync(dir, { recursive: true, force: true });


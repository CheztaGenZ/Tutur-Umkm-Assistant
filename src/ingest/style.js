/**
 * Analisis gaya ngetik dari kumpulan pesan milik user.
 * Tujuannya bukan statistik cantik, tapi kalimat deskriptif yang
 * bisa langsung dibaca LLM sebagai instruksi persona.
 */

const STOPWORDS = new Set(
  `yang dan di ke dari untuk pada dengan ini itu aku kamu saya gue lo lu kita kami mereka dia ia
   ada tidak ga gak nggak enggak ya yah kah lah pun juga sudah udah belum blm akan mau bisa harus
   apa apakah siapa kapan dimana mana bagaimana gimana kenapa mengapa berapa banget bgt kalau kalo
   jadi jd tapi tp atau ato karena krn soalnya karna sama utk untuk dgn dg yg tuh nih sih dong deh
   aja aje doang cuma cmn lagi lg banget bngt sekali sangat amat paling lebih kurang banyak sedikit
   the and you are is to of it in for on that this i a`.split(/\s+/),
);

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

// Kata kasar khas pergaulan chat Indonesia.
export const CRUDE_RE =
  /\b(asu|asw|cok|jancok|jancuk|kontol|memek|matio|nolo|ngawur|babi|crot|gay|boti|bablas|ndasmu|jaran|pepek|tai)\b/i;

export const isCrude = (text) => CRUDE_RE.test(String(text || ''));

// Penanda bahasa Jawa yang cukup khas (bukan kata Indonesia umum).
export const JAVANESE_RE =
  /\b(opo|koe|kowe|piye|sesuk|dolan|wes|durung|arep|ngene|ngono|tenan|bablas|mangan|turu|muleh|mulih|ora|lha|ae|kuwi|iku|nang|iki|jancok|cok|wae|iso|mari|wingi|mengko|piro)\b/i;

/** Persentase pesan yang mengandung bahasa Jawa. */
export function javaneseRatio(texts) {
  const arr = (texts || []).filter(Boolean);
  if (!arr.length) return 0;
  return arr.filter((t) => JAVANESE_RE.test(t)).length / arr.length;
}

/** Tebak tingkat tutur dari sampel: sering umpat = teman dekat. */
export function detectRegister(texts) {
  const arr = (texts || []).filter(Boolean);
  if (!arr.length) return 'auto';
  const hits = arr.filter((t) => isCrude(t)).length;
  return hits / arr.length >= 0.05 ? 'temen_dekat' : 'temen';
}

// Kata yang muncul karena tautan/pesan sistem, bukan gaya bicara.
const NOISE_TOKENS = new Set(
  'http https www com net org id co gl wa me utm source medium campaign share docs google drive youtube instagram tiktok'.split(
    /\s+/,
  ),
);

// Leksikon chat Indonesia: tetap dikenali walau baru muncul sekali.
const SLANG_SET = new Set(
  `wkwk wkwkwk wkwk woy oi njir njay jir anjir asw asli parah gila gilak keren mantap
   bgt bgtt bngt banget bet bener bnr
   gpp gapapa gamasalah santai tenang
   otw otwya nyampe sampe
   jd jgn jngn blm belom udh udah dgn sm sblm
   gak ga nggak ngga engga kagak
   aja aje doang cuma cmn
   dong sih deh nih tuh mah lah kek kayak kaya
   gw gue gua lo lu luu wkwk
   mksh makasih thanks thx trims
   oke okey ok sip siap oce siapin
   kapan2 nanti2 besok2
   cuy ges bre bro bang kak min
   dm pms japri jap
   emg emang knp kenapa gmn gimana
   skrg sekarang td tadi bsok besok
   tq ty yoi yup yep nope
   hehe hehehe hmm hmmm hihi hh
   cuan rugi modal
   wibu mabar mager gabut baper
   tubir fomo anjay anying`.split(/\s+/).filter(Boolean),
);


const median = (nums) => {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(EMOJI_RE, ' ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t) && !NOISE_TOKENS.has(t));
}

export function analyzeStyle(myTexts) {
  const texts = myTexts.map((t) => String(t || '').trim()).filter(Boolean);
  const total = texts.length;
  if (total === 0) return null;

  const lengths = texts.map((t) => t.length);
  const emojiCounts = new Map();
  let emojiMsgs = 0;
  let lowercaseStart = 0;
  let lowercaseRatio = 0;
  let endsWithDot = 0;
  let endsWithPunct = 0;
  let hasExcl = 0;
  let hasQuestion = 0;
  let multiLine = 0;
  let elongated = 0;
  let javaneseMsgs = 0;

  const firstTokens = new Map();
  const tokens = new Map();

  for (const t of texts) {
    const len = t.length;
    if (len <= 16) lowercaseStart++;
    const letters = t.replace(/[^a-zA-Z]/g, '');
    const lower = letters.replace(/[A-Z]/g, '').length;
    if (letters.length) lowercaseRatio += lower / letters.length;

    if (/[.!?…]$/.test(t)) endsWithPunct++;
    if (/\.$/.test(t)) endsWithDot++;
    if (/!/.test(t)) hasExcl++;
    if (/\?/.test(t)) hasQuestion++;
    if (/\n/.test(t)) multiLine++;
    if (/(.)\1{2,}/i.test(t)) elongated++;
    if (JAVANESE_RE.test(t)) javaneseMsgs++;

    const emojis = t.match(EMOJI_RE) || [];
    if (emojis.length) {
      emojiMsgs++;
      for (const e of emojis) emojiCounts.set(e, (emojiCounts.get(e) || 0) + 1);
    }

    const first = t.split(/[\s,]+/)[0].toLowerCase().replace(/[^a-z]/g, '');
    if (first && first.length <= 12) firstTokens.set(first, (firstTokens.get(first) || 0) + 1);

    for (const tok of tokenize(t)) tokens.set(tok, (tokens.get(tok) || 0) + 1);
  }

  const topEmojis = [...emojiCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

  const topSlang = [...tokens.entries()]
    .filter(
      ([tok, n]) =>
        SLANG_SET.has(tok) || n >= 3 || (n >= 2 && /(..)\1/.test(tok)) || (n >= 2 && /\d/.test(tok)),
    )
    .map(([tok, n]) => [tok, n, n * (SLANG_SET.has(tok) ? 1.6 : 1)])
    .sort((a, b) => b[2] - a[2])
    .slice(0, 18)
    .map(([tok, n]) => [tok, n]);

  const topOpeners = [...firstTokens.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t]) => t);

  // Contoh representatif: pendek seperti gaya aslinya, bukan tautan.
  const shortOnes = texts.filter(
    (t) => t.length >= 4 && t.length <= 80 && !/^https?:\/\//i.test(t) && !/\shttps?:\/\//i.test(t),
  );
  const pool = shortOnes.length >= 8 ? shortOnes : texts.filter((t) => t.length <= 160);
  const examples = [...pool].sort(() => Math.random() - 0.5).slice(0, 10);

  const avgLen = Math.round(lengths.reduce((a, b) => a + b, 0) / total);
  const medLen = median(lengths);

  const notes = [];
  notes.push(
    `Rata-rata panjang pesan ${avgLen} karakter (median ${medLen}). ${
      medLen <= 12
        ? 'Balasan sangat pendek, biasanya 1-8 kata. Jangan pernah menulis paragraf.'
        : medLen <= 35
          ? 'Balasan pendek sampai sedang, umumnya 1-2 kalimat.'
          : 'Balasan cukup panjang, boleh 2-3 kalimat.'
    }`,
  );
  notes.push(
    `Huruf kecil dipakai ${pct(lowercaseRatio / total, 1)}% dari total huruf. ${
      lowercaseRatio / total > 0.9
        ? 'Selalu pakai huruf kecil, hampir tidak pernah kapital di awal kalimat.'
        : lowercaseRatio / total > 0.6
          ? 'Cenderung huruf kecil, kapital hanya untuk nama/tempat.'
          : 'Sering pakai huruf kapital normal.'
    }`,
  );
  notes.push(
    `Pesan yang diakhiri tanda baca cuma ${pct(endsWithPunct, total)}% (titik ${pct(
      endsWithDot,
      total,
    )}%). ${endsWithPunct / total < 0.25 ? 'Jangan menutup kalimat dengan titik.' : ''}`.trim(),
  );
  if (hasExcl / total > 0.1) notes.push(`Sering pakai tanda seru (${pct(hasExcl, total)}% pesan).`);
  if (hasQuestion / total > 0.1) notes.push(`Sering balik bertanya (${pct(hasQuestion, total)}% pesan).`);
  if (multiLine / total > 0.15) notes.push('Sering memecah balasan jadi beberapa baris.');
  notes.push(
    `${pct(emojiMsgs, total)}% pesan mengandung emoji. ${
      emojiMsgs / total > 0.4
        ? 'Emoji adalah bagian penting dari gaya bicara.'
        : emojiMsgs / total > 0.1
          ? 'Sesekali pakai emoji, tidak berlebihan.'
          : 'Hampir tidak pernah pakai emoji.'
    }`,
  );
  if (topEmojis.length)
    notes.push(`Emoji favorit: ${topEmojis.map(([e, n]) => `${e}(${n}x)`).join(' ')}.`);
  if (topSlang.length)
    notes.push(`Kosakata/singkatan khas: ${topSlang.map(([t, n]) => `${t}(${n}x)`).join(', ')}.`);

  // Frasa 2-3 kata yang sering muncul.
  const phraseCounts = new Map();
  for (const t of texts) {
    const words = t
      .toLowerCase()
      .replace(EMOJI_RE, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= words.length; i++) {
        const phrase = words.slice(i, i + n).join(' ');
        const parts = phrase.split(' ');
        if (parts.every((x) => STOPWORDS.has(x))) continue;
        if (parts.every((x) => x.length < 2)) continue;
        // Buang frasa dari tautan/pesan sistem.
        if (parts.some((x) => NOISE_TOKENS.has(x) || /https?|www|\.com/.test(x))) continue;
        phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1);
      }
    }
  }
  const topPhrases = [...phraseCounts.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([p]) => p);

  if (topPhrases.length)
    notes.push(`Frasa yang sering kamu pakai: ${topPhrases.map((p) => `"${p}"`).join(', ')}.`);
  if (elongated / total > 0.05)
    notes.push(
      `Sering memanjangkan huruf saat greget (${pct(
        elongated,
        total,
      )}% pesan): "idaaaa", "dancokkk". Pakai sesekali, jangan tiap balasan.`,
    );

  const jv = pct(javaneseMsgs, total);
  if (jv >= 40) {
    notes.push(
      `Bahasa dengan orang ini: Jawa ngoko (${jv}% pesan). Balas Jawa ngoko, jangan Indonesia formal.`,
    );
  } else if (jv >= 12) {
    notes.push(
      `Bahasa dengan orang ini campur Jawa-Indonesia (${jv}% pesan pakai Jawa). Ikuti campurannya.`,
    );
  } else {
    notes.push(
      `Bahasa dengan orang ini: Indonesia (cuma ${jv}% pesan pakai Jawa). JANGAN pakai bahasa Jawa - hindari kata opo, koe, cok, tenan.`,
    );
  }
  if (topOpeners.length) notes.push(`Kata pembuka yang sering dipakai: ${topOpeners.join(', ')}.`);

  return {
    sampleSize: total,
    stats: {
      avgLen,
      medLen,
      lowercasePct: Math.round((lowercaseRatio / total) * 100),
      endsWithPunctPct: pct(endsWithPunct, total),
      emojiMsgPct: pct(emojiMsgs, total),
      multiLinePct: pct(multiLine, total),
      javanesePct: pct(javaneseMsgs, total),
      topEmojis,
      topSlang,
      topOpeners,
    },
    notes,
    examples,
  };
}

import { config } from '../config.js';
import { chatJson } from './client.js';
import { formatKnowledgeBlock } from '../knowledge.js';
import { glossFor } from './slang.js';
import { loadSlangExtra } from './slangExtra.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_PATH = path.join(__dirname, '..', '..', 'profile.md');
const STICKER_CATALOG = path.join(__dirname, '..', '..', 'stickers', 'catalog.json');

let profileCache = { mtime: 0, text: '' };
let stickerCache = { mtime: 0, list: [] };

/** Baca profil dari profile.md, dibaca ulang kalau file berubah. */
function loadProfile() {
  try {
    const st = fs.statSync(PROFILE_PATH);
    if (st.mtimeMs !== profileCache.mtime) {
      profileCache = { mtime: st.mtimeMs, text: fs.readFileSync(PROFILE_PATH, 'utf8').trim() };
    }
    return profileCache.text;
  } catch {
    return '';
  }
}

const label = (direction) => (direction === 'out' ? 'AKU' : 'DIA');

function transcript(messages, meName, contactName) {
  const lastTs = messages.at(-1)?.ts ?? Date.now();
  return messages
    .map((m) => {
      const rawMins = Math.round((lastTs - m.ts) / 60000);
      const mins = Math.max(0, rawMins);
      const when = mins <= 0 ? 'baru' : mins < 60 ? `${mins}m lalu` : `${Math.round(mins / 60)}j lalu`;
      return `[${when}] ${m.direction === 'out' ? meName : contactName}: ${m.body}`;
    })
    .join('\n');
}

/** Baca daftar stiker + deskripsinya (catalog.json). */
function loadStickerList() {
  try {
    const st = fs.statSync(STICKER_CATALOG);
    if (st.mtimeMs !== stickerCache.mtime) {
      const raw = JSON.parse(fs.readFileSync(STICKER_CATALOG, 'utf8'));
      stickerCache = {
        mtime: st.mtimeMs,
        list: Object.entries(raw)
          .filter(([, v]) => v?.desc)
          .map(([file, v]) => ({ file, desc: v.desc })),
      };
    }
    return stickerCache.list;
  } catch {
    return [];
  }
}

function styleBlock(style) {
  if (!style) return 'Belum ada data gaya ngetik. Pakai bahasa Indonesia santai yang wajar dan pendek.';
  const notes = Array.isArray(style.notes) ? style.notes : [];
  const lines = [...notes];
  if (style.examples?.length) {
    lines.push(`Contoh pesan asli yang pernah aku kirim:\n${style.examples.map((e) => `- ${e}`).join('\n')}`);
  }
  return lines.join('\n');
}

function examplesBlock(examples, contactName, meName) {  if (!examples?.length) return 'Belum ada contoh percakapan dengan orang ini.';
  return examples
    .map((e) => `${contactName}: ${e.their}\n${meName}: ${e.mine}`)
    .join('\n---\n');
}

/**
 * System prompt inti. Tiga lapis konteks:
 *   1. persona (gaya ngetik user)
 *   2. relationship card (siapa lawan bicara)
 *   3. few-shot (pasangan chat asli)
 */
const INTENTS = ['tanya_fakta', 'pesanan', 'booking', 'komplain', 'obrolan', 'spam'];
const RISKY_INTENTS = new Set(['pesanan', 'booking', 'komplain']);

const COMPLAINT_RE = /\b(komplain|complaint|telat|terlambat|late|salah|wrong|dingin|cold|kecewa|refund|uang kembali|sakit|food poisoning)/i;
const BOOKING_RE = /\b(book|reserv|table|meja|seat|kursi untuk|datang \d+|alergi|allerg|nut|kacang|rombongan|group of)/i;
const ORDER_RE = /\b(mau pesan|pesan antar|pesan makanan|pesan minum|order|delivery|antar|gofood|take ?away|bungkus)/i;

/** Penjaga deterministik: model kecil sering salah label pesan berisiko. */
export function detectRiskyIntent(message) {
  const text = String(message || '');
  if (COMPLAINT_RE.test(text)) return 'komplain';
  if (BOOKING_RE.test(text)) return 'booking';
  if (ORDER_RE.test(text)) return 'pesanan';
  return null;
}

const ABSENCE_RE =
  /\b(tidak ada|ga ada|gak ada|nggak ada|enggak ada|belum ada|belum punya|belum bisa|tidak tersedia|tidak punya|bukan|habis|not available|don't have|do not have|we don't|no such)\b/i;
const DEFER_RE = /\b(cek dulu|cek ke pemilik|tanya pemilik|tanyakan ke pemilik|konfirmasi|hubungi pemilik)\b/i;

const ID_WORDS =
  /\b(kak|ada|tidak|nggak|gak|buka|tutup|enak|kita|aja|saja|bisa|harga|jam|dan|yang|untuk|dengan|nya|mau|pesan|meja|banyak|juga|sudah|belum)\b/i;
const EN_WORDS =
  /\b(the|we|have|yes|no|open|close|price|cost|available|is|are|our|you|your|food|table|today|tomorrow|vegan|pool|room|menu)\b/i;

function looksIndonesian(text) {
  return ID_WORDS.test(String(text || ''));
}
  /\b(tidak ada|ga ada|gak ada|nggak ada|belum ada|belum punya|tidak tersedia|tidak punya|habis|not available|don't have|do not have|we don't|no such)\b/i;

/** Aturan keselamatan yang tidak boleh bergantung pada kepatuhan model. */
export function applyIntentGuards({ intent, needsOwner, reply, sources = null }) {
  const safeIntent = normalizeIntent(intent);
  const risky = RISKY_INTENTS.has(safeIntent);
  const noSource = Array.isArray(sources) && safeIntent === 'tanya_fakta' && sources.length === 0;
  const absence = typeof reply === 'string' && ABSENCE_RE.test(reply);
  const deferred = typeof reply === 'string' && DEFER_RE.test(reply);
  const needsHuman = needsOwner === true || risky || noSource || absence || deferred;
  let ownerReason = '';
  if (noSource) ownerReason = 'Tidak ada sumber data bisnis yang dikutip untuk jawaban ini.';
  else if (absence) ownerReason = 'Balasan mengklaim sesuatu tidak tersedia. Pemilik perlu memastikan.';
  else if (deferred) ownerReason = 'Balasan berjanji mengecek ke pemilik. Pastikan sebelum dikirim.';
  return {
    intent: safeIntent,
    needsOwner: needsHuman,
    reply: safeIntent === 'spam' ? null : reply,
    ownerReason,
  };
}

/** Paksa intent ke daftar yang dikenal; default obrolan. */
export function normalizeIntent(value) {
  const raw = String(value || '').toLowerCase().trim();
  return INTENTS.includes(raw) ? raw : 'obrolan';
}

function normalizeSources(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim()).slice(0, 5);
}

function knowledgeSection(knowledge = []) {
  if (!knowledge.length) return '';
  return `
## SUMBER DATA BISNIS (SATU-SATUNYA SUMBER FAKTA)
Gunakan HANYA data di bawah untuk harga, jam, menu, lokasi, dan kebijakan.
Jika jawabannya tidak ada di sini: JANGAN mengarang. Balas bahwa kamu akan
cek ke pemilik, dan set confidence <= 0.4 serta needs_owner true.
Tulis id sumber yang kamu pakai di field "used_sources".

${formatKnowledgeBlock(knowledge)}
`;
}

const OUTPUT_CONTRACT = `Balas HANYA dengan JSON valid, tanpa markdown:{"reply": "teks balasan" atau null, "confidence": 0.0-1.0, "sticker": "nama file stiker" atau null, "attach_activity": true atau false, "reason": "alasan singkat dalam bahasa Indonesia", "intent": "tanya_fakta|pesanan|booking|komplain|obrolan|spam", "needs_owner": true atau false, "owner_reason": "kenapa perlu pemilik, singkat", "used_sources": ["id sumber yang dipakai"]}`;

/** Prompt khusus mode demo bisnis: bersih dari aturan personal, fokus fakta. */
function buildBusinessPrompt({
  meName,
  contactName,
  style,
  relationship,
  examples,
  knowledge,
  maxBubbles = 3,
  memory = null,
  activity = null,
  language = 'auto',
}) {
  const kbBlock = knowledgeSection(knowledge);
  const languageBlock =
    language === 'en'
      ? `\n## BAHASA: ENGLISH (WAJIB)\nBalas HANYA dalam bahasa Inggris. Jangan mencampur bahasa Indonesia, walaupun data bisnis atau contoh chat memakai bahasa Indonesia.`
      : language === 'id'
        ? `\n## BAHASA: INDONESIA (WAJIB)\nBalas HANYA dalam bahasa Indonesia santai. Jangan membalas dalam bahasa Inggris walaupun pelanggan memakai bahasa Inggris.`
        : `\n## BAHASA\nIkuti bahasa pesan terakhir pelanggan. Kalau dia menulis bahasa Inggris, balas bahasa Inggris. Kalau Indonesia, balas Indonesia.`;
  const activityBlock = activity?.text
    ? `\n## INFO HARI INI\n${activity.text}\n`
    : '';
  return `Kamu adalah ${meName}, pemilik ${config.demo.businessName} di Bali. Kamu membalas chat pelanggan di WhatsApp, seolah-olah kamu sendiri yang mengetik.

## ATURAN MUTLAK
1. Balas sebagai ${meName}, bukan sebagai asisten. JANGAN pernah mengaku AI.
2. Ikuti bahasa pelanggan: Indonesia atau Inggris. Santai, ramah, dan pendek (maksimal ${maxBubbles} baris, tiap baris maksimal 12 kata). Variasikan pembuka. Jangan mulai dengan sapaan di setiap balasan.
3. Fakta (harga, menu, jam, lokasi, kebijakan) HANYA dari SUMBER DATA BISNIS. JANGAN mengarang angka, jam, atau alamat.
4. Kalau faktanya tidak ada di sumber, jangan menebak. Bilang akan cek ke pemilik, confidence <= 0.4, needs_owner true.
5. Pesanan, booking, reservasi, komplain, alergi, permintaan khusus, atau urusan uang: WAJIB set needs_owner true, walaupun kamu tidak bisa menjawab atau balasanmu kosong. Jangan pernah mengonfirmasi ketersediaan, harga final, atau kompensasi.
6. Spam, promosi, tautan mencurigakan, atau pesan yang tidak relevan dengan warung: reply null dan intent WAJIB "spam".
7. Jangan menjanjikan hal yang tidak ada di sumber (diskon, ketersediaan meja, kompensasi, antar gratis).
8. Sapaan hangat boleh, tapi jangan bertele-tele dan jangan menawarkan banyak hal sekaligus.
9. Jawab inti pesan di kalimat pertama. Jangan mengulang pertanyaan pelanggan, jangan menjelaskan maksudnya, jangan merangkum.
10. DILARANG memakai frasa: "Ada yang bisa saya bantu", "Tentu", "Dengan senang hati", "Sebagai AI", "Saya adalah asisten", "Saya harap ini membantu", "Jangan ragu", "Mohon maaf atas ketidaknyamanan", "Terima kasih telah menghubungi", "Baik, saya mengerti", "Semoga membantu". DILARANG membuka dengan "Halo" atau "Hai" di setiap balasan.
11. Jangan memakai bullet, penomoran, tanda seru berlebihan, atau emoji kecuali gaya ngetik pemilik memang memakainya.
12. Berhenti setelah informasi atau pertanyaan yang perlu. Jangan menambah tawaran, ringkasan, atau kalimat penutup basa-basi.
${languageBlock}

## GAYA NGETIK ${meName.toUpperCase()}
${styleBlock(style)}

## SIAPA ${contactName.toUpperCase()}
${relationship || 'Calon pelanggan yang baru pertama chat.'}

## MEMORI OBROLAN
${memory || '(belum ada obrolan lama)'}
${examplesBlock(examples, contactName, meName)}
${activityBlock}${kbBlock}
## FORMAT OUTPUT
${OUTPUT_CONTRACT}

Arti confidence: seberapa yakin kamu bahwa fakta di balasan ini benar dan aman dikirim tanpa menunggu pemilik.`;
}

export function buildSystemPrompt({
  meName,
  contactName,
  style,
  relationship,
  examples,
  recentReplies = [],
  avoidPhrases = [],
  register = 'auto',
  crudeExamples = [],
  alias = null,
  language = 'auto',
  maxBubbles = 3,
  memory = null,
  activity = null,
  knowledge = [],
}) {
  if (config.demo.enabled || process.env.BUSINESS_MODE === '1') {
    return buildBusinessPrompt({
      meName,
      contactName,
      style,
      relationship,
      examples,
      knowledge,
      maxBubbles,
      memory,
      activity,
      language,
    });
  }
  const profile = loadProfile();

  const extraWords = loadSlangExtra();
  const extraBlock = extraWords.length
    ? `\nKosakata yang sering kamu pakai (anggap wajar, bukan typo): ${extraWords.slice(0, 120).join(', ')}.`
    : '';

  // Tingkatan: wajib_sopan | keluarga | temen | temen_dekat | temen_poll
  const level =
    register === 'kasar'
      ? 'temen_dekat'
      : register === 'sopan' || register === 'auto'
        ? 'temen'
        : register;
  const aliasLine = alias
    ? `\nNamanya biasanya kamu sebut "${alias}". Kadang pakai nama itu, kadang tidak usah disebut sama sekali.`
    : '';
  const langBlock =
    language === 'id'
      ? `\n## BAHASA: INDONESIA (WAJIB, MENANG ATAS ATURAN LAIN)\nBalas HANYA dalam bahasa Indonesia santai. Walaupun lawan bicara memakai bahasa Jawa, kamu TETAP jawab Indonesia. JANGAN pakai kata Jawa: opo, koe, kowe, cok, tenan, wes, ra, iki, nang, ae, piye, sesuk, dolan, piro, ngene.`
      : language === 'jv'
        ? `\n## BAHASA: JAWA NGOKO (WAJIB)\nBalas dalam bahasa Jawa ngoko, pendek.`
        : '';
  const kasarBlock =
    level === 'temen_dekat' || level === 'temen_poll'
      ? `\n## LEVEL: ${level === 'temen_poll' ? 'TEMAN DEKAT POLL' : 'TEMAN DEKAT'}
Orang ini sudah biasa saling umpat dan ngajak ribut. Boleh ngoko kasar, ejekan, dan ngawur. Jangan sopan, jangan menjelaskan, jangan menasihati.${
          crudeExamples.length
            ? `\nContoh cara ${meName} bercanda dengan orang ini:\n${crudeExamples
                .map((e) => `- ${e}`)
                .join('\n')}`
            : ''
        }\n\nCara becanda khas ${meName}: sering nyanyi potongan lagu, nyeletuk tidak nyambung, atau ngajak hal random. Contoh: "Karep ku to cok napo og ngatur weki" / "Hah? We koyok ai, we ai to?" / "Tak jak nyanyi sek kene" / "Jal ya, buatkan web Minimarket menurut mu" / "Aku crot nang koe". Tiru absurditasnya, bukan cuma kosakatanya.\n\nGuyonan kasar yang wajar di tongkrongan ini: ancaman hiperbolik ("tiwas tak antemi", "tak pateni mengko", "tak entod we", "tak ewe") dan guyon seksual kasar. Pakai sesekali saja, jangan tiap balasan, dan jangan pernah menulis adegan seksual eksplisit - cukup satu kalimat nyeletuk. Kalau teman menyebut "Intun" (ibumu), tanggapi jahil atau pura-pura tersinggung, jangan marah beneran.\n`
      : '';

  const familyBlock =
    level === 'keluarga'
      ? `\n## LEVEL: KELUARGA\nIni keluarga (orang tua, kakak, adik, kerabat). Pakai bahasa Indonesia sopan atau Jawa ngoko yang halus dan akrab. ATURAN MUTLAK:\n- JANGAN pernah pakai kata kasar/umpatan: cok, jancok, asu, matio, ngawur, kontol, memek, boti, tai, bablas.\n- Boleh akrab dan hangat, tapi tidak boleh mengumpat atau mengejek fisik.\n- Kalau dia bercanda kasar, tetap balas dengan sopan dan santai, jangan ikut kasar.\n`
      : '';

  const sopanBlock =
    level === 'wajib_sopan'
      ? `\n## LEVEL: WAJIB SOPAN\nOrang ini belum dikenal atau bukan kontakmu. Pakai bahasa Indonesia yang sopan dan ramah, TANPA kata kasar apa pun, TANPA bahasa Jawa kasar. Jangan akrab berlebihan, jangan menggoda, jangan memanggil "sayang".`
      : level === 'temen'
        ? `\n## LEVEL: TEMAN\nBahasa Jawa ngoko santai. Boleh kasar RINGAN saja: anjir, anj, jir, asw. JANGAN pakai cok, jancok, asu, kontol, memek, matio. Jangan mengejek fisik atau orientasi.\n`
        : '';
  const stickers = loadStickerList();
  const stickerBlock = stickers.length
    ? `\n## STIKER YANG BISA KAMU KIRIM\nKalau ada stiker yang benar-benar pas dengan konteks obrolan, tulis nama filenya di field "sticker". Maksimal satu, dan jangan sering. Kalau tidak ada yang cocok, null.\n${stickers
        .slice(0, 24)
        .map((s) => `- ${s.file} — ${s.desc}`)
        .join('\n')}\n`
    : '';

  const activityBlock = activity
    ? `
## AKTIVITAS TERKINI ${meName.toUpperCase()}
Sekarang: ${activity.text}${
        activity.expires_at
          ? ` (berlaku sampai ${new Date(activity.expires_at).toLocaleString('id-ID')})`
          : ''
      }. Kalau dia menanyakan kabar atau sedang apa, jawab sesuai ini. Kalau ada foto aktivitas, set "attach_activity": true.
`
    : '';

  const checkBlock = `
## SEBELUM MENJAWAB, CEK DULU
1. Siapa dia dan levelnya (wajib sopan / keluarga / teman / teman dekat)?
2. Ada kata slang atau typo? Artinya apa? (pakai kamus di bawah)
3. Ada nama orang yang disebut? Cocokkan dengan profil. "Intun" / "Intan" = ibumu.
4. Ada aktivitas terkini yang relevan dengan pertanyaannya?
5. Jangan mengulang kata dia, jangan pakai joke basi.
6. Baru tulis balasan singkat sesuai level dan bahasa.
`;

  const avoidParts = [];
  if (recentReplies.length) {
    avoidParts.push(
      `Balasan-balasan ini baru saja kamu pakai. JANGAN mengulang kalimat, frasa, atau pola yang sama:\n${recentReplies
        .map((r) => `- ${r}`)
        .join('\n')}`,
    );
  }
  if (avoidPhrases.length) {
    avoidParts.push(
      `Frasa berikut sudah terlalu sering kamu pakai. JANGAN dipakai lagi sama sekali:\n${avoidPhrases
        .map((p) => `- "${p}"`)
        .join('\n')}`,
    );
  }
  const avoid = avoidParts.length
    ? `\n## JANGAN DIULANG\n${avoidParts.join(
        '\n\n',
      )}\nSampaikan dengan cara lain. Kamu sedang chat, bukan memutar rekaman.\n`
    : '';

  return `Kamu adalah "tangan kedua" dari ${meName}. Tugasmu menulis balasan WhatsApp yang akan dikirim atas nama ${meName}, seolah-olah ${meName} sendiri yang mengetik.

## ATURAN MUTLAK
1. Balas sebagai ${meName}, bukan sebagai asisten. JANGAN pernah mengaku AI, jangan minta maaf berlebihan, jangan menjelaskan diri.
2. Tiru gaya ngetik di bawah ini PERSIS: panjang, huruf besar/kecil, tanda baca, emoji, singkatan. Kalau ${meName} biasanya jawab "otw" jangan jawab "Baik, saya akan segera menuju ke sana".
3. Kalau pesan tidak butuh jawaban (cuma "ok", "sip", "👍", stiker, info sepihak), kembalikan reply null. TAPI sapaan, ejekan akrab, candaan, dan basa-basi tetap dibalas singkat - itu bagian dari obrolan, bukan "tidak perlu jawaban".
4. JANGAN mengarang fakta: jadwal, harga, alamat, janji, nominal, nama orang, atau kesepakatan yang tidak ada di percakapan. Kalau butuh info itu, balas dengan bertanya balik secara natural dan turunkan confidence.
5. Topik sensitif — uang/utang, konflik, keluarga, kesehatan, urusan kerja serius, perasaan yang berat — set confidence di bawah 0.4 dan buat balasan se-netral mungkin (atau null). Manusia yang akan mengambil alih.
6. Jangan membahas hal yang tidak relevan, jangan menambahkan pertanyaan basa-basi yang tidak perlu.
7. Satu balasan saja, tanpa tanda kutip pembungkus, tanpa nama pengirim di depan.
8. Ikuti bahasa yang dipakai lawan bicara dan contoh chat di bawah. Kalau obrolannya bahasa Jawa, balas bahasa Jawa. Tingkat tuturnya harus cocok: ngoko/kasar hanya untuk teman sebaya; untuk orang tua, keluarga, atau orang yang lebih tua pakai krama/halus atau Indonesia sopan — walaupun contoh chat-nya campur kasar.
9. Jangan menerjemahkan istilah khas atau memaksakan bahasa campuran yang tidak ada di contoh.
10. Pesan masuk sering typo, singkatan, atau kata terpotong ("ra mudeng", "gpp", "otw", "bsk", "gmn"). Pahami maksudnya dari konteks. JANGAN mengoreksi ejaan, JANGAN minta klarifikasi hanya karena typo, dan balas dengan gaya singkatan yang sama.
11. Confidence mengukur: seberapa yakin ini balasan yang wajar dari ${meName} dan aman dikirim otomatis. Untuk obrolan santai yang tidak butuh fakta (sapaan, candaan, ejekan akrab, basa-basi), beri nilai 0.7-0.9 kalau nadanya sudah cocok. Turunkan hanya kalau butuh fakta yang tidak ada, topik sensitif, atau salah orang.
12. ${meName} biasanya mengetik pendek lalu memecah jadi beberapa bubble. Kalau balasanmu punya beberapa bagian, pisahkan dengan baris baru (maksimal ${maxBubbles} baris). Tiap baris maksimal 8 kata. JANGAN menulis satu kalimat panjang yang rapi dan lengkap.
13. Hindari gaya kaku: jangan pakai kata sambung formal, jangan merangkum, jangan menjelaskan, jangan menawarkan bantuan. Cukup reaksi spontan seperti orang yang sedang chat sambil rebahan.
14. Kalau dia mengirim STIKER, kamu bisa melihat gambarnya. Tanggapi isinya secara natural (ketawa, nyeletuk, ikut ngegas) - jangan mendeskripsikan stikernya seperti AI. Kalau memang pas, balas dengan stiker saja.
15. Jangan mengulang alasan/penutup yang sama di banyak balasan. Kalau topiknya sama, ubah sudutnya: kadang jahil, kadang singkat, kadang balik nanya. Jangan menutup setiap balasan dengan alasan yang sama (mis. "mau tidur") - itu terdengar seperti robot yang kehabisan ide. Jangan menyebut jam atau alasan ngantuk lebih dari sekali dalam 10 balasan terakhir.
16. Kalau yang dikirim adalah SCREENSHOT chat, jangan mengomentari bahwa itu screenshot ("screenshot chat e..."). Tanggapi isi obrolan di dalamnya, seolah dia bercerita.
17. PANJANG ITU PENTING. Balasan ideal 2-8 kata. Satu ide saja per balasan. Jangan menambahkan alasan, penjelasan, atau nasihat setelah lelucon - langsung berhenti. Contoh kepadatan yang benar: "matio elo", "asu we", "nolo", "opo cok", "wkwk asu". Kalau balasanmu lebih dari 8 kata, potong.
18. BECANDA: untuk teman sebaya, ejekan ringan itu wajar dan justru bikin akrab. Tiru kosakata ejekan yang memang muncul di contoh chat dengan orang itu - jangan pakai kata yang tidak pernah mereka pakai. JANGAN pakai ejekan ke orang tua, keluarga, orang lebih tua, atau orang yang belum akrab.
19. Jangan mengejek kondisi fisik atau orientasi seksual orang. Sindiran bapak/ibu hanya boleh untuk kontak kasar (lihat aturan 22), dan tidak boleh menyebut pekerjaan, alamat, atau data pribadi mereka.
20. Kamu boleh NGAWUR dan tidak nyambung - itu bagian dari gaya Chesta. Kadang jawabannya cuma nyanyi, bohong jelas, atau nyeletuk acak yang tidak ada hubungannya. Jangan selalu menjawab secara logis; orang asli juga tidak selalu logis.
21. Kalau obrolannya campur bahasa Inggris, boleh balas potongan Inggris pendek ("no money ju", "you smell like shit bro") atau huruf kapital sesekali. Jangan berlebihan dan jangan mengubah bahasa yang tidak dipakai lawan bicara.
22. Untuk kontak kasar: boleh nyindir bapak/ibu sebagai bahan becanda, TAPI tidak setiap balasan, dan jangan pernah menyebut nama asli orang tua, alamat, pekerjaan, atau hal pribadi mereka.
23. Kalau memanggil nama, kadang dipanjangkan hurufnya: "yo idaaaaa", "idaaa dancokkk", "ekoookkk". Jangan tiap balasan.
24. JANGAN pernah menjelaskan balasanmu sendiri. Jangan bilang "tak baleni", "maksudku", "aku jawab tadi", dan jangan minta klarifikasi saat digoda. Langsung tembak balik.
25. Kalau digoda soal ibumu atau keluarga, jangan mengoreksi faktanya. Balas jahil atau pura-pura tersinggung. Jangan menjelaskan siapa Intun.
32. "Intun" dan "Intan" adalah ibumu (panggilan dari Intan). Kalau ada yang menyebutnya, itu tentang ibumu - jangan bingung, jangan dikira nama orang lain, jangan dikira makanan.
26. Kalau ditanya apakah kamu gay ("koe gay?", "we gay to ches?"), jawab TEGAS bahwa kamu bukan gay. Jangan menuduh balik lawan bicaranya gay, jangan bilang "koe sing ngajak", jangan menggantung. Contoh: "ra, aku gak gay cok", "ora lah, koe iki".
27. Kamu paham singkatan game: "valo" = Valorant, "ml" = Mobile Legends, "hsr" = Honkai Star Rail, "dc" = Discord. Kamu main ketiganya. Jangan bingung atau balik nanya "game apa" kalau jelas konteksnya.
28. Kalau diajak mabar, VC, atau Discord-an, JANGAN langsung iyain. Jawab singkat seperti "ntar tak kabarin", "cek sik", atau "iso tapi tak cek sek". Keputusan akhir tetap di Chesta.
29. Kalau ada kata yang tidak kamu kenal atau typo, TEBAK dari kemiripan bunyi dan konteks. Contoh kamus: trimo = nerima, krungu = dengar, weruh = lihat, mudeng = paham, ngapusi = bohong, goroh = bohong, kesel = capek, mumet = pusing, ndang = cepat, muleh = pulang, sesuk = besok, mengko = nanti, piye = bagaimana, sopo = siapa. JANGAN pura-pura tidak paham, JANGAN mulai balasan dengan "opo cok" hanya karena katanya tidak baku. Kalau benar-benar tidak bisa ditebak, baru tanya balik santai dengan kata lain.
30. JANGAN menghidupkan lagi joke atau kalimat lama yang sudah lewat. Kalau bahan becanda itu sudah dipakai berjam-jam lalu atau topiknya sudah berganti, jangan dibawa lagi. Joke hanya relevan kalau dia menyinggung topiknya duluan. Lebih baik diam atau nyeletuk baru daripada mengulang bit basi.
31. JANGAN mengulang mentah-mentah kata yang dia tulis. Kalau dia cuma mengumpat ("intun kontol"), jangan dibalas "intun kontol opo". Tanggapi maksudnya: ketawa, balas jahil, atau nyeletuk lain. Balasan yang mengulang kata dia akan ditolak sistem.

## GAYA NGETIK ${meName.toUpperCase()}
${styleBlock(style)}
${extraBlock}

## SIAPA ${contactName.toUpperCase()}
${relationship || 'Belum dikenal. Bersikap wajar dan agak sopan, jangan terlalu akrab.'}${aliasLine}
${langBlock}
${kasarBlock}
${familyBlock}
${sopanBlock}
## PROFIL ${meName.toUpperCase()}
${profile || 'Tidak ada data profil.'}

Cara pakai profil: jawab kalau memang ditanya atau relevan dengan obrolan, pakai sudut pandang orang pertama. Jangan menyebutkan nama lengkap, alamat, atau kampus ke orang yang belum jelas siapa atau di chat yang terasa asing — cukup jawab umum ("di solo", "lagi kuliah"). Jangan mengarang detail di luar profil ini (jadwal kuliah, jurusan, nominal, dsb).

## MEMORI OBROLAN SEBELUMNYA
${memory || '(belum ada obrolan lama yang tercatat)'}

## CONTOH PERCAKAPAN ASLI (pelajari ritme dan pilihan katanya)
${examplesBlock(examples, contactName, meName)}
${avoid}
${activityBlock}
${stickerBlock}
${checkBlock}
${knowledgeSection(knowledge)}
## FORMAT OUTPUT
${OUTPUT_CONTRACT}

Arti confidence: seberapa yakin kamu bahwa ini persis yang akan diketik ${meName} dan aman dikirim otomatis.`;
}

export function buildUserPrompt({ messages, contactName, meName, now = new Date(), hasImage = false }) {
  const jam = now.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
  const catatan = hasImage
    ? '\n\nPesan terakhir menyertakan GAMBAR. Lihat isi gambarnya: kalau itu meme/SS/barang, tanggapi sesuai maksudnya. Jangan mendeskripsikan gambar seperti AI, balas seperti manusia yang baru lihat.'
    : '';

  const lastIn = [...messages].reverse().find((m) => m.direction === 'in');
  const gloss = lastIn ? glossFor(lastIn.body) : [];
  const glossLine = gloss.length
    ? `\nArti kata slang/typo di pesan terakhir: ${gloss.join('; ')}.`
    : '';
  return `Waktu sekarang: ${jam}

Ini percakapan yang SUDAH BERJALAN, bukan chat baru. Paling bawah adalah pesan terbaru.
${transcript(messages, meName, contactName)}

Tugasmu melanjutkan percakapan ini sebagai ${meName}:
- Rujuk hal yang barusan dibahas kalau relevan ("tadi", "itu", "yang tadi").
- Jangan mengulang pertanyaan yang sudah dijawab.
- Jangan mengganti topik tiba-tiba; ikuti arah obrolannya.
- Kalau dia melanjutkan becanda sebelumnya, sambung becandanya.
- Kalau ada jeda lama, boleh singgung ("baru balas").
Balas pesan terakhir saja. Ingat: JSON saja.${catatan}${glossLine}

Ingat juga: tidak semua harus dijawab logis. Kadang nyeletuk acak, nyanyi, atau ngajak hal random itu lebih mirip ${meName}. Jangan menolak semua ajakan dengan alasan yang sama terus-menerus.`;
}

/** Buat balasan. Mengembalikan { reply, confidence, reason }. */
export async function generateReply({
  meName,
  contactName,
  style,
  relationship,
  examples,
  messages,
  image = null,
  recentReplies = [],
  avoidPhrases = [],
  strictShort = false,
  register = 'auto',
  crudeExamples = [],
  alias = null,
  language = 'auto',
  maxBubbles = 3,
  memory = null,
  extraHint = null,
  activity = null,
  knowledge = [],
  usageKind = 'reply',
}) {
  const system = buildSystemPrompt({
    meName,
    contactName,
    style,
    relationship,
    examples,
    recentReplies,
    avoidPhrases,
    register,
    crudeExamples,
    alias,
    language,
    maxBubbles,
    memory,
    activity,
    knowledge,
  });
  const userText = buildUserPrompt({ messages, contactName, meName, hasImage: !!image });
  const hints = [];
  if (strictShort) {
    hints.push('PENTING: tulis MAKSIMAL 6 KATA, satu ide saja, tanpa penjelasan tambahan.');
  }
  if ((config.demo.enabled || process.env.BUSINESS_MODE === '1') && language === 'en') {
    hints.push('PENTING: balas HANYA dalam bahasa Inggris, walaupun data atau contoh memakai bahasa Indonesia.');
  }
  if ((config.demo.enabled || process.env.BUSINESS_MODE === '1') && language === 'id') {
    hints.push('PENTING: balas HANYA dalam bahasa Indonesia.');
  }
  if (extraHint) hints.push(extraHint);
  const finalUser = hints.length ? `${userText}\n\n${hints.join(' ')}` : userText;

  const userContent = image
    ? [
        { type: 'text', text: finalUser },
        { type: 'image_url', image_url: { url: image } },
      ]
    : finalUser;

  const out = await chatJson(
    [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    { temperature: config.ai.temperature, kind: usageKind },
  );

  const reply = typeof out.reply === 'string' ? out.reply.trim() : null;
  const confidence = Math.max(0, Math.min(1, Number(out.confidence) || 0));

  const clean = (s) => String(s || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim() || null;
  let finalReply = clean(reply);
  let finalConfidence = confidence;
  let finalReason = String(out.reason || '').slice(0, 200);

  // Jangan mengulang mentah-mentah kalimat dia (echo).
  const lastIn = [...messages].reverse().find((m) => m.direction === 'in');
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  if (finalReply && lastIn && norm(lastIn.body).length >= 6 && norm(finalReply).includes(norm(lastIn.body))) {
    try {
      const retryText = `${finalUser}\n\nJANGAN mengulang kata atau kalimat dia. Tanggapi maksudnya dengan kata-katamu sendiri.`;
      const retryContent = image
        ? [
            { type: 'text', text: retryText },
            { type: 'image_url', image_url: { url: image } },
          ]
        : retryText;
      const out2 = await chatJson(
        [
          { role: 'system', content: system },
          { role: 'user', content: retryContent },
        ],
        { temperature: config.ai.temperature, kind: usageKind },
      );
      const r2 = clean(out2.reply);
      if (r2) {
        finalReply = r2;
        finalConfidence = Math.max(0, Math.min(1, Number(out2.confidence) || finalConfidence));
        finalReason = String(out2.reason || finalReason).slice(0, 200);
      }
    } catch {
      /* pakai hasil pertama */
    }
  }

  let forceOwner = false;
  const businessMode = config.demo.enabled || process.env.BUSINESS_MODE === '1';
  if (businessMode && language === 'en' && finalReply && looksIndonesian(finalReply)) {
    try {
      const translated = await chatJson(
        [
          {
            role: 'system',
            content:
              'Terjemahkan balasan WhatsApp berikut ke bahasa Inggris yang natural dan singkat. Pertahankan harga, angka, dan fakta. Jangan terjemahkan "kak" secara literal; pakai "sorry" atau hilangkan. Jangan memakai em dash. Balas HANYA JSON: {"reply":"..."}',
          },
          { role: 'user', content: finalReply },
        ],
        { temperature: 0.2, kind: usageKind },
      );
      const r = typeof translated.reply === 'string' ? translated.reply.trim() : '';
      if (r && !looksIndonesian(r)) {
        finalReply = r;
      } else {
        forceOwner = true;
      }
    } catch {
      forceOwner = true;
    }
  }

  const knowledgeIds = new Set((knowledge || []).map((k) => k.id));
  if (businessMode && finalReply) {
    finalReply = finalReply.replace(/\s*[—–]\s*/g, ', ').replace(/\s+,/g, ',').trim();
  }
  const validSources = normalizeSources(out.used_sources).filter((id) => knowledgeIds.has(id));

  const guarded = applyIntentGuards({
    intent: out.intent,
    needsOwner: out.needs_owner === true || forceOwner,
    reply: finalReply,
    sources: validSources,
  });

  // Jaring pengaman: pesan booking/komplain tidak boleh lolos sebagai auto
  // hanya karena model kecil salah memberi label intent.
  const detected = guarded.intent === 'spam' ? null : detectRiskyIntent(lastIn?.body);
  const finalIntent = detected && !RISKY_INTENTS.has(guarded.intent) ? detected : guarded.intent;
  const finalGuarded = applyIntentGuards({
    intent: finalIntent,
    needsOwner: guarded.needsOwner || Boolean(detected),
    reply: guarded.reply,
    sources: validSources,
  });

  return {
    reply: finalGuarded.reply,
    confidence: finalConfidence,
    sticker: typeof out.sticker === 'string' ? out.sticker.trim() : null,
    attachActivity: out.attach_activity === true,
    reason: finalReason,
    intent: finalGuarded.intent,
    needsOwner: finalGuarded.needsOwner,
    ownerReason: finalGuarded.ownerReason || String(out.owner_reason || '').slice(0, 200),
    knowledgeUsed: validSources,
  };
}

/** Ringkas "siapa orang ini" dari riwayat chat. Dipakai sebagai relationship card. */
export async function generateRelationship({ meName, contactName, pairs }) {
  if (!pairs?.length) return null;

  const sample = pairs
    .slice(-60)
    .map((p) => `${contactName}: ${p.their}\n${meName}: ${p.mine}`)
    .join('\n---\n');

  const out = await chatJson(
    [
      {
        role: 'system',
        content: `Kamu menganalisis hubungan dua orang dari potongan chat WhatsApp.
Tulis ringkasan singkat dalam bahasa Indonesia, maksimal 80 kata, untuk dipakai sebagai konteks saat membalas chat.
Fokus pada: siapa ${contactName} bagi ${meName} (relasi & tingkat keakraban), cara mereka bicara satu sama lain, topik yang sering dibahas, dan hal yang harus dihindari.
Jangan mengarang di luar bukti chat. Jangan pakai poin-poin, tulis sebagai paragraf padat.
Balas JSON: {"relationship": "..."}`,
      },
      { role: 'user', content: sample },
    ],
    { temperature: 0.4, kind: 'relationship' },
  );

  return typeof out.relationship === 'string' ? out.relationship.trim().slice(0, 800) : null;
}

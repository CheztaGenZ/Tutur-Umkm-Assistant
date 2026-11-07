/**
 * Seed demo idempoten: persona Sari Kitchen, knowledge base, dan baseline metrik.
 * Tidak pernah menyentuh data pribadi pengguna.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from '../db.js';
import { parseExport, buildPairs } from '../ingest/parseExport.js';
import { analyzeStyle } from '../ingest/style.js';
import { seedHistory } from '../ingest/seed.js';
import { DEMO_PERSONAS } from './personas.js';
import { createProduct, listProducts } from '../products.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPORT_PATH = path.join(__dirname, 'sari-kitchen.txt');

const KNOWLEDGE = [
  {
    id: 'menu-vegan',
    category: 'menu',
    title: 'Nasi campur vegan',
    body: 'Nasi campur vegan Rp35.000, tersedia setiap hari, bisa tidak pedas.',
    keywords: 'vegan, vegetarian, nasi campur, harga, pedas, spicy, price',
  },
  {
    id: 'menu-ayam',
    category: 'menu',
    title: 'Ayam bakar',
    body: 'Ayam bakar Rp45.000, halal, bisa tidak pedas.',
    keywords: 'ayam, bakar, halal, harga, chicken, grilled, price',
  },
  {
    id: 'menu-minuman',
    category: 'menu',
    title: 'Minuman',
    body: 'Es kelapa Rp15.000, jus mangga Rp20.000, teh Rp8.000.',
    keywords: 'minum, drink, juice, jus, kelapa, coconut, teh, tea, harga, price',
  },
  {
    id: 'jam-buka',
    category: 'jam',
    title: 'Jam buka',
    body: 'Buka setiap hari 08.00-21.00 WITA.',
    keywords: 'jam, buka, tutup, open, close, hours, time, tutup jam berapa',
  },
  {
    id: 'lokasi',
    category: 'lokasi',
    title: 'Lokasi dan parkir',
    body: 'Jl. Raya Ubud, Gianyar, Bali. Ada parkir motor dan mobil, bukan parkir bus besar.',
    keywords: 'lokasi, alamat, dimana, address, location, parkir, parking, maps, ubud',
  },
  {
    id: 'reservasi',
    category: 'kebijakan',
    title: 'Reservasi',
    body: 'Reservasi maksimal 10 orang. Konfirmasi dilakukan pemilik, bukan otomatis.',
    keywords: 'reservasi, booking, book, meja, table, rombongan, group',
  },
  {
    id: 'antar',
    category: 'layanan',
    title: 'Antar dan delivery',
    body: 'Bisa lewat GoFood atau kurir sendiri untuk radius 5 km. Ongkir sesuai jarak.',
    keywords: 'antar, delivery, gofood, kurir, ongkir, order',
  },
  {
    id: 'pembayaran',
    category: 'kebijakan',
    title: 'Pembayaran',
    body: 'Menerima tunai, QRIS, dan transfer bank. Belum menerima kartu kredit.',
    keywords: 'bayar, payment, qris, tunai, cash, transfer, kartu, card',
  },
  {
    id: 'kapasitas',
    category: 'lokasi',
    title: 'Kapasitas tempat',
    body: 'Muat sekitar 24 orang. Tidak ada ruang privat.',
    keywords: 'kapasitas, muat, orang, seat, capacity, private',
  },
  {
    id: 'alergi',
    category: 'kebijakan',
    title: 'Alergi dan permintaan khusus',
    body: 'Bisa tanyakan bahan ke pemilik. Untuk alergi berat, pemilik yang mengonfirmasi.',
    keywords: 'alergi, allergy, nut, kacang, gluten, khusus, special',
  },
];

const STYLE_PROFILE = {
  notes: [
    'Pendek dan hangat, 2-8 kata per baris.',
    'Sering memakai "kak" untuk pelanggan.',
    'Tidak memakai tanda baca formal; huruf kecil dominan.',
    'Untuk pertanyaan yang butuh konfirmasi, bilang "aku cek dulu ya".',
  ],
};

export function seedDemo({ db, meName = 'Sari' } = {}) {
  const existing = DEMO_PERSONAS.filter(
    (p) => p.jid !== 'demo-unknown@s.whatsapp.net' && store.getContact(db, p.jid),
  );
  const alreadySeeded = existing.length >= 4;

  let contacts = 0;
  let examples = 0;
  let knowledge = 0;

  if (!alreadySeeded) {
    let parsed = { messages: [] };
    try {
      parsed = parseExport(fs.readFileSync(EXPORT_PATH, 'utf8'), { meName });
    } catch {
      parsed = { messages: [] };
    }
    const myTexts = parsed.messages.filter((m) => m.author === meName).map((m) => m.text);
    const style = myTexts.length ? analyzeStyle(myTexts) : STYLE_PROFILE;
    const pairs = parsed.messages.length ? buildPairs(parsed.messages, meName) : [];

    for (const persona of DEMO_PERSONAS) {
      if (persona.jid === 'demo-unknown@s.whatsapp.net') continue;
      store.upsertContact(db, {
        jid: persona.jid,
        number: persona.jid.replace(/@.*$/, ''),
        name: persona.name,
        importName: persona.name,
      });
      store.saveProfile(db, persona.jid, {
        styleProfile: style,
        relationship:
          persona.jid === 'demo-tourist@s.whatsapp.net'
            ? 'Turis asing yang bertanya dalam bahasa Inggris.'
            : persona.jid === 'demo-guest@s.whatsapp.net'
              ? 'Tamu homestay yang baru pertama menginap.'
              : persona.jid === 'demo-vip@s.whatsapp.net'
                ? 'Kontak VIP pemilik; jangan pernah dibalas otomatis.'
                : 'Pelanggan lokal yang sudah sering datang.',
        sampleCount: myTexts.length,
      });
      if (persona.mode) store.setContactMode(db, persona.jid, persona.mode);
      contacts += 1;
    }

    if (pairs.length) {
      const tourist = 'demo-tourist@s.whatsapp.net';
      for (const pair of pairs.slice(-12)) {
        store.addExample(db, {
          jid: tourist,
          their: pair.their,
          mine: pair.mine,
          ts: pair.ts,
        });
        examples += 1;
      }
      seedHistory(db, tourist, parsed.messages, meName, 60);
    }
  }

  const existingKnowledge = new Set(store.listKnowledge(db).map((k) => k.id));
  for (const item of KNOWLEDGE) {
    if (existingKnowledge.has(item.id)) continue;
    store.upsertKnowledge(db, item);
    knowledge += 1;
  }

  if (!store.getBusinessProfile(db, 'demo')) {
    store.upsertBusinessProfile(db, 'demo', {
      name: 'Sari Kitchen',
      category: 'Warung makan',
      location: 'Ubud, Gianyar, Bali',
      hours: 'Setiap hari 08.00-21.00',
      specialty: 'Nasi campur vegan, ayam bakar, es kelapa muda',
      contact: '0812 3456 7890',
      notes: 'Bisa antar radius 5 km. Menerima QRIS dan transfer bank.',
      payment_methods: 'Tunai, QRIS, Transfer bank',
      bank_info: 'BCA 1234567890 a/n Sari Kitchen',
      qris_image_path: '/qris-demo.png',
    });
  }

  let demoProducts = 0;
  if (!listProducts(db, 'demo').length) {
    const items = [
      {
        name: 'Nasi campur vegan',
        price: 35000,
        category: 'Makanan',
        description: 'Tersedia setiap hari, bisa tidak pedas.',
      },
      {
        name: 'Sate lilit ayam',
        price: 25000,
        category: 'Makanan',
        description: 'Lima tusuk, dibakar dengan bumbu khas Bali.',
      },
      {
        name: 'Es kelapa muda',
        price: 15000,
        category: 'Minuman',
        description: 'Kelapa muda segar, disajikan dingin.',
      },
    ];
    for (const item of items) {
      createProduct(db, { ownerId: 'demo', ...item });
      demoProducts += 1;
    }
  }

  return { contacts, knowledge, examples, products: demoProducts };
}

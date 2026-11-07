/** Persona dan skenario demo yang dipakai playground + seed. */

export const DEMO_BUSINESS = {
  name: 'Sari Kitchen',
  tagline: 'Warung vegan-friendly di Ubud',
  owner: 'Sari',
  location: 'Ubud, Gianyar, Bali',
};

export const DEMO_PERSONAS = [
  {
    jid: 'demo-tourist@s.whatsapp.net',
    name: 'Emma (turis Australia)',
    label: 'Turis asing',
    language: 'en',
    mode: 'auto',
  },
  {
    jid: 'demo-guest@s.whatsapp.net',
    name: 'Tamu homestay',
    label: 'Tamu baru',
    language: 'auto',
    mode: 'draft',
  },
  {
    jid: 'demo-local@s.whatsapp.net',
    name: 'Rina (pelanggan lokal)',
    label: 'Pelanggan lokal',
    language: 'id',
    mode: 'auto',
  },
  {
    jid: 'demo-unknown@s.whatsapp.net',
    name: 'Nomor baru',
    label: 'Nomor tak dikenal',
    language: 'auto',
    mode: null,
  },
  {
    jid: 'demo-vip@s.whatsapp.net',
    name: 'VIP (jangan dibalas)',
    label: 'Nomor VIP',
    language: 'auto',
    mode: 'ignore',
  },
];

export const DEMO_SCENARIOS = [
  {
    label: 'Tanya harga (EN)',
    personaJid: 'demo-tourist@s.whatsapp.net',
    message: 'Hi! Do you have vegan options? How much?',
  },
  {
    label: 'Booking meja',
    personaJid: 'demo-tourist@s.whatsapp.net',
    message: 'Can I book a table for 6 people tomorrow at 7pm? One friend has a nut allergy.',
  },
  {
    label: 'Tanya jam buka',
    personaJid: 'demo-local@s.whatsapp.net',
    message: 'Mbak buka sampai jam berapa?',
  },
  {
    label: 'Fakta tidak ada di data',
    personaJid: 'demo-local@s.whatsapp.net',
    message: 'Apakah ada kursi bayi dan bisa bayar pakai Bitcoin?',
  },
  {
    label: 'Komplain',
    personaJid: 'demo-guest@s.whatsapp.net',
    message: 'Kemarin pesanan saya telat satu jam, ini gimana?',
  },
  {
    label: 'Spam / promo',
    personaJid: 'demo-unknown@s.whatsapp.net',
    message: 'Promo slot gacor hari ini, klik link di bio!',
  },
];

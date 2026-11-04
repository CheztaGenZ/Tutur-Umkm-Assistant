# Konfigurasi

Semua konfigurasi dibaca dari `.env`. Mulai dari `.env.example`.

## AI

| Variabel | Default | Keterangan |
|---|---|---|
| `AI_BASE_URL` | DeepSeek | Base URL OpenAI-compatible |
| `AI_API_KEY` | kosong | API key provider |
| `AI_MODEL` | `deepseek-flash` | Model teks |
| `AI_VISION_MODEL` | kosong | Model gambar/video; kosong = ikut model teks |
| `AI_THINKING` | `off` | `off`, `on`, `auto` (auto untuk provider non-DeepSeek) |
| `AI_TEMPERATURE` | `1.0` | 0–2 |
| `AI_MAX_TOKENS` | `2000` | Batas output |
| `AI_TIMEOUT_MS` | `20000` | Timeout per percobaan |
| `AI_REASONING_EFFORT` | `low` | Untuk DeepSeek saat thinking on |

## Identitas & dashboard

| Variabel | Default | Keterangan |
|---|---|---|
| `MY_NAME` | `Aku` | Nama kamu di chat |
| `PORT` | `3000` | Port dashboard |
| `BIND_HOST` | `127.0.0.1` | `0.0.0.0` untuk LAN |
| `ALLOWED_HOSTS` | kosong | Hostname tambahan, pisahkan koma |
| `WA_DISABLED` | kosong | `1` untuk tes tanpa WhatsApp |

## Pagar anti-ban

| Variabel | Default | Keterangan |
|---|---|---|
| `MAX_MSGS_PER_DAY` | `40` | Kuota global per hari |
| `MAX_MSGS_PER_HOUR` | `20` | Kuota global per jam |
| `MIN_GAP_PER_CONTACT_SEC` | `10` | Jeda per kontak |
| `QUIET_HOURS` | `01:00-07:00` | Jam tenang, `off` untuk mati |
| `AUTO_CONFIDENCE_MIN` | `0.55` | Di bawah ini jadi draft |
| `VIP_NUMBERS` | kosong | Nomor yang tidak pernah dibalas |

## Chat & gaya

| Variabel | Default | Keterangan |
|---|---|---|
| `DEBOUNCE_MS` | `3500` | Gabung bubble yang berdekatan |
| `DEBOUNCE_MAX_WAIT_MS` | `15000` | Batas tunggu debounce |
| `FEWSHOT_COUNT` | `12` | Contoh chat di prompt |
| `HISTORY_TURNS` | `10` | Riwayat yang dikirim ke AI |

## Stiker

| Variabel | Default | Keterangan |
|---|---|---|
| `STICKER_ENABLED` | `true` | Aktifkan stiker |
| `STICKER_CHANCE` | `0.5` | Peluang kirim |
| `STICKER_COOLDOWN_MIN` | `30` | Jeda per kontak |
| `STICKER_EVERY` | `5` | Minimal pesan sejak stiker terakhir |

## Transkrip suara

| Variabel | Default | Keterangan |
|---|---|---|
| `AI_TRANSCRIBE_LOCAL` | `true` | Whisper lokal |
| `AI_TRANSCRIBE_MODEL_LOCAL` | `Xenova/whisper-base` | Model lokal |
| `AI_TRANSCRIBE_URL` | kosong | Endpoint transkrip online |
| `AI_TRANSCRIBE_KEY` | kosong | Key transkrip online |
| `AI_TRANSCRIBE_MODEL` | `whisper-1` | Model transkrip online |

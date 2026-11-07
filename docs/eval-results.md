# Hasil Evaluasi Tutur

Tanggal: 2026-11-07
Model: deepseek-chat
Pertanyaan: 20

## Ringkasan per jenis

| Jenis | Jumlah | Tanpa knowledge base | Dengan knowledge base | Harga mengarang |
|---|---|---|---|---|
| fakta | 12 | 3/12 | 12/12 | 0 |
| tidak_ada | 3 | 3/3 | 3/3 | 0 |
| jebakan | 1 | 1/1 | 1/1 | 0 |
| booking | 2 | 2/2 | 2/2 | 0 |
| komplain | 1 | 1/1 | 1/1 | 0 |
| spam | 1 | 1/1 | 1/1 | 0 |
| **Total** | **20** | **11/20** | **20/20** | **0** |

## Kegagalan pada mode grounded

Tidak ada.

## Catatan metode

- Baseline memakai prompt yang sama tanpa blok knowledge base, dengan instruksi menjawab dari pengetahuan umum.
- Mode Tutur memakai retrieval top-3 dari knowledge base Sari Kitchen.
- "Harga mengarang" dihitung bila jawaban memuat angka ribuan pada pertanyaan yang datanya tidak tersedia.
- Jawaban dinilai otomatis dengan aturan kata kunci; bukan penilaian manusia.

# Hasil Evaluasi Tutur

Tanggal: 2026-11-07
Model: deepseek-chat
Pertanyaan: 28

## Ringkasan per jenis

| Jenis | Jumlah | Tanpa knowledge base | Dengan knowledge base | Harga mengarang |
|---|---|---|---|---|
| fakta | 16 | 1/16 | 16/16 | 0 |
| tidak_ada | 6 | 6/6 | 6/6 | 0 |
| jebakan | 1 | 1/1 | 1/1 | 0 |
| booking | 3 | 3/3 | 3/3 | 0 |
| komplain | 1 | 1/1 | 1/1 | 0 |
| spam | 1 | 1/1 | 1/1 | 0 |
| **Total** | **28** | **13/28** | **28/28** | **0** |

## Kegagalan pada mode grounded

Tidak ada.

## Catatan metode

- Baseline memakai prompt dan model yang sama, hanya tanpa blok knowledge base.
- Mode Tutur memakai retrieval top-3 dari knowledge base Sari Kitchen.
- "Harga mengarang" dihitung bila jawaban memuat angka ribuan pada pertanyaan yang datanya tidak tersedia.
- Jawaban dinilai otomatis dengan aturan kata kunci; bukan penilaian manusia.

# Submission checklist - Tahap 1

Bali DigiFest 2026, AI Web Innovation Challenge

| Item | Status | Catatan |
|---|---|---|
| Proposal PDF sesuai format, maksimal 5 halaman isi | OK | `proposal/AIWIC2026_Tutur_Proposal.pdf`, 5 halaman termasuk cover |
| Masalah, target user, solusi dijelaskan | OK | Proposal bagian 1 sampai 3 |
| AI implementation dijelaskan: model, input-output, alasan | OK | Proposal bagian 4 dan `AI-TECHNOLOGY-DISCLOSURE.md` |
| MVP web bisa dibuka dan fungsi utama bekerja | Perlu deploy | Kode siap, lihat `docs/DEPLOY.md` |
| GitHub dapat diakses juri | Perlu push | Repo public: `CheztaGenZ/tutur` |
| README lengkap dan instruksi menjalankan | OK | `README.md` |
| `.env.example` tersedia, tanpa secret | OK | Tidak ada key asli |
| Deployment URL aktif | Belum | Isi setelah deploy |
| Akun demo jika perlu login | OK | Playground tanpa login, dashboard pakai token |
| Commit hash / tag submission dicatat | Belum | Tag setelah deploy dan data tim diisi |
| AI & Technology Disclosure lengkap | OK | `AI-TECHNOLOGY-DISCLOSURE.md` |
| Third-party resources dan pre-existing diungkap | OK | `PRE-EXISTING.md` |

## Setelah deploy

- [ ] Ganti `[URL DEPLOY]` di proposal dan README.
- [ ] Set `ALLOWED_HOSTS` ke domain publik.
- [ ] Uji enam skenario playground dari jaringan seluler.
- [ ] Restart service, pastikan data knowledge tetap ada.
- [ ] Buat tag `v1.0-submission` dan catat commit hash.
- [ ] Kirim link playground, repo, dan token dashboard melalui form panitia.


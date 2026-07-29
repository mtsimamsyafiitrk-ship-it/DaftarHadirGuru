# Jurnal Mengajar Guru

Aplikasi web (PWA) jurnal mengajar guru untuk madrasah — **Kurikulum Merdeka Kemenag berbasis KBC (Kurikulum Berbasis Cinta)** — dengan absensi siswa yang diisi oleh masing-masing guru mata pelajaran saat masuk kelas.

## Fitur

### 👨‍🏫 Guru
- **Isi jurnal mengajar** per pertemuan: tanggal, jam ke, rombel, mapel, materi/topik, tujuan pembelajaran (TP), kegiatan, metode/model, dan asesmen.
- **Integrasi Nilai Cinta (KBC)**: pilih nilai cinta yang diintegrasikan (Cinta Allah & Rasul-Nya, Cinta Ilmu, Cinta Diri & Sesama, Cinta Lingkungan, Cinta Tanah Air) beserta wujud penerapannya.
- **Absensi siswa** langsung di dalam jurnal: pilih rombel → daftar siswa muncul otomatis → tandai Hadir/Sakit/Izin/Alpa (default Hadir).
- **Riwayat jurnal** per bulan, bisa diedit/dihapus.
- **Rekap absensi** per rombel per bulan (khusus kelas yang diajar sendiri) + ekspor Excel.
- Ganti password sendiri.

### 🛡️ Admin
- **Kelola akun guru**: tambah/edit/hapus akun, atur mapel yang diampu, reset password.
- **Kelola data siswa** sederhana (Nama, Rombel, NISN): tambah manual atau **upload Excel** (template disediakan), hapus per siswa atau per rombel.
- **Monitor jurnal** semua guru per tanggal + ekspor jurnal sebulan ke Excel.
- **Rekap absensi** seluruh rombel + ekspor Excel.
- **Pengaturan**: identitas madrasah, tahun pelajaran/semester, daftar rombel, daftar mapel, akun admin.

## Teknologi
- HTML/CSS/JavaScript murni (tanpa build step) — bisa dihosting di GitHub Pages.
- **Firebase Firestore** sebagai basis data (koleksi berawalan `jm_`).
- PWA: bisa dipasang di HP (Android/iOS) dan desktop.
- SheetJS (dimuat lazy) untuk template/upload/ekspor Excel.

## Struktur Data Firestore

| Koleksi/Dokumen | Isi |
|---|---|
| `jm_config/admin` | `{username, pwHash}` |
| `jm_config/sekolah` | `{nama, tahunPelajaran, semester, rombel[], mapel[]}` |
| `jm_guru/{id}` | `{nama, nip, username, pwHash, mapel[]}` |
| `jm_siswa/{id}` | `{nama, rombel, nisn}` |
| `jm_jurnal/{id}` | jurnal + `absen{siswaId: H\|S\|I\|A}` + `rekap{H,S,I,A}` |

## Memulai

1. Buka aplikasi, pilih tab **Admin**, login dengan username `admin` dan password default `Madras0h!`.
2. Segera ganti username/password admin di menu **Setelan**.
3. Atur identitas madrasah, tahun pelajaran, daftar rombel, dan daftar mapel.
4. Tambahkan **akun guru** (password awal: `guru123` — minta guru menggantinya).
5. Upload **data siswa** dari Excel (kolom: Nama, Rombel, NISN) atau input manual.
6. Guru login dan mulai mengisi jurnal mengajar + absensi.

## Pengembangan Lokal

```bash
# cukup server statis, misalnya:
npx serve .
# atau
python3 -m http.server 8000
```

Lalu buka `http://localhost:8000`.

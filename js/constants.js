// ── CONSTANTS ──
// Data statis aplikasi Jurnal Mengajar Guru.

export const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

// Label hari, lookup by JS getDay()
export const DF = ["Ahad", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

export const TODAY = new Date();

// Password default admin saat pertama kali (belum ada dokumen jm_config/admin).
export const ADMIN_DEFAULT_PW = "Madras0h!";

// Password default akun guru baru / hasil reset oleh admin.
export const GURU_DEFAULT_PW = "guru123";

// ── KBC: Kurikulum Berbasis Cinta (Kemenag) ──
// Nilai-nilai cinta yang diintegrasikan dalam pembelajaran Kurikulum Merdeka madrasah.
export const KBC_VALUES = [
  { key: "allah",      label: "Cinta Allah & Rasul-Nya",  icon: "🕌" },
  { key: "ilmu",       label: "Cinta Ilmu",               icon: "📚" },
  { key: "diri",       label: "Cinta Diri & Sesama",      icon: "🤝" },
  { key: "lingkungan", label: "Cinta Lingkungan",         icon: "🌱" },
  { key: "tanahair",   label: "Cinta Tanah Air",          icon: "🇮🇩" },
];

// Metode/model pembelajaran (Kurikulum Merdeka).
export const METODE_LIST = [
  "Ceramah Interaktif", "Diskusi Kelompok", "Tanya Jawab", "Demonstrasi",
  "Praktik / Unjuk Kerja", "Problem Based Learning (PBL)",
  "Project Based Learning (PjBL)", "Discovery / Inquiry Learning",
  "Pembelajaran Berdiferensiasi", "Drill / Latihan", "Talaqqi / Hafalan", "Lainnya"
];

// Jenis asesmen.
export const ASESMEN_LIST = [
  "Tidak ada", "Asesmen Formatif", "Asesmen Sumatif",
  "Observasi", "Penugasan", "Praktik / Unjuk Kerja"
];

// Status kehadiran siswa.
export const ABSEN_STATUS = [
  { key: "H", label: "Hadir", color: "#5a9b86", bg: "#e8f4f0" },
  { key: "S", label: "Sakit", color: "#a8874d", bg: "#f5eedf" },
  { key: "I", label: "Izin",  color: "#5a8aaa", bg: "#e5eef5" },
  { key: "A", label: "Alpa",  color: "#a86870", bg: "#f5e8ea" },
];

export const ABSEN_MAP = Object.fromEntries(ABSEN_STATUS.map(s => [s.key, s]));

// Default pengaturan sekolah (bisa diubah admin di menu Pengaturan).
export const DEFAULT_SEKOLAH = {
  nama: "MTs Al Imam Asy-Syafi'i Tarakan",
  tahunPelajaran: "2026/2027",
  semester: "Ganjil",
  rombel: ["7A", "7B", "8A", "8B", "9A", "9B"],
  mapel: [
    "Al-Qur'an Hadis", "Akidah Akhlak", "Fikih", "Sejarah Kebudayaan Islam",
    "Bahasa Arab", "Pendidikan Pancasila", "Bahasa Indonesia", "Matematika",
    "IPA", "IPS", "Bahasa Inggris", "PJOK", "Informatika", "Seni Budaya"
  ],
};

// ── CONSTANTS ──
// Data statis: sesi, peran, warna, label bulan/hari, dan urutan kustom pengguna.

export const SESSIONS = [
  { key: "H1", label: "H1", desc: "Halaqah Subuh",            color: "#e8956d", icon: "🌅" },
  { key: "H2", label: "H2", desc: "Halaqah Dhuha",            color: "#e8a44a", icon: "☀️" },
  { key: "H3", label: "H3", desc: "Halaqah Dzuhur",           color: "#c4a46b", icon: "🌤️" },
  { key: "J1", label: "J1", desc: "Jam Pertama",              color: "#6ba8b8", icon: "📚" },
  { key: "J2", label: "J2", desc: "Jam Kedua",                color: "#7b8fc4", icon: "📖" },
  { key: "J3", label: "J3", desc: "Jam Ketiga",               color: "#9b8fc4", icon: "✏️" },
  { key: "J4", label: "J4", desc: "Jam Keempat",              color: "#b88fc4", icon: "🖊️" },
  { key: "S1", label: "S1", desc: "Halaqah Bahasa Arab Sore", color: "#7fb3a0", icon: "🌙" },
  { key: "S2", label: "S2", desc: "Halaqah Malam",            color: "#6ba8b8", icon: "⭐" },
];

export const ROLES = [
  "Pengajar", "Staf", "Operator", "Admin Halaqah",
  "Kepala Madrasah", "Bendahara",
  "Wakil Kepala Sekolah Kesiswaan",
  "Wakil Kepala Sekolah Hubungan Masyarakat",
  "Wakil Kepala Sekolah Sarana dan Prasarana",
  "Wakil Kepala Sekolah Kurikulum"
];

export const ROLE_COLOR_MAP = {
  "Pengajar":                                 "#5a9b86",
  "Staf":                                     "#4d8fa0",
  "Operator":                                 "#6b8fc4",
  "Admin Halaqah":                            "#7b6ea8",
  "Kepala Madrasah":                          "#a86870",
  "Bendahara":                                "#a8874d",
  "Wakil Kepala Sekolah Kesiswaan":           "#7a9b6e",
  "Wakil Kepala Sekolah Hubungan Masyarakat": "#9b7a6e",
  "Wakil Kepala Sekolah Sarana dan Prasarana":"#6e8a9b",
  "Wakil Kepala Sekolah Kurikulum":           "#9b6e8a"
};

export const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

// Label hari, lookup by JS getDay()
export const DS = ["Ahd", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
export const DF = ["Ahad", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

// Kalender 6 kolom, awal pekan Sabtu:
// col0=Sab(6), col1=Ahd(0), col2=Sen(1), col3=Sel(2), col4=Rab(3), col5=Kam(4)
export const CAL_COLS = ["Sab", "Ahd", "Sen", "Sel", "Rab", "Kam"];
export const CAL_JS   = [6, 0, 1, 2, 3, 4]; // JS getDay() per kolom

export const TODAY = new Date();

export const ADMIN_DEFAULT_PW = "Madras0h!";

// Kunci enkripsi ringan untuk simpan password admin.
// (Bukan enkripsi kriptografis, hanya obfuscation XOR + base64.)
export const PW_KEY = "AlImamAsySyafi";

// ── CUSTOM USER ORDER ──
// Urutan resmi sesuai daftar institusi.
// Setiap entri adalah array kata kunci (alias) yang akan dicocokkan dengan nama pengguna.
export const CUSTOM_ORDER = [
  ["HARMIN"],                                          // 1
  ["ADNAN ABDUL RASYID"],                              // 2
  ["RUDDY HERMANTO"],                                  // 3
  ["VIRGIAWAN ASMIR", "VIRGIAWAN"],                    // 4
  ["TASNIM"],                                          // 5
  ["RHENDY FAHRULLAH"],                                // 6
  ["IMAM HIDAYAT"],                                    // 7
  ["METRIC CISARUANDA"],                               // 8
  ["USMAN"],                                           // 9
  ["MUHAMMAD IHSAN FAUZY"],                            // 10
  ["MUHAMMAD IQBAL"],                                  // 11
  ["MUHAMMAD SYARIF"],                                 // 12
  ["MUHAMMAD INDERA ALFHANDY", "INDERA ALFHANDY"],     // 13
  ["ASMAN SUGANDHA PRATAMA", "ASMAN SUGANDHA"],        // 14
  ["NASRI JAYA"],                                      // 15
  ["FAJRIN TARIKA NUR MUHAMMAD", "FAJRIN NUR MUHAMMAD TARIKA", "FAJRIN NM", "FAJRIN"],// 16
  ["ASMIN SUGANDHI PRATAMA", "ASMIN SUGANDHI"],        // 17
  ["MUHAMMAD FAATHUR NURFATH", "FAATHUR NURFATH", "FAATHUR"],// 18
  ["MUHAMMAD IHSAN"],                                  // 19 - hati-hati urutan setelah IHSAN FAUZY
  ["MUHAMMAD SYUKUR"],                                 // 20
  ["MUHAMMAD KHAEZAR NAZARULLY", "KHAEZAR"],           // 21
];

// ── UTILS ──
// Fungsi murni (tanpa akses DOM, tanpa side effect global).
// Boleh di-import oleh modul mana saja.

import { SESSIONS, CAL_JS, CUSTOM_ORDER, PW_KEY } from "./constants.js";

// ── Urutan pengguna ──
// Cocokkan nama pengguna dengan daftar CUSTOM_ORDER.
// Mengembalikan indeks urutan (semakin kecil semakin atas),
// atau 9999 jika tidak ditemukan.
export function getOrderIndex(name) {
  const upper = name.toUpperCase().trim();
  for (let i = 0; i < CUSTOM_ORDER.length; i++) {
    for (const kw of CUSTOM_ORDER[i]) {
      if (upper.includes(kw) || kw.split(' ').every(w => w.length > 2 && upper.includes(w))) {
        return i;
      }
    }
  }
  return 9999;
}

// ── Hash & Password ──

// SHA-256 hex untuk verifikasi password.
export async function hashPw(pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Obfuscation ringan (XOR + base64) untuk simpan password admin agar bisa ditampilkan kembali.
// CATATAN: ini BUKAN enkripsi kriptografis, hanya penyamaran agar tidak plaintext di Firestore.
export function encodePw(pw) {
  let r = '';
  for (let i = 0; i < pw.length; i++) {
    r += String.fromCharCode(pw.charCodeAt(i) ^ PW_KEY.charCodeAt(i % PW_KEY.length));
  }
  return btoa(unescape(encodeURIComponent(r)));
}

export function decodePw(enc) {
  try {
    const r = decodeURIComponent(escape(atob(enc)));
    let out = '';
    for (let i = 0; i < r.length; i++) {
      out += String.fromCharCode(r.charCodeAt(i) ^ PW_KEY.charCodeAt(i % PW_KEY.length));
    }
    return out;
  } catch (e) {
    return '••••••';
  }
}

// ── Kalender helpers ──

// Days In Month
export const dim = (y, m) => new Date(y, m + 1, 0).getDate();

// First-day offset: kolom kalender untuk tanggal 1.
// Kalender 6 kolom mulai dari Sabtu; jika tgl 1 jatuh di Jumat, skip baris (offset 0).
export const fd = (y, m) => {
  const js = new Date(y, m, 1).getDay();
  if (js === 5) {
    // Jika tgl 1 = Jumat, skip ke Sabtu berikutnya
    // tgl 1 Jumat tidak ditampilkan, tgl 2 Sabtu masuk kolom 0
    return 0;
  }
  const c = CAL_JS.indexOf(js);
  return c >= 0 ? c : 0;
};

// Week Of Month (d = tanggal, f = first-day offset)
export const wom = (d, f) => Math.ceil((d + f) / 7);

// Weeks In Month (jumlah baris kalender yang dibutuhkan bulan itu)
export const wim = (y, m) => Math.ceil((dim(y, m) + fd(y, m)) / 7);

// Date Key: format "YYYY-MM-DD"
export const dk = (y, m, d) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// ── Kehadiran helpers ──

// Objek kehadiran kosong (semua sesi false).
export const emptyDay = () => SESSIONS.reduce((a, s) => ({ ...a, [s.key]: false }), {});

// Hitung jumlah sesi yang hadir pada satu hari.
export const cntDay = (dd) => SESSIONS.filter(s => dd[s.key]).length;

// Skor hari: 2 poin per sesi hadir.
export const scDay = (dd) => cntDay(dd) * 2;

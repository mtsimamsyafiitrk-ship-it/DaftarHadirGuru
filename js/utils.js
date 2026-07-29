// ── UTILS ──
// Fungsi murni (tanpa akses DOM, tanpa side effect global).

// SHA-256 hex untuk verifikasi password.
export async function hashPw(pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ID acak untuk dokumen Firestore.
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Date Key: format "YYYY-MM-DD" (waktu lokal).
export function dk(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Escape HTML untuk mencegah injeksi saat render data pengguna.
export function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// "2026-07-29" → "Rabu, 29 Juli 2026"
import { MONTHS, DF } from "./constants.js";
export function fmtTanggal(key) {
  if (!key) return '-';
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DF[dt.getDay()]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

// Urut natural rombel: "7A" < "7B" < "8A" < "10A".
export function cmpRombel(a, b) {
  const na = parseInt(a), nb = parseInt(b);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return String(a).localeCompare(String(b), 'id');
}

// Urut nama siswa/guru (locale id).
export function cmpNama(a, b) {
  return String(a.nama).localeCompare(String(b.nama), 'id');
}

// Hitung rekap {H,S,I,A} dari objek absen {siswaId: status}.
export function hitungRekap(absen) {
  const r = { H: 0, S: 0, I: 0, A: 0 };
  for (const st of Object.values(absen || {})) if (r[st] !== undefined) r[st]++;
  return r;
}

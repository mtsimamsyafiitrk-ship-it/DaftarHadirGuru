// ── HARI LIBUR ──
// Kelola daftar tanggal libur (untuk blokir pengisian absensi pada hari tertentu).
//
// State internal:
//   - holidayDatesSet: Set<"YYYY-MM-DD">    daftar tanggal libur yang aktif
//   - _rincianDates: Array<"YYYY-MM-DD">    cache untuk rendering halaman rincian
//
// Kedua state di-encapsulate di dalam modul; akses dari luar melalui fungsi yang diekspos.

import { fs, doc, getDoc, setDoc } from "./firebase.js";
import { MONTHS, TODAY } from "./constants.js";
import { showLoading, hideLoading, showToast } from "./ui-helpers.js";

// ── State internal modul ──

let holidayDatesSet = new Set();
let _rincianDates = [];

// ── Firestore helpers ──

// Ambil daftar tanggal libur dari Firestore. Tidak mengubah state lokal.
export async function getHolidayDates() {
  const d = await getDoc(doc(fs, 'config', 'holidays'));
  return d.exists() ? (d.data().dates || []) : [];
}

// Tambah tanggal libur (akumulatif dengan yang sudah ada).
export async function saveHolidayDates(newDates) {
  const existing = await getHolidayDates();
  const merged = [...new Set([...existing, ...newDates])].sort();
  await setDoc(doc(fs, 'config', 'holidays'), { dates: merged });
  holidayDatesSet = new Set(merged);
}

// Muat daftar hari libur ke cache lokal. Panggil ini sekali setelah login
// (dan sebelum render kalender / pengecekan isHolidayDate).
export async function loadHolidayDates() {
  const dates = await getHolidayDates();
  holidayDatesSet = new Set(dates);
}

// ── Pengecekan ──

// Cek apakah (y, m 0-based, d) adalah hari libur.
export function isHolidayDate(y, m, d) {
  const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return holidayDatesSet.has(key);
}

// Cek berdasarkan key "YYYY-MM-DD" langsung (untuk kode yang sudah punya key).
export function isHolidayKey(dateKey) {
  return holidayDatesSet.has(dateKey);
}

// ── Halaman Rincian Hari Libur ──

export async function refreshRincianLibur() {
  document.getElementById('hr-loading').style.display = '';
  document.getElementById('hr-empty').style.display = 'none';
  document.getElementById('hr-list').style.display = 'none';
  document.getElementById('hr-summary').style.display = 'none';
  document.getElementById('hr-delete-wrap').style.display = 'none';

  try {
    _rincianDates = await getHolidayDates();
    // Isi dropdown tahun berdasarkan data yang ada + tahun sekarang
    const years = [...new Set(_rincianDates.map(d => d.substring(0, 4)))].sort().reverse();
    if (!years.includes(String(TODAY.getFullYear()))) years.unshift(String(TODAY.getFullYear()));
    const selYear = document.getElementById('hr-filter-year');
    const curVal = selYear.value;
    selYear.innerHTML = `<option value="-1">Semua Tahun</option>` +
      years.map(y => `<option value="${y}" ${y === String(TODAY.getFullYear()) ? 'selected' : ''}>${y}</option>`).join('');
    if (curVal && years.includes(curVal)) selYear.value = curVal;
    document.getElementById('hr-loading').style.display = 'none';
    renderRincianLibur();
  } catch (e) {
    document.getElementById('hr-loading').innerHTML =
      `<div style="color:var(--rose2);font-weight:700">❌ Gagal memuat: ${e.message}</div>`;
  }
}

export function renderRincianLibur() {
  const selYear = document.getElementById('hr-filter-year').value;
  const selMonth = document.getElementById('hr-filter-month').value;

  let filtered = _rincianDates.filter(d => {
    if (selYear !== '-1' && !d.startsWith(selYear)) return false;
    if (selMonth !== '-1') {
      const m = parseInt(d.substring(5, 7)) - 1;
      if (m !== parseInt(selMonth)) return false;
    }
    return true;
  });

  const summaryEl = document.getElementById('hr-summary');
  const countEl = document.getElementById('hr-summary-count');
  const labelEl = document.getElementById('hr-summary-label');
  const listEl = document.getElementById('hr-list');
  const emptyEl = document.getElementById('hr-empty');
  const deleteWrap = document.getElementById('hr-delete-wrap');

  if (filtered.length === 0) {
    summaryEl.style.display = 'none';
    listEl.style.display = 'none';
    emptyEl.style.display = '';
    deleteWrap.style.display = _rincianDates.length > 0 ? '' : 'none';
    return;
  }

  // Summary
  summaryEl.style.display = '';
  countEl.textContent = filtered.length + ' hari';
  const filterDesc = selYear === '-1'
    ? 'semua tahun'
    : (selMonth === '-1' ? `tahun ${selYear}` : `${MONTHS[parseInt(selMonth)]} ${selYear}`);
  labelEl.textContent = `Total hari libur — ${filterDesc}`;

  // Kelompokkan per bulan
  const byMonth = {};
  filtered.forEach(dateStr => {
    const key = dateStr.substring(0, 7); // "YYYY-MM"
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(dateStr);
  });

  const DF_FULL = ['Ahad', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  let html = '';
  Object.keys(byMonth).sort().reverse().forEach(monthKey => {
    const [y, m] = monthKey.split('-').map(Number);
    const mLabel = MONTHS[m - 1] + ' ' + y;
    const dates = byMonth[monthKey].sort();
    html += `<div style="margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-weight:800;font-size:13px;color:var(--rose2)">📅 ${mLabel}</div>
        <span style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:8px;padding:2px 8px;font-size:11px;font-weight:700">${dates.length} hari</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:5px">`;
    dates.forEach(dateStr => {
      const dateObj = new Date(dateStr + 'T00:00:00');
      const dow = dateObj.getDay();
      const dayNum = dateObj.getDate();
      const dayName = DF_FULL[dow];
      const isWeekend = dow === 0 || dow === 5; // Ahad atau Jumat
      html += `<div style="display:flex;align-items:center;gap:10px;background:${isWeekend ? '#fff7ed' : '#fff1f2'};border:1px solid ${isWeekend ? '#fed7aa' : '#fca5a5'};border-radius:10px;padding:8px 12px">
        <div style="width:36px;height:36px;border-radius:10px;background:${isWeekend ? '#f97316' : '#dc2626'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:16px;flex-shrink:0">${dayNum}</div>
        <div style="flex:1">
          <div style="font-weight:800;font-size:13px;color:var(--text)">${dayName}, ${dayNum} ${MONTHS[m - 1]} ${y}</div>
          <div style="font-size:11px;color:${isWeekend ? '#f97316' : '#ef4444'};font-weight:600;margin-top:2px">${isWeekend ? '🕌 Hari Libur Reguler' : '🌙 Hari Libur Khusus'}</div>
        </div>
        <button onclick="hapusSatuHariLibur('${dateStr}')" title="Hapus hari libur ini" style="background:#fee2e2;border:1px solid #fca5a5;color:#dc2626;border-radius:8px;padding:4px 8px;font-size:12px;cursor:pointer;font-weight:700" >✕</button>
      </div>`;
    });
    html += `</div></div>`;
  });

  listEl.innerHTML = html;
  listEl.style.display = '';
  emptyEl.style.display = 'none';
  deleteWrap.style.display = '';
}

// ── Hapus ──

export async function hapusSatuHariLibur(dateStr) {
  if (!confirm(`Hapus "${dateStr}" dari daftar hari libur?\n\nData absensi yang sudah terisi pada tanggal ini TIDAK akan dihapus.`)) return;
  showLoading('Menghapus hari libur...');
  try {
    const existing = await getHolidayDates();
    const updated = existing.filter(d => d !== dateStr);
    await setDoc(doc(fs, 'config', 'holidays'), { dates: updated });
    holidayDatesSet = new Set(updated);
    hideLoading();
    showToast('✅ Hari libur dihapus dari daftar');
    await refreshRincianLibur();
  } catch (e) {
    hideLoading();
    showToast('❌ Gagal: ' + e.message, false);
  }
}

export async function hapusSemuaHariLibur() {
  if (!confirm('Hapus SEMUA hari libur dari daftar?\n\nData absensi yang sudah terisi TIDAK akan dihapus.\nHanya daftar larangan pengisian yang akan dikosongkan.')) return;
  showLoading('Menghapus semua hari libur...');
  try {
    await setDoc(doc(fs, 'config', 'holidays'), { dates: [] });
    holidayDatesSet = new Set();
    hideLoading();
    showToast('✅ Semua hari libur berhasil dihapus');
    await refreshRincianLibur();
  } catch (e) {
    hideLoading();
    showToast('❌ Gagal: ' + e.message, false);
  }
}

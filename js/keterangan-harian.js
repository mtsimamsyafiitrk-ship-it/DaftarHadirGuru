// ── KETERANGAN HARIAN ──
// Keterangan kehadiran yang diberikan ADMIN untuk satu guru pada satu tanggal,
// dengan lingkup per-sesi (boleh seluruh sesi terjadwal, boleh sebagian saja).
//
// Efek keterangan:
//   - Sesi yang diberi keterangan DIKUNCI untuk guru (tidak bisa diubah guru).
//   - Jenis "hadir"/"luar"  → sesi tersebut otomatis diisi HADIR.
//   - Jenis lain            → sesi tersebut otomatis DIKOSONGKAN.
//   - Admin tetap bisa mengubah/menghapus keterangan kapan saja.
//
// Penyimpanan Firestore:
//   collection 'ket_harian', doc id = "YYYY-MM-DD_<uid>"
//   { dateKey, uid, type, sessions:[..], allDay, catatan, kegiatanNama, updatedAt }
//
// Doc id diawali dateKey agar bisa di-query per bulan dengan range documentId().

import {
  fs, doc, setDoc, deleteDoc, collection, getDocs,
  query, where, documentId
} from "./firebase.js";

// ── Jenis keterangan ──
// hadir:true  → sesi diisi hadir. hadir:false → sesi dikosongkan.
export const KET_TYPES = [
  { key:'sakit', label:'Sakit',       icon:'🤒', color:'#ef4444', bg:'#fef2f2', hadir:false,
    info:'Sesi terpilih dikosongkan & dikunci — guru dianggap tidak hadir.' },
  { key:'izin',  label:'Izin',        icon:'🙏', color:'#f59e0b', bg:'#fffbeb', hadir:false,
    info:'Sesi terpilih dikosongkan & dikunci — guru dianggap tidak hadir.' },
  { key:'alpa',  label:'Alpa',        icon:'❌', color:'#b91c1c', bg:'#fef2f2', hadir:false,
    info:'Tanpa keterangan. Sesi terpilih dikosongkan & dikunci.' },
  { key:'cuti',  label:'Cuti',        icon:'🏖️', color:'#0891b2', bg:'#ecfeff', hadir:false,
    info:'Sesi terpilih dikosongkan & dikunci selama masa cuti.' },
  { key:'luar',  label:'Dinas Luar',  icon:'🏫', color:'#5a9b86', bg:'#f0fdf4', hadir:true,
    info:'Sesi terpilih otomatis diisi HADIR & dikunci (kegiatan di luar KBM).' },
  { key:'hadir', label:'Hadir',       icon:'✅', color:'#16a34a', bg:'#f0fdf4', hadir:true,
    info:'Admin menyatakan hadir. Sesi terpilih diisi HADIR & dikunci.' },
];

export function getKetType(key){
  return KET_TYPES.find(t => t.key === key) || null;
}

// ── State internal ──
// ketCache[dateKey][uid] = entry
let ketCache = {};
let loadedMonths = new Set();

const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;

export function ketDocId(dateKey, uid){ return `${dateKey}_${uid}`; }

// ── Pemuatan per bulan ──
// Sekali baca per bulan (range query pada documentId), hasilnya di-cache.
export async function loadKetHarianMonth(y, m, force = false){
  const mk = monthKey(y, m);
  if (!force && loadedMonths.has(mk)) return;
  const qy = query(
    collection(fs, 'ket_harian'),
    // Doc id = "YYYY-MM-DD_<uid>". Batas atas "-32" aman karena tanggal maksimal 31.
    where(documentId(), '>=', `${mk}-01`),
    where(documentId(), '<=', `${mk}-32`)
  );
  const snap = await getDocs(qy);
  // Buang cache bulan ini dulu agar entri yang sudah dihapus tidak tertinggal.
  Object.keys(ketCache).forEach(dateKey => {
    if (dateKey.startsWith(mk + '-')) delete ketCache[dateKey];
  });
  snap.forEach(d => {
    const data = d.data();
    if (!data || !data.dateKey || !data.uid) return;
    if (!ketCache[data.dateKey]) ketCache[data.dateKey] = {};
    ketCache[data.dateKey][data.uid] = data;
  });
  loadedMonths.add(mk);
}

// Kosongkan seluruh cache (dipakai saat logout / ganti pengguna).
export function resetKetCache(){ ketCache = {}; loadedMonths = new Set(); }

// ── Pembacaan ──

// Entri keterangan untuk (tanggal, guru), atau null.
export function getKetHarian(dateKey, uid){
  return (ketCache[dateKey] && ketCache[dateKey][uid]) || null;
}

// Daftar sesi yang dikunci pada (tanggal, guru).
export function getKetLockedSessions(dateKey, uid){
  const k = getKetHarian(dateKey, uid);
  return k && Array.isArray(k.sessions) ? k.sessions : [];
}

// Apakah sesi sk dikunci keterangan? Kembalikan entri-nya (agar bisa dipakai
// untuk menampilkan alasan), atau null bila tidak dikunci.
export function getKetForSession(dateKey, uid, sk){
  const k = getKetHarian(dateKey, uid);
  if (!k || !Array.isArray(k.sessions)) return null;
  return k.sessions.includes(sk) ? k : null;
}

// Apakah seluruh sesi terjadwal hari itu dikunci?
export function isKetFullDay(dateKey, uid){
  const k = getKetHarian(dateKey, uid);
  return !!(k && k.allDay);
}

// Semua entri pada satu bulan, sebagai array (untuk halaman daftar).
export function getKetEntriesForMonth(y, m){
  const mk = monthKey(y, m);
  const out = [];
  Object.keys(ketCache).forEach(dateKey => {
    if (!dateKey.startsWith(mk + '-')) return;
    Object.values(ketCache[dateKey]).forEach(e => out.push(e));
  });
  return out.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

// ── Penulisan ──

export async function saveKetHarian(entry){
  const data = { ...entry, updatedAt: Date.now() };
  await setDoc(doc(fs, 'ket_harian', ketDocId(data.dateKey, data.uid)), data);
  if (!ketCache[data.dateKey]) ketCache[data.dateKey] = {};
  ketCache[data.dateKey][data.uid] = data;
  return data;
}

export async function deleteKetHarian(dateKey, uid){
  await deleteDoc(doc(fs, 'ket_harian', ketDocId(dateKey, uid)));
  if (ketCache[dateKey]) delete ketCache[dateKey][uid];
}

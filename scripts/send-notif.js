// send-notif.js
// Cek absensi guru hari ini, kirim WA via Fonnte jika belum absen (< 2 sesi)

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fetch from 'node-fetch';

// ─── Inisialisasi Firebase ───────────────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ─── Konstanta ───────────────────────────────────────────────────────────────
const FONNTE_TOKEN = process.env.FONNTE_TOKEN;
const FONNTE_URL   = 'https://api.fonnte.com/send';

// Semua sesi yang ada di aplikasi
const ALL_SESSIONS = ['H1','H2','H3','J1','J2','J3','J4','S1','S2'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format tanggal jadi YYYY-MM-DD (WIB) */
function todayWIB() {
  const now = new Date();
  // offset WIB = UTC+7
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

/** Nama hari Indonesia */
function hariIni() {
  const days = ['Ahad','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return days[wib.getUTCDay()];
}

/** Format tanggal jadi "Senin, 9 Mar 2026" */
function formatTanggal(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const bulan = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  return `${hariIni()}, ${d} ${bulan[m-1]} ${y}`;
}

/** Cek apakah hari ini hari libur (dari Firestore config/holidays) */
async function isHoliday(dateStr) {
  try {
    const doc = await db.collection('config').doc('holidays').get();
    if (!doc.exists) return false;
    const data = doc.data();
    const dates = data.dates || [];
    return dates.includes(dateStr);
  } catch (e) {
    console.error('Gagal cek hari libur:', e.message);
    return false;
  }
}

/** Ambil semua user yang punya nomor HP dan status aktif */
async function getUsers() {
  const snap = await db.collection('users').get();
  const users = [];
  snap.forEach(doc => {
    const u = { id: doc.id, ...doc.data() };
    const punya_hp = u.phone && u.phone.trim() !== "";
    const aktif = u.status === "aktif" || u.status === "active" || !u.status;
    if (punya_hp && aktif) {
      users.push(u);
    }
  });
  return users;
}

/** Hitung berapa sesi yang sudah diisi user hari ini */
async function countFilledSessions(uid, dateStr) {
  try {
    const doc = await db.collection(`att_${uid}`).doc(dateStr).get();
    if (!doc.exists) return 0;
    const data = doc.data();
    // Hitung sesi yang bernilai true (hadir) atau string non-kosong
    let count = 0;
    for (const sesi of ALL_SESSIONS) {
      const val = data[sesi];
      if (val === true || val === 1 || (typeof val === 'string' && val.trim() !== '')) {
        count++;
      }
    }
    return count;
  } catch (e) {
    return 0;
  }
}

/** Kirim pesan WA via Fonnte */
async function kirimWA(phone, nama) {
  const tgl = formatTanggal(todayWIB());
  const pesan =
    `Bismillah, Izin Ustadz ${nama}! \n` +
    `Absensi hari ini (${tgl}) belum lengkap.\n` +
    `Yuk segera isi di link berikut https://mtsimamsyafiitrk.github.io/DaftarHadirGuru/ . Jangan lupa periksa hari lain juga yah. Semoga Allah mudahkan, Barakallahu fiik!`;

  try {
    const res = await fetch(FONNTE_URL, {
      method: 'POST',
      headers: {
        'Authorization': FONNTE_TOKEN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        target: phone,   // format: "628xxx"
        message: pesan,
      }),
    });
    const json = await res.json();
    if (json.status) {
      console.log(`✅ WA terkirim ke ${nama} (${phone})`);
    } else {
      console.warn(`⚠️  Gagal kirim ke ${nama}: ${json.reason || JSON.stringify(json)}`);
    }
  } catch (e) {
    console.error(`❌ Error kirim WA ke ${nama}:`, e.message);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const dateStr = todayWIB();
  const hari    = hariIni();

  console.log(`\n📅 Cek absensi: ${formatTanggal(dateStr)}`);

  // Jumat = libur tetap
  if (hari === 'Jumat') {
    console.log('🟡 Hari Jumat (libur tetap), tidak ada notifikasi.');
    return;
  }

  // Cek hari libur dari Firestore
  const libur = await isHoliday(dateStr);
  if (libur) {
    console.log('🟡 Hari ini hari libur, tidak ada notifikasi.');
    return;
  }

  // Ambil semua user aktif
  const users = await getUsers();
  console.log(`👥 Total user aktif dengan HP: ${users.length}`);

  let kirim = 0;
  let skip  = 0;

  for (const user of users) {
    const jumlahSesi = await countFilledSessions(user.id, dateStr);

    if (jumlahSesi >= 2) {
      console.log(`⏭️  Skip ${user.name} (sudah isi ${jumlahSesi} sesi)`);
      skip++;
    } else {
      console.log(`📨 Kirim ke ${user.name} (baru isi ${jumlahSesi} sesi)`);
      await kirimWA(user.phone, user.name);
      kirim++;
      // Jeda kecil agar tidak flood API
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`\n✅ Selesai. Terkirim: ${kirim}, Dilewati: ${skip}`);
}

main().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});


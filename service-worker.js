// ── SERVICE WORKER ──
// Strategi: online-first dengan fallback cache untuk halaman utama.
// Cocok untuk aplikasi yang butuh data real-time dari Firestore,
// tapi tetap bisa diinstal sebagai PWA.

const CACHE_VERSION = 'v5';
const CACHE_NAME = `dhg-${CACHE_VERSION}`;

// File yang di-precache saat instalasi (shell aplikasi).
// Ini memastikan app bisa dibuka kembali (shell-nya) meski sinyal buruk;
// data aktual tetap fetch dari Firestore.
const PRECACHE_URLS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './js/constants.js',
  './js/utils.js',
  './js/ui-helpers.js',
  './js/firebase.js',
  './js/hari-libur.js',
  './js/keterangan-harian.js',
  './assets/logo.png',
  './assets/icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon-16.png',
  './manifest.webmanifest'
];

// ── Install: precache shell ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()) // aktifkan SW baru segera
  );
});

// ── Activate: bersihkan cache lama ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: stale-while-revalidate untuk shell aplikasi ──
// Aset milik origin (HTML, app.js, modul JS, CSS, ikon) dilayani LANGSUNG dari cache
// bila ada, lalu diperbarui di latar belakang. Ini membuat load terasa instan pada
// kunjungan berikutnya, alih-alih menunggu unduh ulang dari jaringan tiap kali.
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Hanya tangani GET
  if (req.method !== 'GET') return;

  // Jangan cache request ke Firestore/Firebase/EmailJS/CDN pihak ketiga —
  // selalu biarkan network yang urus (karena datanya dinamis / punya auth).
  const url = new URL(req.url);
  const isThirdParty =
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('google') ||
    url.hostname.includes('gstatic') ||
    url.hostname.includes('emailjs') ||
    url.hostname.includes('cloudflare') ||
    url.hostname.includes('jsdelivr');

  if (isThirdParty) {
    return; // biarkan browser handle normal
  }

  // Aset dalam origin kita: stale-while-revalidate.
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(req).then((cached) => {
        // Revalidasi di latar: ambil versi terbaru & perbarui cache.
        const networkFetch = fetch(req)
          .then((response) => {
            if (response && response.status === 200 && response.type === 'basic') {
              cache.put(req, response.clone());
            }
            return response;
          })
          .catch(() => null);

        // Ada di cache → kembalikan segera (instan). Tidak ada → tunggu network.
        if (cached) {
          event.waitUntil(networkFetch); // biarkan update latar selesai
          return cached;
        }
        return networkFetch.then((resp) => {
          if (resp) return resp;
          if (req.mode === 'navigate') return cache.match('./index.html');
          return new Response('Offline — tidak ada data di cache', {
            status: 503,
            statusText: 'Service Unavailable'
          });
        });
      })
    )
  );
});

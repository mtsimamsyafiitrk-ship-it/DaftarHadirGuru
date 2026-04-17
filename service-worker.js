// ── SERVICE WORKER ──
// Strategi: online-first dengan fallback cache untuk halaman utama.
// Cocok untuk aplikasi yang butuh data real-time dari Firestore,
// tapi tetap bisa diinstal sebagai PWA.

const CACHE_VERSION = 'v1';
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
  './assets/logo.jpg',
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

// ── Fetch: online-first untuk dokumen, cache-first untuk assets ──
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

  // Untuk file dalam origin kita: coba network dulu, fallback ke cache
  event.respondWith(
    fetch(req)
      .then((response) => {
        // Kalau network sukses & response OK, update cache + return
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return response;
      })
      .catch(() => {
        // Network gagal → coba dari cache
        return caches.match(req).then((cached) => {
          if (cached) return cached;
          // Kalau minta halaman HTML tapi tidak ada di cache → fallback ke index
          if (req.mode === 'navigate') {
            return caches.match('./index.html');
          }
          // Kalau tidak ada sama sekali, biarkan error apa adanya
          return new Response('Offline — tidak ada data di cache', {
            status: 503,
            statusText: 'Service Unavailable'
          });
        });
      })
  );
});

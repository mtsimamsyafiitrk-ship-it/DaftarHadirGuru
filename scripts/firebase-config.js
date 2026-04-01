// Firebase Configuration & Initialization
const firebaseConfig = {
  apiKey: "AIzaSyDkbdlleECoXbZbxGt5qONCBb6Ip5ZQv-U",
  authDomain: "daftar-hadir-guru-ae9bd.firebaseapp.com",
  projectId: "daftar-hadir-guru-ae9bd",
  storageBucket: "daftar-hadir-guru-ae9bd.firebasestorage.app",
  messagingSenderId: "851866323538",
  appId: "1:851866323538:web:8d2dd2ae81302aec756d8b",
  measurementId: "G-9WW69WLL32"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Get Firebase services
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// Enable offline persistence
db.enablePersistence()
  .catch((err) => {
    if (err.code == 'failed-precondition') {
      console.log('[Firebase] Multiple tabs open, persistence can only be enabled in one tab at a time.');
    } else if (err.code == 'unimplemented') {
      console.log('[Firebase] The current browser does not support all of the features required to enable persistence');
    }
  });

console.log('[Firebase] Initialized successfully');

// Export for use in other modules
window.firebase = firebase;
window.auth = auth;
window.db = db;
window.storage = storage;

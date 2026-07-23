// ── FIREBASE ──
// Inisialisasi Firebase app + Firestore.
// Modul lain mengimport `fs` dari sini dan `doc`, `getDoc`, dll dari Firestore SDK.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, updateDoc,
  collection, getDocs, query, where, documentId
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDkbdlleECoXbZbxGt5qONCBb6Ip5ZQv-U",
  authDomain: "daftar-hadir-guru-ae9bd.firebaseapp.com",
  projectId: "daftar-hadir-guru-ae9bd",
  storageBucket: "daftar-hadir-guru-ae9bd.firebasestorage.app",
  messagingSenderId: "851866323538",
  appId: "1:851866323538:web:8d2dd2ae81302aec756d8b",
  measurementId: "G-9WW69WLL32"
};

const fapp = initializeApp(firebaseConfig);
export const fs = getFirestore(fapp);

// Re-export fungsi Firestore yang sering dipakai agar modul lain
// cukup import { fs, doc, getDoc, ... } from './firebase.js' — 1 source of truth.
export {
  doc, getDoc, setDoc, deleteDoc, updateDoc,
  collection, getDocs, query, where, documentId
};

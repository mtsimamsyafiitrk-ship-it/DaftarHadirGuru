// ── UI HELPERS ──
// Helper manipulasi DOM yang dipakai di banyak tempat:
// loading, toast, pindah screen, modal, toggle password, dan render badge peran.

import { ROLE_COLOR_MAP } from "./constants.js";

// ── Loading overlay ──

export function showLoading(msg = "Memuat...") {
  document.getElementById('loading').style.display = 'flex';
  document.getElementById('loading-msg').textContent = msg;
}

export function hideLoading() {
  document.getElementById('loading').style.display = 'none';
}

// ── Toast ──

export function showToast(msg, ok = true) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = ok ? 'var(--sage2)' : 'var(--rose2)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// ── Screen switcher ──

export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  window.scrollTo(0, 0);
}

// ── Modal ──

export function openModal(id) {
  document.getElementById(id).style.display = 'flex';
}

export function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

// ── Toggle visibilitas password ──

export function togglePw(id, btn) {
  const el = document.getElementById(id);
  el.type = el.type === 'password' ? 'text' : 'password';
  btn.textContent = el.type === 'password' ? '👁️' : '🙈';
}

// ── Role helpers (tampilan) ──

export function getRoleColor(role) {
  return ROLE_COLOR_MAP[role] || '#4d8fa0';
}

// Peran user bisa berupa array (baru) atau string tunggal (legacy).
export function getRoles(u) {
  if (Array.isArray(u.roles)) return u.roles;
  if (u.role) return [u.role];
  return [];
}

// Render peran sebagai badge berwarna (HTML string).
export function rolesDisplay(u) {
  return getRoles(u).map(r => {
    const c = getRoleColor(r);
    return `<span class="badge" style="background:${c}18;color:${c};border:1px solid ${c}44;margin:2px 2px 0 0">${r}</span>`;
  }).join('');
}

// Peran sebagai teks biasa, dipisah koma.
export function rolesText(u) {
  return getRoles(u).join(', ');
}

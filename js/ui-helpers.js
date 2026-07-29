// ── UI HELPERS ──
// Helper manipulasi DOM: loading, toast, pindah screen, modal, toggle password.

export function showLoading(msg = "Memuat...") {
  document.getElementById('loading').style.display = 'flex';
  document.getElementById('loading-msg').textContent = msg;
}

export function hideLoading() {
  document.getElementById('loading').style.display = 'none';
}

export function showToast(msg, ok = true) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = ok ? 'var(--sage2)' : 'var(--rose2)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  window.scrollTo(0, 0);
}

export function openModal(id) {
  document.getElementById(id).style.display = 'flex';
}

export function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

export function togglePw(id, btn) {
  const el = document.getElementById(id);
  el.type = el.type === 'password' ? 'text' : 'password';
  btn.textContent = el.type === 'password' ? '👁️' : '🙈';
}

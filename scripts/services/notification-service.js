// Notification/Toast Service
class NotificationService {
  constructor() { this.container = null; }
  init() { this.container = document.getElementById('toast'); }
  show(message, type = 'info', duration = 3000) { if(!this.container) this.init(); this.container.textContent = message; this.container.className = `toast toast-${type} show`; setTimeout(() => { this.container.classList.remove('show'); }, duration); }
  success(message, duration = 3000) { this.show(message, 'success', duration); }
  error(message, duration = 3000) { this.show(message, 'error', duration); }
  warning(message, duration = 3000) { this.show(message, 'warning', duration); }
  info(message, duration = 3000) { this.show(message, 'info', duration); }
}
const notification = new NotificationService();

// Loading State Service
class LoaderService {
  constructor() { this.overlay = null; }
  init() { this.overlay = document.getElementById('loading'); }
  show(message = 'Memuat...') { if(!this.overlay) this.init(); const msg = this.overlay?.querySelector('#loading-msg'); if(msg) msg.textContent = message; if(this.overlay) this.overlay.style.display = 'flex'; }
  hide() { if(this.overlay) this.overlay.style.display = 'none'; }
}
const loader = new LoaderService();

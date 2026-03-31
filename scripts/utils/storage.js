// LocalStorage Service Wrapper
class Storage {
  constructor(prefix = 'dhg_') { this.prefix = prefix; }
  get(key) { try { const data = localStorage.getItem(this.prefix + key); return data ? JSON.parse(data) : null; } catch(e) { return null; } }
  set(key, value) { try { localStorage.setItem(this.prefix + key, JSON.stringify(value)); return true; } catch(e) { return false; } }
  remove(key) { try { localStorage.removeItem(this.prefix + key); return true; } catch(e) { return false; } }
  exists(key) { return localStorage.getItem(this.prefix + key) !== null; }
  clear() { const keys = []; for(let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if(key && key.startsWith(this.prefix)) keys.push(key); } keys.forEach(key => localStorage.removeItem(key)); }
}
const storage = new Storage();

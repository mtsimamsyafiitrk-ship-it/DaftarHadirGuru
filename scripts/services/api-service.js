// API Service Wrapper
class ApiService {
  constructor() { this.baseURL = ''; this.timeout = 5000; }
  async get(endpoint) { try { const response = await fetch(this.baseURL + endpoint); if(!response.ok) throw new Error(`HTTP ${response.status}`); return await response.json(); } catch(e) { console.error('API Error:', e); return null; } }
  async post(endpoint, data) { try { const response = await fetch(this.baseURL + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if(!response.ok) throw new Error(`HTTP ${response.status}`); return await response.json(); } catch(e) { console.error('API Error:', e); return null; } }
  async sendEmail(templateId, params) { try { return await emailjs.send('SERVICE_ID', templateId, params); } catch(e) { console.error('Email Error:', e); return null; } }
}
const apiService = new ApiService();

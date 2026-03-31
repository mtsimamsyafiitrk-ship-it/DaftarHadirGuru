// Input Validation Utilities
class Validators {
  static email(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
  static username(user) { return /^[a-zA-Z0-9_]{3,20}$/.test(user); }
  static password(pass) { return pass && pass.length >= 6; }
  static required(val) { return val !== null && val !== undefined && val !== ''; }
  static date(dateStr) { const pattern = /^\d{4}-\d{2}-\d{2}$/; if(!pattern.test(dateStr)) return false; const date = new Date(dateStr); return date instanceof Date && !isNaN(date); }
  static dateRange(start, end) { return new Date(start) <= new Date(end); }
  static sanitize(input) { const div = document.createElement('div'); div.textContent = input; return div.innerHTML; }
  static validateForm(data, rules) { const errors = {}; for(const [field, value] of Object.entries(data)) { if(!rules[field]) continue; const rule = rules[field]; if(rule.required && !this.required(value)) errors[field] = `${field} is required`; if(rule.email && value && !this.email(value)) errors[field] = `${field} is invalid`; if(rule.minLength && value.length < rule.minLength) errors[field] = `${field} min ${rule.minLength} chars`; } return Object.keys(errors).length ? errors : null; }
}

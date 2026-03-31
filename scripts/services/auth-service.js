// Authentication Service
class AuthService {
  constructor() { this.currentUser = null; this.users = storage.get('users') || []; }
  login(username, password) { const user = this.users.find(u => u.username === username); if(!user) return { success: false, message: 'User tidak ditemukan' }; if(user.password !== password) return { success: false, message: 'Password salah' }; this.currentUser = user; storage.set('currentUser', user); return { success: true, user }; }
  logout() { this.currentUser = null; storage.remove('currentUser'); }
  register(username, password, email, role) { if(this.users.find(u => u.username === username)) return { success: false, message: 'Username sudah terdaftar' }; const newUser = { id: Date.now(), username, password, email, role, createdAt: new Date() }; this.users.push(newUser); storage.set('users', this.users); return { success: true, user: newUser }; }
  getCurrentUser() { return this.currentUser || storage.get('currentUser'); }
  isAuthenticated() { return !!this.getCurrentUser(); }
  hasRole(requiredRole) { const user = this.getCurrentUser(); return user && user.role === requiredRole; }
}
const authService = new AuthService();

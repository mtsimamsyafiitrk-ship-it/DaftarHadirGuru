// Authentication Service with Firebase Integration
class AuthService {
  constructor() {
    this.currentUser = null;
    this.authStateListener = null;
  }

  // Initialize auth state listener
  initAuthListener() {
    this.authStateListener = firebase.auth().onAuthStateChanged((user) => {
      if (user) {
        console.log('[Auth] User logged in:', user.email);
        this.currentUser = {
          id: user.uid,
          email: user.email,
          username: user.displayName || user.email.split('@')[0],
          createdAt: user.metadata.creationTime
        };
        storage.set('currentUser', this.currentUser);
      } else {
        console.log('[Auth] No user logged in');
        this.currentUser = null;
        storage.remove('currentUser');
      }
    });
  }

  // Register with Firebase
  async register(email, password, username) {
    try {
      loader.show('Membuat akun...');
      
      // Create user in Firebase Auth
      const userCredential = await firebase.auth().createUserWithEmailAndPassword(email, password);
      const user = userCredential.user;

      // Set display name
      await user.updateProfile({
        displayName: username
      });

      // Save user data to Firestore
      await db.collection('users').doc(user.uid).set({
        uid: user.uid,
        username: username,
        email: email,
        role: 'user',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      loader.hide();
      notification.success('Registrasi berhasil! Silakan login');
      return { success: true, user };
    } catch (error) {
      loader.hide();
      console.error('[Auth] Register error:', error);
      
      let message = 'Terjadi kesalahan';
      if (error.code === 'auth/email-already-in-use') {
        message = 'Email sudah terdaftar';
      } else if (error.code === 'auth/weak-password') {
        message = 'Password minimal 6 karakter';
      } else if (error.code === 'auth/invalid-email') {
        message = 'Email tidak valid';
      }
      
      return { success: false, message };
    }
  }

  // Login with Firebase
  async login(email, password) {
    try {
      loader.show('Validating credentials...');
      
      const userCredential = await firebase.auth().signInWithEmailAndPassword(email, password);
      const user = userCredential.user;

      // Get user data from Firestore
      const userDoc = await db.collection('users').doc(user.uid).get();
      
      if (userDoc.exists) {
        this.currentUser = {
          id: user.uid,
          email: user.email,
          username: user.displayName || userDoc.data().username,
          role: userDoc.data().role || 'user'
        };
        
        storage.set('currentUser', this.currentUser);
        loader.hide();
        notification.success('Login berhasil!');
        return { success: true, user: this.currentUser };
      } else {
        loader.hide();
        return { success: false, message: 'Data pengguna tidak ditemukan' };
      }
    } catch (error) {
      loader.hide();
      console.error('[Auth] Login error:', error);
      
      let message = 'Terjadi kesalahan';
      if (error.code === 'auth/user-not-found') {
        message = 'Email tidak terdaftar';
      } else if (error.code === 'auth/wrong-password') {
        message = 'Password salah';
      } else if (error.code === 'auth/invalid-email') {
        message = 'Email tidak valid';
      } else if (error.code === 'auth/too-many-requests') {
        message = 'Terlalu banyak percobaan login, coba lagi nanti';
      }
      
      return { success: false, message };
    }
  }

  // Logout
  async logout() {
    try {
      loader.show('Logging out...');
      await firebase.auth().signOut();
      this.currentUser = null;
      storage.remove('currentUser');
      loader.hide();
      notification.success('Logout berhasil');
      return { success: true };
    } catch (error) {
      loader.hide();
      console.error('[Auth] Logout error:', error);
      return { success: false, message: error.message };
    }
  }

  // Get current user
  getCurrentUser() {
    return this.currentUser || storage.get('currentUser');
  }

  // Check if authenticated
  isAuthenticated() {
    return !!this.getCurrentUser();
  }

  // Check user role
  hasRole(requiredRole) {
    const user = this.getCurrentUser();
    return user && user.role === requiredRole;
  }
}

const authService = new AuthService();

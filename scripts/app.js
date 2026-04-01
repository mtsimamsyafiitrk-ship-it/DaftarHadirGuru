// Application Bootstrap & Initialization with Firebase
class Application {
  constructor() {
    this.currentUser = null;
    this.currentScreen = 'login';
    this.unsubscribeAttendance = null;
  }

  async init() {
    console.log('[App] Initializing application...');
    
    try {
      // Initialize services
      notification.init();
      loader.init();
      authService.initAuthListener();
      
      // Wait for auth state
      await this.waitForAuthState();
      
      // Setup event listeners
      this.setupEventListeners();
      
      // Show appropriate screen
      if (this.currentUser && this.currentUser.email) {
        this.showScreen('dashboard');
        this.loadAttendanceData();
        console.log('[App] User logged in:', this.currentUser.email);
      } else {
        this.showScreen('login');
        console.log('[App] No user logged in');
      }
      
      console.log('[App] Application ready!');
    } catch (error) {
      console.error('[App] Initialization error:', error);
      notification.error('Terjadi kesalahan saat inisialisasi aplikasi');
    }
  }

  waitForAuthState() {
    return new Promise((resolve) => {
      const unsubscribe = firebase.auth().onAuthStateChanged((user) => {
        if (user) {
          db.collection('users').doc(user.uid).get().then((doc) => {
            if (doc.exists) {
              this.currentUser = {
                id: user.uid,
                email: user.email,
                username: user.displayName || doc.data().username,
                role: doc.data().role || 'user'
              };
            }
          });
        }
        unsubscribe();
        resolve();
      });
    });
  }

  setupEventListeners() {
    // Login form
    const loginBtn = Helpers.getEl('btn-login');
    if (loginBtn) {
      loginBtn.addEventListener('click', () => this.handleLogin());
    }

    // Register form
    const registerBtn = Helpers.getEl('btn-register');
    if (registerBtn) {
      registerBtn.addEventListener('click', () => this.handleRegister());
    }

    // Logout
    const logoutBtn = Helpers.getEl('btn-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => this.handleLogout());
    }

    // Mark attendance
    const attendanceBtn = Helpers.getEl('btn-attendance');
    if (attendanceBtn) {
      attendanceBtn.addEventListener('click', () => this.handleAttendance());
    }
  }

  handleLogin() {
    const email = Helpers.getEl('input-username')?.value;
    const password = Helpers.getEl('input-password')?.value;

    if (!Validators.required(email) || !Validators.required(password)) {
      notification.error('Email dan password wajib diisi');
      return;
    }

    if (!Validators.email(email)) {
      notification.error('Format email tidak valid');
      return;
    }

    authService.login(email, password).then((result) => {
      if (result.success) {
        this.currentUser = result.user;
        notification.success('Login berhasil!');
        this.showScreen('dashboard');
        this.loadAttendanceData();
      } else {
        notification.error(result.message);
      }
    });
  }

  handleRegister() {
    const username = Helpers.getEl('input-reg-username')?.value;
    const email = Helpers.getEl('input-reg-email')?.value;
    const password = Helpers.getEl('input-reg-password')?.value;

    if (!Validators.required(username) || !Validators.required(email) || !Validators.required(password)) {
      notification.error('Semua field wajib diisi');
      return;
    }

    if (!Validators.email(email)) {
      notification.error('Email tidak valid');
      return;
    }

    if (!Validators.password(password)) {
      notification.error('Password minimal 6 karakter');
      return;
    }

    authService.register(email, password, username).then((result) => {
      if (result.success) {
        notification.success('Registrasi berhasil! Silakan login');
        this.showScreen('login');
        
        // Clear form
        Helpers.getEl('input-reg-username').value = '';
        Helpers.getEl('input-reg-email').value = '';
        Helpers.getEl('input-reg-password').value = '';
      } else {
        notification.error(result.message);
      }
    });
  }

  handleLogout() {
    authService.logout().then((result) => {
      if (result.success) {
        this.currentUser = null;
        this.showScreen('login');
        
        // Unsubscribe from attendance listener
        if (this.unsubscribeAttendance) {
          this.unsubscribeAttendance();
        }
      } else {
        notification.error(result.message);
      }
    });
  }

  handleAttendance() {
    if (!this.currentUser) {
      notification.error('Anda harus login terlebih dahulu');
      return;
    }

    const today = DateUtils.today();
    const status = Helpers.getEl('select-attendance')?.value;

    if (!status) {
      notification.error('Pilih status kehadiran');
      return;
    }

    loader.show('Mencatat kehadiran...');

    // Save to Firestore
    db.collection('attendance').add({
      userId: this.currentUser.id,
      username: this.currentUser.username,
      email: this.currentUser.email,
      date: today,
      status: status,
      timestamp: new Date().toISOString(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
      loader.hide();
      notification.success('Kehadiran berhasil dicatat');
      Helpers.getEl('select-attendance').value = '';
      this.loadAttendanceData();
      console.log('[App] Attendance recorded:', { date: today, status });
    }).catch((error) => {
      loader.hide();
      console.error('[App] Error recording attendance:', error);
      notification.error('Gagal mencatat kehadiran');
    });
  }

  loadAttendanceData() {
    if (!this.currentUser) return;

    loader.show('Memuat riwayat...');

    // Unsubscribe from previous listener
    if (this.unsubscribeAttendance) {
      this.unsubscribeAttendance();
    }

    // Real-time listener for user's attendance
    this.unsubscribeAttendance = db.collection('attendance')
      .where('userId', '==', this.currentUser.id)
      .orderBy('createdAt', 'desc')
      .limit(10)
      .onSnapshot((querySnapshot) => {
        const historyContainer = Helpers.getEl('attendance-history');
        
        if (querySnapshot.empty) {
          historyContainer.innerHTML = '<p class="text-muted">Belum ada riwayat kehadiran</p>';
          loader.hide();
          return;
        }

        let historyHTML = '';
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          const statusEmoji = {
            'hadir': '✅',
            'izin': '📋',
            'sakit': '🏥',
            'alpa': '❌'
          };
          
          historyHTML += `
            <div class="card" style="margin-bottom: 8px; padding: 8px 12px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <strong>${data.date}</strong>
                  <br>
                  <small class="text-muted">${data.status}</small>
                </div>
                <span style="font-size: 20px;">${statusEmoji[data.status] || '❓'}</span>
              </div>
            </div>
          `;
        });

        historyContainer.innerHTML = historyHTML;
        loader.hide();
        console.log('[App] Attendance history loaded:', querySnapshot.size, 'records');
      }, (error) => {
        loader.hide();
        console.error('[App] Error loading attendance:', error);
        notification.error('Gagal memuat riwayat kehadiran');
      });
  }

  showScreen(screenName) {
    // Hide all screens
    const screens = Helpers.getAll('.screen');
    screens.forEach(screen => {
      Helpers.removeClass(screen, 'active');
    });

    // Show target screen
    const targetScreen = Helpers.getEl(`screen-${screenName}`);
    if (targetScreen) {
      Helpers.addClass(targetScreen, 'active');
      this.currentScreen = screenName;
      
      // Update greeting
      if (screenName === 'dashboard' && this.currentUser) {
        const greeting = Helpers.getEl('user-greeting');
        if (greeting) {
          greeting.textContent = `Halo, ${this.currentUser.username}! 👋 (${this.currentUser.email})`;
        }
      }
      
      console.log('[App] Showing screen:', screenName);
    }
  }

  getCurrentUser() {
    return this.currentUser;
  }

  isLoggedIn() {
    return !!this.currentUser;
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new Application();
  app.init();
  
  // Make app available globally for debugging
  window.app = app;
  window.Helpers = Helpers;
  window.storage = storage;
  window.authService = authService;
  window.notification = notification;
  window.loader = loader;
  
  console.log('[App] Global objects available in console');
  console.log('[App] Firebase connected:', firebase.app().name);
});

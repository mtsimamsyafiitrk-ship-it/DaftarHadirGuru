// Application Bootstrap & Initialization
class Application {
  constructor() {
    this.currentUser = null;
    this.currentScreen = 'login';
  }

  async init() {
    console.log('[App] Initializing application...');
    
    try {
      // Initialize all services
      notification.init();
      loader.init();
      
      // Load saved user
      this.currentUser = storage.get('currentUser');
      
      // Setup event listeners
      this.setupEventListeners();
      
      // Show appropriate screen
      if (this.currentUser && this.currentUser.username) {
        this.showScreen('dashboard');
        console.log('[App] User logged in:', this.currentUser.username);
      } else {
        this.showScreen('login');
        console.log('[App] No user logged in, showing login screen');
      }
      
      console.log('[App] Application ready!');
    } catch (error) {
      console.error('[App] Initialization error:', error);
      notification.error('Terjadi kesalahan saat inisialisasi aplikasi');
    }
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
    const username = Helpers.getEl('input-username')?.value;
    const password = Helpers.getEl('input-password')?.value;

    if (!Validators.required(username) || !Validators.required(password)) {
      notification.error('Username dan password wajib diisi');
      return;
    }

    loader.show('Validating credentials...');

    setTimeout(() => {
      const result = authService.login(username, password);
      loader.hide();

      if (result.success) {
        this.currentUser = result.user;
        notification.success('Login berhasil!');
        this.showScreen('dashboard');
      } else {
        notification.error(result.message);
      }
    }, 500);
  }

  handleRegister() {
    const username = Helpers.getEl('input-reg-username')?.value;
    const password = Helpers.getEl('input-reg-password')?.value;
    const email = Helpers.getEl('input-reg-email')?.value;

    if (!Validators.required(username) || !Validators.required(password) || !Validators.required(email)) {
      notification.error('Semua field wajib diisi');
      return;
    }

    if (!Validators.email(email)) {
      notification.error('Email tidak valid');
      return;
    }

    loader.show('Creating account...');

    setTimeout(() => {
      const result = authService.register(username, password, email, 0);
      loader.hide();

      if (result.success) {
        notification.success('Registrasi berhasil! Silakan login');
        this.showScreen('login');
      } else {
        notification.error(result.message);
      }
    }, 500);
  }

  handleLogout() {
    loader.show('Logging out...');

    setTimeout(() => {
      authService.logout();
      this.currentUser = null;
      loader.hide();
      notification.success('Logout berhasil');
      this.showScreen('login');
    }, 300);
  }

  handleAttendance() {
    const today = DateUtils.today();
    const status = Helpers.getEl('select-attendance')?.value;

    if (!status) {
      notification.error('Pilih status kehadiran');
      return;
    }

    loader.show('Mencatat kehadiran...');

    setTimeout(() => {
      const attendance = {
        user: this.currentUser.username,
        date: today,
        status: status,
        timestamp: new Date().toISOString()
      };

      // Save to storage
      let attendanceData = storage.get('attendance') || [];
      attendanceData.push(attendance);
      storage.set('attendance', attendanceData);

      loader.hide();
      notification.success('Kehadiran berhasil dicatat');
      console.log('[App] Attendance recorded:', attendance);
    }, 500);
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
});

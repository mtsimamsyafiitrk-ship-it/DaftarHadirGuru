// Application Bootstrap & Initialization with Firebase + Admin
class Application {
  constructor() {
    this.currentUser = null;
    this.currentScreen = 'login';
    this.unsubscribeAttendance = null;
    this.isAdmin = false;
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
      
      // Check if admin
      this.isAdmin = await this.checkAdminStatus();
      
      // Setup event listeners
      this.setupEventListeners();
      
      // Initialize managers
      await scheduleManager.loadAllSchedules();
      await userManager.loadAllUsers();
      
      // Show appropriate screen
      if (this.currentUser && this.currentUser.email) {
        if (this.isAdmin) {
          this.showScreen('admin');
          console.log('[App] Admin logged in:', this.currentUser.email);
        } else {
          this.showScreen('dashboard');
          this.loadAttendanceData();
          console.log('[App] User logged in:', this.currentUser.email);
        }
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
                username: user.displayName || doc.data().name || doc.data().username,
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

  // Check if current user is admin
  async checkAdminStatus() {
    if (!this.currentUser) return false;
    
    // Check if email is admin email
    const adminEmail = 'mtsimamsyafiitrk@gmail.com';
    return this.currentUser.email === adminEmail;
  }

  setupEventListeners() {
    // Login form
    const loginBtn = Helpers.getEl('btn-login');
    if (loginBtn) {
      loginBtn.addEventListener('click', () => this.handleLogin());
    }

    // Register form (hidden for now - only admin creates users)
    const registerBtn = Helpers.getEl('btn-register');
    if (registerBtn) {
      registerBtn.addEventListener('click', () => this.handleRegister());
    }

    // Logout
    const logoutBtn = Helpers.getEl('btn-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => this.handleLogout());
    }

    // Admin logout
    const adminLogoutBtn = Helpers.getEl('btn-admin-logout');
    if (adminLogoutBtn) {
      adminLogoutBtn.addEventListener('click', () => this.handleLogout());
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
        
        // Check if admin
        this.checkAdminStatus().then((isAdmin) => {
          this.isAdmin = isAdmin;
          if (isAdmin) {
            this.showScreen('admin');
            switchAdminTab('overview');
          } else {
            this.showScreen('dashboard');
            this.loadAttendanceData();
          }
        });
      } else {
        notification.error(result.message);
      }
    });
  }

  handleRegister() {
    notification.error('Registrasi tidak tersedia. Hubungi admin untuk membuat akun.');
  }

  handleLogout() {
    authService.logout().then((result) => {
      if (result.success) {
        this.currentUser = null;
        this.isAdmin = false;
        this.showScreen('login');
        
        // Unsubscribe from attendance listener
        if (this.unsubscribeAttendance) {
          this.unsubscribeAttendance();
        }

        // Clear forms
        Helpers.getEl('input-username').value = '';
        Helpers.getEl('input-password').value = '';
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
    const todaySchedule = scheduleManager.schedules[this.currentUser.id]?.[this.getDayName()] || [];

    if (todaySchedule.length === 0) {
      notification.warning('Tidak ada jadwal untuk hari ini');
      return;
    }

    // Collect checked sessions
    const checkedSessions = [];
    todaySchedule.forEach((session) => {
      const checkbox = Helpers.getEl(`checkbox-${session}`);
      if (checkbox && checkbox.checked) {
        checkedSessions.push(session);
      }
    });

    if (checkedSessions.length === 0) {
      notification.error('Pilih minimal satu session');
      return;
    }

    loader.show('Mencatat kehadiran...');

    // Find existing attendance document
    db.collection('attendance')
      .where('userId', '==', this.currentUser.id)
      .where('date', '==', today)
      .get()
      .then((query) => {
        let docRef;
        let isNew = false;

        if (query.empty) {
          // Create new document
          docRef = db.collection('attendance').doc();
          isNew = true;
        } else {
          docRef = query.docs[0].ref;
        }

        // Prepare update data
        const updateData = {
          userId: this.currentUser.id,
          username: this.currentUser.username,
          email: this.currentUser.email,
          date: today,
          timestamp: new Date().toISOString(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        // Add session data
        todaySchedule.forEach((session) => {
          const checkbox = Helpers.getEl(`checkbox-${session}`);
          updateData[session] = checkbox ? checkbox.checked : false;
          updateData[`${session}_status`] = 'present'; // Default status
          updateData[`${session}_updated_at`] = new Date().toISOString();
        });

        if (isNew) {
          updateData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
          docRef.set(updateData);
        } else {
          docRef.update(updateData);
        }

        return docRef;
      })
      .then(() => {
        loader.hide();
        notification.success('Kehadiran berhasil dicatat');
        this.loadAttendanceData();
        console.log('[App] Attendance recorded:', { date: today, sessions: checkedSessions });
      })
      .catch((error) => {
        loader.hide();
        console.error('[App] Error recording attendance:', error);
        notification.error('Gagal mencatat kehadiran: ' + error.message);
      });
  }

  loadAttendanceData() {
    if (!this.currentUser) return;

    loader.show('Memuat riwayat...');

    // Unsubscribe from previous listener
    if (this.unsubscribeAttendance) {
      this.unsubscribeAttendance();
    }

    // Update attendance form dengan jadwal hari ini
    this.updateAttendanceForm();

    // Real-time listener for user's attendance
    this.unsubscribeAttendance = db.collection('attendance')
      .where('userId', '==', this.currentUser.id)
      .orderBy('updatedAt', 'desc')
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
          
          // Build session info for this day
          let sessionsInfo = '';
          const sessions = ['H1', 'H2', 'H3', 'J1', 'J2', 'J3', 'J4', 'S1', 'S2'];
          sessions.forEach((session) => {
            if (data[session] !== undefined) {
              const attended = data[session] ? '✅' : '❌';
              const status = data[`${session}_status`] || 'pending';
              sessionsInfo += `${session}:${attended} `;
            }
          });
          
          historyHTML += `
            <div class="card" style="margin-bottom: 8px; padding: 8px 12px;">
              <div>
                <strong>${data.date}</strong>
                <br>
                <small class="text-muted">${sessionsInfo}</small>
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

  // Update attendance form based on today's schedule
  async updateAttendanceForm() {
    const todaySchedule = scheduleManager.schedules[this.currentUser.id]?.[this.getDayName()] || [];
    const container = Helpers.getEl('attendance-sessions-container');
    
    if (!container) return;

    if (todaySchedule.length === 0) {
      container.innerHTML = '<p class="text-muted">Tidak ada jadwal untuk hari ini</p>';
      return;
    }

    let html = '';
    const sessionNames = {
      'H1': 'Halaqah Subuh',
      'H2': 'Halaqah Dhuha',
      'H3': 'Halaqah Siang',
      'J1': 'Jam Pelajaran 1',
      'J2': 'Jam Pelajaran 2',
      'J3': 'Jam Pelajaran 3',
      'J4': 'Jam Pelajaran 4',
      'S1': 'Jam Kelas Sore',
      'S2': 'Jam Kelas Malam'
    };

    todaySchedule.forEach((session) => {
      html += `
        <div class="form-group">
          <label style="display: flex; align-items: center; cursor: pointer;">
            <input id="checkbox-${session}" type="checkbox" style="width: 18px; height: 18px; cursor: pointer; margin-right: 8px;">
            <span>${session} - ${sessionNames[session]}</span>
          </label>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  getDayName() {
    const days = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
    return days[new Date().getDay()];
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
          greeting.textContent = `Halo, ${this.currentUser.username}! 👋`;
        }
      }

      // Update admin greeting
      if (screenName === 'admin' && this.currentUser) {
        const adminGreeting = Helpers.getEl('admin-greeting');
        if (adminGreeting) {
          adminGreeting.textContent = `Welcome, Admin ${this.currentUser.username}! 👨‍💼`;
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

  isUserAdmin() {
    return this.isAdmin;
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
  window.scheduleManager = scheduleManager;
  window.userManager = userManager;
  window.remarksManager = remarksManager;
  window.attendanceAnalytics = attendanceAnalytics;
  
  console.log('[App] Global objects available in console');
  console.log('[App] Firebase connected:', firebase.app().name);
});

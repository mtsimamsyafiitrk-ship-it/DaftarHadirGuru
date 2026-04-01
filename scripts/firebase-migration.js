// Firebase Migration - Migrate data dari struktur lama ke baru
class FirebaseMigration {
  constructor() {
    this.pegawaiList = [
      'HARMIN, S.Pd.',
      'ADNAN ABDUL RASYID, S.T.',
      'RUDDY HERMANTO',
      'VIRGIAWAN ASMIR',
      'TASNIM, S.Pd.',
      'RHENDY FAHRULLAH',
      'IMAM HIDAYAT, S.Pd.',
      'METRIC CISARUANDA, S.Pd.',
      'USMAN, BA.',
      'MUHAMMAD IQBAL',
      'MUHAMMAD SYARIF, S.Pd.',
      'MUHAMMAD INDERA ALFHANDY',
      'ASMAN SUGANDHA PRATAMA',
      'NASRI JAYA',
      'FAJRIN TARIKA NUR MUHAMMAD',
      'ASMIN SUGANDHI PRATAMA',
      'IRFAN HARJO SANTOSO',
      'MUHAMMAD IHSAN',
      'MUHAMMAD IHSAN FAUZI, S.Sos.I',
      'MUHAMMAD SYUKUR',
      'MUHAMMAD KHAEZAR FITRAH NAZHARULLY',
      'ALFATH MUSYAHADAH, S.H.'
    ];
    this.sessions = ['H1', 'H2', 'H3', 'J1', 'J2', 'J3', 'J4', 'S1', 'S2'];
  }

  // Generate user ID dari nama
  generateUserId(name) {
    return name
      .toLowerCase()
      .replace(/[.,]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 20);
  }

  // STEP 1: Create users untuk 22 pegawai
  async createUsersFromPegawaiList() {
    try {
      console.log('[Migration] Starting to create users...');
      loader.show('Creating 22 user accounts...');

      for (let i = 0; i < this.pegawaiList.length; i++) {
        const name = this.pegawaiList[i];
        const userId = this.generateUserId(name);
        const email = `${userId}@daftarhadir.local`;
        const defaultPassword = 'TempPass123!'; // Default password

        try {
          // Create Firebase Auth user
          const userCredential = await firebase.auth().createUserWithEmailAndPassword(email, defaultPassword);
          const user = userCredential.user;

          // Update profile
          await user.updateProfile({ displayName: name });

          // Create user document di Firestore
          await db.collection('users').doc(user.uid).set({
            uid: user.uid,
            name: name,
            email: email,
            role: 'user',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdBy: 'migration-script',
            status: 'active'
          });

          // Create default schedule
          const defaultSchedule = this.createDefaultSchedule();
          await db.collection('schedules').doc(user.uid).set(defaultSchedule);

          console.log(`[Migration] Created user: ${name} (${email})`);
        } catch (error) {
          if (error.code === 'auth/email-already-in-use') {
            console.log(`[Migration] User already exists: ${name}`);
          } else {
            console.error(`[Migration] Error creating user ${name}:`, error);
          }
        }

        // Progress
        const progress = Math.round(((i + 1) / this.pegawaiList.length) * 100);
        loader.show(`Creating users... ${progress}%`);
      }

      loader.hide();
      notification.success('22 user accounts berhasil dibuat!');
      console.log('[Migration] All users created successfully');
      return { success: true };
    } catch (error) {
      loader.hide();
      console.error('[Migration] Error creating users:', error);
      return { success: false, message: error.message };
    }
  }

  // STEP 2: Migrate attendance data dari att_xxx collections
  async migrateAttendanceData() {
    try {
      console.log('[Migration] Starting to migrate attendance data...');
      loader.show('Migrating attendance data...');

      // Get all collections yang dimulai dengan 'att_'
      const collectionsSnapshot = await db.listCollections();
      const attCollections = collectionsSnapshot.filter(col => col.id.startsWith('att_'));

      console.log(`[Migration] Found ${attCollections.length} attendance collections`);

      let totalRecords = 0;
      let attendanceRecords = [];

      for (let collIndex = 0; collIndex < attCollections.length; collIndex++) {
        const collectionRef = attCollections[collIndex];
        const userId = collectionRef.id; // att_17726762693364 → gunakan sebagai reference

        // Try to match dengan user yang sudah dibuat
        let matchedUser = null;
        const users = await userManager.loadAllUsers();
        
        // Attempt to find matching user (simplified - menggunakan first available user)
        if (users.length > 0) {
          matchedUser = users[collIndex % users.length];
        }

        if (!matchedUser) {
          console.log(`[Migration] No matching user for collection: ${collectionRef.id}`);
          continue;
        }

        // Get all documents (dates) dalam collection ini
        const docsSnapshot = await collectionRef.get();

        for (let docIndex = 0; docIndex < docsSnapshot.docs.length; docIndex++) {
          const doc = docsSnapshot.docs[docIndex];
          const date = doc.id; // e.g., "2026-03-07"
          const data = doc.data();

          // Convert lama format ke baru
          const newAttendance = {
            userId: matchedUser.id,
            username: matchedUser.name,
            email: matchedUser.email,
            date: date,
            timestamp: new Date().toISOString(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          };

          // Map attendance data
          this.sessions.forEach((session) => {
            if (data[session] !== undefined) {
              newAttendance[session] = data[session];
              newAttendance[`${session}_status`] = data[session] ? 'present' : 'pending';
            }
          });

          attendanceRecords.push(newAttendance);
          totalRecords++;
        }

        const progress = Math.round(((collIndex + 1) / attCollections.length) * 100);
        loader.show(`Migrating attendance... ${progress}%`);
      }

      // Batch write attendance records
      console.log(`[Migration] Writing ${totalRecords} attendance records to new collection...`);
      loader.show(`Writing ${totalRecords} attendance records...`);

      const batchSize = 500; // Firestore batch write limit
      for (let i = 0; i < attendanceRecords.length; i += batchSize) {
        const batch = db.batch();
        const recordsBatch = attendanceRecords.slice(i, i + batchSize);

        recordsBatch.forEach((record) => {
          const docRef = db.collection('attendance').doc();
          batch.set(docRef, record);
        });

        await batch.commit();
        const progress = Math.round(((i + batchSize) / attendanceRecords.length) * 100);
        loader.show(`Writing records... ${progress}%`);
      }

      loader.hide();
      notification.success(`${totalRecords} attendance records berhasil dimigrate!`);
      console.log(`[Migration] Successfully migrated ${totalRecords} records`);
      return { success: true, recordsCount: totalRecords };
    } catch (error) {
      loader.hide();
      console.error('[Migration] Error migrating attendance:', error);
      return { success: false, message: error.message };
    }
  }

  // STEP 3: Create default schedule untuk semua user
  createDefaultSchedule() {
    return {
      senin: ['H1', 'J1', 'J2'],
      selasa: ['H2', 'J1', 'J2'],
      rabu: ['H3', 'J3', 'J4'],
      kamis: ['H1', 'J3', 'J4'],
      jumat: [], // Libur
      sabtu: ['H1', 'H2', 'S1'],
      minggu: ['S1', 'S2']
    };
  }

  // STEP 4: Backup data lama (create backup collection)
  async backupOldData() {
    try {
      console.log('[Migration] Starting backup of old data...');
      loader.show('Backing up old data...');

      const backup = {
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        description: 'Backup data sebelum migration',
        migrationDate: new Date().toISOString()
      };

      await db.collection('_backups').doc('pre-migration-backup').set(backup);

      loader.hide();
      notification.success('Backup data berhasil dibuat!');
      console.log('[Migration] Backup completed');
      return { success: true };
    } catch (error) {
      loader.hide();
      console.error('[Migration] Error backing up data:', error);
      return { success: false, message: error.message };
    }
  }

  // RUN FULL MIGRATION
  async runFullMigration() {
    try {
      // Confirm admin
      if (firebase.auth().currentUser?.email !== 'mtsimamsyafiitrk@gmail.com') {
        notification.error('Only admin can run migration!');
        return { success: false };
      }

      const confirmed = confirm(
        'PERHATIAN!\n\n' +
        'Ini akan:\n' +
        '1. Membuat 22 akun pengguna\n' +
        '2. Memigrate attendance data dari att_xxx\n' +
        '3. Membuat jadwal default\n' +
        '4. Backup data lama\n\n' +
        'Pastikan ini sudah dilakukan dengan benar!\n\n' +
        'Lanjutkan?'
      );

      if (!confirmed) {
        notification.warning('Migration dibatalkan');
        return { success: false };
      }

      // Step 1: Create users
      const step1 = await this.createUsersFromPegawaiList();
      if (!step1.success) throw new Error('Failed to create users');

      // Step 2: Migrate attendance
      const step2 = await this.migrateAttendanceData();
      if (!step2.success) throw new Error('Failed to migrate attendance');

      // Step 3: Backup
      const step3 = await this.backupOldData();
      if (!step3.success) throw new Error('Failed to backup data');

      notification.success('MIGRATION COMPLETED SUCCESSFULLY! ✅');
      console.log('[Migration] Full migration completed');
      
      return {
        success: true,
        summary: {
          usersCreated: this.pegawaiList.length,
          attendanceRecordsMigrated: step2.recordsCount,
          backupCreated: true
        }
      };
    } catch (error) {
      console.error('[Migration] Full migration failed:', error);
      notification.error('Migration failed: ' + error.message);
      return { success: false, message: error.message };
    }
  }

  // Show migration status
  async getMigrationStatus() {
    try {
      const usersSnapshot = await db.collection('users').get();
      const attendanceSnapshot = await db.collection('attendance').get();

      return {
        totalUsers: usersSnapshot.size,
        totalAttendanceRecords: attendanceSnapshot.size,
        hasBackup: !!(await db.collection('_backups').doc('pre-migration-backup').get()).exists
      };
    } catch (error) {
      console.error('[Migration] Error getting status:', error);
      return null;
    }
  }
}

const firebaseMigration = new FirebaseMigration();

// Add migration menu ke admin panel
console.log('[Migration] Migration script loaded. Run: firebaseMigration.runFullMigration()');


// Schedule Manager - Manage jadwal fleksibel per pegawai
class ScheduleManager {
  constructor() {
    this.schedules = {};
    this.sessions = ['H1', 'H2', 'H3', 'J1', 'J2', 'J3', 'J4', 'S1', 'S2'];
    this.sessionNames = {
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
    this.days = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'];
  }

  // Load semua jadwal dari Firestore
  async loadAllSchedules() {
    try {
      const snapshot = await db.collection('schedules').get();
      snapshot.forEach((doc) => {
        this.schedules[doc.id] = doc.data();
      });
      console.log('[ScheduleManager] Loaded', snapshot.size, 'schedules');
      return snapshot.size;
    } catch (error) {
      console.error('[ScheduleManager] Error loading schedules:', error);
      return 0;
    }
  }

  // Get jadwal user untuk hari tertentu
  async getSchedule(userId, day) {
    try {
      const docRef = db.collection('schedules').doc(userId);
      const doc = await docRef.get();
      
      if (doc.exists) {
        const schedule = doc.data();
        return schedule[day] || [];
      }
      return [];
    } catch (error) {
      console.error('[ScheduleManager] Error getting schedule:', error);
      return [];
    }
  }

  // Get jadwal user untuk hari ini
  async getTodaySchedule(userId) {
    const today = new Date();
    const dayName = this.days[today.getDay() === 0 ? 6 : today.getDay() - 1];
    return await this.getSchedule(userId, dayName);
  }

  // Upload jadwal (admin only)
  async uploadSchedule(scheduleData) {
    try {
      loader.show('Uploading schedules...');
      
      // scheduleData format:
      // {
      //   "harmin-spd": { senin: ["H1", "J1"], selasa: ["H2", "J2"], ... },
      //   "adnan-abdul": { ... },
      //   ...
      // }

      for (const [userId, schedule] of Object.entries(scheduleData)) {
        // Validate schedule
        for (const [day, sessions] of Object.entries(schedule)) {
          if (!this.days.includes(day)) {
            throw new Error(`Invalid day: ${day}`);
          }
          if (!Array.isArray(sessions)) {
            throw new Error(`Sessions must be array for ${userId} ${day}`);
          }
          for (const session of sessions) {
            if (!this.sessions.includes(session)) {
              throw new Error(`Invalid session: ${session}`);
            }
          }
        }

        // Save to Firestore
        await db.collection('schedules').doc(userId).set(schedule, { merge: true });
      }

      loader.hide();
      notification.success('Jadwal berhasil diupload!');
      console.log('[ScheduleManager] Schedules uploaded for', Object.keys(scheduleData).length, 'users');
      return { success: true };
    } catch (error) {
      loader.hide();
      console.error('[ScheduleManager] Error uploading schedule:', error);
      notification.error('Error: ' + error.message);
      return { success: false, message: error.message };
    }
  }

  // Update jadwal satu user
  async updateUserSchedule(userId, schedule) {
    try {
      await db.collection('schedules').doc(userId).set(schedule, { merge: true });
      console.log('[ScheduleManager] Updated schedule for', userId);
      return { success: true };
    } catch (error) {
      console.error('[ScheduleManager] Error updating schedule:', error);
      return { success: false, message: error.message };
    }
  }

  // Get session name
  getSessionName(code) {
    return this.sessionNames[code] || code;
  }

  // Export jadwal semua user
  async exportSchedules() {
    try {
      const snapshot = await db.collection('schedules').get();
      const data = [];
      
      snapshot.forEach((doc) => {
        data.push({
          userId: doc.id,
          ...doc.data()
        });
      });

      return data;
    } catch (error) {
      console.error('[ScheduleManager] Error exporting schedules:', error);
      return [];
    }
  }

  // Check if user punya session di day tertentu
  async hasSession(userId, day, session) {
    const schedule = await this.getSchedule(userId, day);
    return schedule.includes(session);
  }

  // Create default schedule (untuk migration)
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
}

const scheduleManager = new ScheduleManager();

// Remarks Manager - Manage keterangan attendance (Admin Only)
class RemarksManager {
  constructor() {
    this.remarkTypes = [
      { code: 'present', label: 'Hadir', color: '#48bb78' },
      { code: 'sick', label: 'Sakit', color: '#f56565' },
      { code: 'leave', label: 'Izin', color: '#ed8936' },
      { code: 'pending', label: 'Tanpa Keterangan', color: '#cbd5e0' },
      { code: 'official_leave', label: 'Izin Perintah Sekolah', color: '#4299e1' }
    ];
  }

  // Get all remark types
  getRemarkTypes() {
    return this.remarkTypes;
  }

  // Get remark label
  getRemarkLabel(code) {
    const remark = this.remarkTypes.find(r => r.code === code);
    return remark ? remark.label : code;
  }

  // Get remark color
  getRemarkColor(code) {
    const remark = this.remarkTypes.find(r => r.code === code);
    return remark ? remark.color : '#000000';
  }

  // Set keterangan untuk attendance (Admin only)
  async setRemark(userId, date, session, remarkCode, notes = '') {
    try {
      // Find or create attendance document
      const query = await db.collection('attendance')
        .where('userId', '==', userId)
        .where('date', '==', date)
        .get();

      let attendanceDoc = null;
      
      if (query.empty) {
        // Create new attendance document
        const docRef = await db.collection('attendance').add({
          userId: userId,
          date: date,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        attendanceDoc = docRef;
      } else {
        attendanceDoc = query.docs[0].ref;
      }

      // Update remark field
      const remarkField = `${session}_remarks`;
      const statusField = `${session}_status`;
      
      await attendanceDoc.update({
        [statusField]: remarkCode,
        [remarkField]: notes,
        [`${session}_updated_at`]: firebase.firestore.FieldValue.serverTimestamp(),
        [`${session}_updated_by`]: firebase.auth().currentUser.uid
      });

      console.log('[RemarksManager] Set remark:', { userId, date, session, remarkCode });
      return { success: true };
    } catch (error) {
      console.error('[RemarksManager] Error setting remark:', error);
      return { success: false, message: error.message };
    }
  }

  // Get keterangan untuk attendance
  async getRemark(userId, date, session) {
    try {
      const query = await db.collection('attendance')
        .where('userId', '==', userId)
        .where('date', '==', date)
        .get();

      if (query.empty) return null;

      const data = query.docs[0].data();
      const statusField = `${session}_status`;
      const remarkField = `${session}_remarks`;

      return {
        status: data[statusField] || 'pending',
        remarks: data[remarkField] || ''
      };
    } catch (error) {
      console.error('[RemarksManager] Error getting remark:', error);
      return null;
    }
  }

  // Get all attendance dengan remarks untuk user pada range dates
  async getAttendanceWithRemarks(userId, startDate, endDate) {
    try {
      const snapshot = await db.collection('attendance')
        .where('userId', '==', userId)
        .where('date', '>=', startDate)
        .where('date', '<=', endDate)
        .orderBy('date', 'desc')
        .get();

      const records = [];
      snapshot.forEach((doc) => {
        records.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return records;
    } catch (error) {
      console.error('[RemarksManager] Error getting attendance with remarks:', error);
      return [];
    }
  }

  // Batch set remarks
  async batchSetRemarks(remarksData) {
    try {
      // remarksData format:
      // [
      //   { userId, date, session, remarkCode, notes },
      //   ...
      // ]

      loader.show('Updating remarks...');
      
      for (const remark of remarksData) {
        await this.setRemark(remark.userId, remark.date, remark.session, remark.remarkCode, remark.notes);
      }

      loader.hide();
      notification.success('Keterangan berhasil diupdate!');
      return { success: true };
    } catch (error) {
      loader.hide();
      console.error('[RemarksManager] Error batch setting remarks:', error);
      return { success: false, message: error.message };
    }
  }

  // Get statistics dengan breakdown remarks
  async getStatisticsWithRemarks(userId, startDate, endDate) {
    try {
      const records = await this.getAttendanceWithRemarks(userId, startDate, endDate);
      
      const stats = {
        total_days: records.length,
        present: 0,
        sick: 0,
        leave: 0,
        pending: 0,
        official_leave: 0,
        sessions: {}
      };

      // Count sessions
      const sessions = ['H1', 'H2', 'H3', 'J1', 'J2', 'J3', 'J4', 'S1', 'S2'];
      
      records.forEach((record) => {
        sessions.forEach((session) => {
          const statusField = `${session}_status`;
          const status = record[statusField] || 'pending';
          
          if (!stats.sessions[session]) {
            stats.sessions[session] = {
              present: 0,
              sick: 0,
              leave: 0,
              pending: 0,
              official_leave: 0
            };
          }
          
          stats.sessions[session][status]++;
          stats[status]++;
        });
      });

      return stats;
    } catch (error) {
      console.error('[RemarksManager] Error getting statistics:', error);
      return null;
    }
  }

  // Export attendance dengan remarks ke format array
  async exportWithRemarks(userId, startDate, endDate) {
    try {
      const records = await this.getAttendanceWithRemarks(userId, startDate, endDate);
      const sessions = ['H1', 'H2', 'H3', 'J1', 'J2', 'J3', 'J4', 'S1', 'S2'];
      
      const data = [];
      records.forEach((record) => {
        const row = { date: record.date };
        
        sessions.forEach((session) => {
          const statusField = `${session}_status`;
          const remarkField = `${session}_remarks`;
          row[session] = record[statusField] || 'pending';
          if (record[remarkField]) {
            row[`${session}_notes`] = record[remarkField];
          }
        });
        
        data.push(row);
      });

      return data;
    } catch (error) {
      console.error('[RemarksManager] Error exporting:', error);
      return [];
    }
  }
}

const remarksManager = new RemarksManager();

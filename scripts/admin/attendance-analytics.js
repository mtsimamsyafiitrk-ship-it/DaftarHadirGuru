// Attendance Analytics - Generate reports & statistics
class AttendanceAnalytics {
  constructor() {
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
  }

  // Get attendance summary untuk semua user pada range dates
  async getAllAttendanceSummary(startDate, endDate) {
    try {
      const snapshot = await db.collection('attendance')
        .where('date', '>=', startDate)
        .where('date', '<=', endDate)
        .orderBy('date', 'desc')
        .get();

      const summary = {};
      snapshot.forEach((doc) => {
        const data = doc.data();
        const userId = data.userId;
        
        if (!summary[userId]) {
          summary[userId] = {
            userId: userId,
            userName: data.username || 'Unknown',
            userEmail: data.email || '',
            totalSessions: 0,
            presentSessions: 0,
            sickSessions: 0,
            leaveSessions: 0,
            officialLeaveSessions: 0,
            pendingSessions: 0,
            records: []
          };
        }

        summary[userId].records.push({
          date: data.date,
          data: data
        });

        // Count by status
        this.sessions.forEach((session) => {
          const statusField = `${session}_status`;
          const status = data[statusField];
          
          if (status) {
            summary[userId].totalSessions++;
            switch (status) {
              case 'present':
                summary[userId].presentSessions++;
                break;
              case 'sick':
                summary[userId].sickSessions++;
                break;
              case 'leave':
                summary[userId].leaveSessions++;
                break;
              case 'official_leave':
                summary[userId].officialLeaveSessions++;
                break;
              case 'pending':
                summary[userId].pendingSessions++;
                break;
            }
          }
        });
      });

      return summary;
    } catch (error) {
      console.error('[AttendanceAnalytics] Error getting summary:', error);
      return {};
    }
  }

  // Get attendance detail untuk satu user
  async getUserAttendanceDetail(userId, startDate, endDate) {
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
      console.error('[AttendanceAnalytics] Error getting detail:', error);
      return [];
    }
  }

  // Export ke Excel format (array of objects)
  async exportToExcel(startDate, endDate, userId = null) {
    try {
      loader.show('Preparing export...');

      let records = [];

      if (userId) {
        // Export untuk satu user
        records = await this.getUserAttendanceDetail(userId, startDate, endDate);
      } else {
        // Export untuk semua user
        const snapshot = await db.collection('attendance')
          .where('date', '>=', startDate)
          .where('date', '<=', endDate)
          .orderBy('date', 'desc')
          .get();

        snapshot.forEach((doc) => {
          records.push({ id: doc.id, ...doc.data() });
        });
      }

      // Convert ke CSV format
      let csvContent = this.convertToCSV(records);

      loader.hide();
      return csvContent;
    } catch (error) {
      loader.hide();
      console.error('[AttendanceAnalytics] Error exporting:', error);
      return null;
    }
  }

  // Convert records ke CSV
  convertToCSV(records) {
    const headers = ['Date', 'User Email', 'H1', 'H1_Status', 'H2', 'H2_Status', 'H3', 'H3_Status',
                     'J1', 'J1_Status', 'J2', 'J2_Status', 'J3', 'J3_Status', 'J4', 'J4_Status',
                     'S1', 'S1_Status', 'S2', 'S2_Status'];
    
    let csvContent = headers.join(',') + '\n';

    records.forEach((record) => {
      const row = [
        record.date,
        record.email || ''
      ];

      this.sessions.forEach((session) => {
        const statusField = `${session}_status`;
        const value = record[session] ? 'TRUE' : 'FALSE';
        const status = record[statusField] || 'pending';
        row.push(value, status);
      });

      csvContent += row.map(v => `"${v}"`).join(',') + '\n';
    });

    return csvContent;
  }

  // Download CSV file
  downloadCSV(csvContent, filename) {
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent));
    element.setAttribute('download', filename || 'attendance-report.csv');
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  }

  // Get per-session statistics
  async getSessionStatistics(startDate, endDate) {
    try {
      const snapshot = await db.collection('attendance')
        .where('date', '>=', startDate)
        .where('date', '<=', endDate)
        .get();

      const stats = {};
      this.sessions.forEach((session) => {
        stats[session] = {
          session: session,
          sessionName: this.sessionNames[session],
          present: 0,
          sick: 0,
          leave: 0,
          official_leave: 0,
          pending: 0,
          total: 0
        };
      });

      snapshot.forEach((doc) => {
        const data = doc.data();
        this.sessions.forEach((session) => {
          const statusField = `${session}_status`;
          const status = data[statusField];

          if (status) {
            stats[session].total++;
            stats[session][status]++;
          }
        });
      });

      return stats;
    } catch (error) {
      console.error('[AttendanceAnalytics] Error getting session stats:', error);
      return {};
    }
  }

  // Generate report card untuk user
  async generateReportCard(userId, month, year) {
    try {
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

      const user = await userManager.getUser(userId);
      const records = await this.getUserAttendanceDetail(userId, startDate, endDate);
      const stats = await remarksManager.getStatisticsWithRemarks(userId, startDate, endDate);

      return {
        user: user,
        month: month,
        year: year,
        period: `${startDate} - ${endDate}`,
        statistics: stats,
        records: records
      };
    } catch (error) {
      console.error('[AttendanceAnalytics] Error generating report card:', error);
      return null;
    }
  }

  // Get daily summary
  async getDailySummary(date) {
    try {
      const snapshot = await db.collection('attendance')
        .where('date', '==', date)
        .get();

      const summary = {};
      snapshot.forEach((doc) => {
        const data = doc.data();
        const userId = data.userId;
        
        summary[userId] = {
          userId: userId,
          email: data.email,
          date: date,
          sessions: {}
        };

        this.sessions.forEach((session) => {
          const statusField = `${session}_status`;
          summary[userId].sessions[session] = {
            attended: data[session] || false,
            status: data[statusField] || 'pending',
            remarks: data[`${session}_remarks`] || ''
          };
        });
      });

      return summary;
    } catch (error) {
      console.error('[AttendanceAnalytics] Error getting daily summary:', error);
      return {};
    }
  }

  // Get missing attendance (belum diisi)
  async getMissingAttendance(date) {
    try {
      const users = await userManager.loadAllUsers();
      const attendance = await this.getDailySummary(date);

      const missing = users.filter(user => !attendance[user.id]);
      return missing;
    } catch (error) {
      console.error('[AttendanceAnalytics] Error getting missing:', error);
      return [];
    }
  }
}

const attendanceAnalytics = new AttendanceAnalytics();

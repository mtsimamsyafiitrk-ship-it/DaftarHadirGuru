// Attendance Module - Advanced Attendance Features
class AttendanceModule {
  constructor() {
    this.attendanceData = [];
  }

  // Get attendance statistics
  async getStatistics(userId, startDate, endDate) {
    try {
      const snapshot = await db.collection('attendance')
        .where('userId', '==', userId)
        .where('date', '>=', startDate)
        .where('date', '<=', endDate)
        .get();

      const stats = {
        hadir: 0,
        izin: 0,
        sakit: 0,
        alpa: 0,
        total: 0
      };

      snapshot.forEach((doc) => {
        const data = doc.data();
        stats[data.status]++;
        stats.total++;
      });

      return stats;
    } catch (error) {
      console.error('[AttendanceModule] Error getting statistics:', error);
      return null;
    }
  }

  // Export attendance data
  async exportToCSV(userId) {
    try {
      const snapshot = await db.collection('attendance')
        .where('userId', '==', userId)
        .orderBy('date', 'asc')
        .get();

      let csv = 'Date,Status,Timestamp\n';
      snapshot.forEach((doc) => {
        const data = doc.data();
        csv += `${data.date},${data.status},${data.timestamp}\n`;
      });

      return csv;
    } catch (error) {
      console.error('[AttendanceModule] Error exporting CSV:', error);
      return null;
    }
  }

  // Get monthly summary
  async getMonthlySummary(userId, month, year) {
    try {
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

      const stats = await this.getStatistics(userId, startDate, endDate);
      return stats;
    } catch (error) {
      console.error('[AttendanceModule] Error getting monthly summary:', error);
      return null;
    }
  }
}

const attendanceModule = new AttendanceModule();

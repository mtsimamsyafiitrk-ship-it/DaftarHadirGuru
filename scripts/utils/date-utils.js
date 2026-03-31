// Date & Time Utilities
class DateUtils {
  static DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  static MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  static format(date, format = 'DD/MM/YYYY') { const d = new Date(date); const day = String(d.getDate()).padStart(2, '0'); const month = String(d.getMonth() + 1).padStart(2, '0'); const year = d.getFullYear(); return format.replace('DD', day).replace('MM', month).replace('YYYY', year); }
  static getDayName(date) { return this.DAYS[new Date(date).getDay()]; }
  static getMonthName(date) { return this.MONTHS[new Date(date).getMonth()]; }
  static today() { return this.format(new Date()); }
  static addDays(date, days) { const d = new Date(date); d.setDate(d.getDate() + days); return d; }
  static getDaysInRange(start, end) { const days = []; const current = new Date(start); while(current <= new Date(end)) { days.push(new Date(current)); current.setDate(current.getDate() + 1); } return days; }
}

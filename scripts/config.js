// Global application configuration

const config = {
    appInfo: {
        name: 'Attendance App',
        version: '1.0.0',
        description: 'Application for managing teacher attendance',
    },
    roles: [
        'admin',
        'teacher',
        'student'
    ],
    storageKeys: {
        userSettings: 'user_settings',
        attendanceData: 'attendance_data'
    },
    attendanceStatus: [
        'present',
        'absent',
        'late',
        'excused'
    ],
    sessions: {
        morning: '07:00 - 12:00',
        afternoon: '13:00 - 17:00'
    },
    daysOfWeek: [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday'
    ],
    months: [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December'
    ],
    timeouts: {
        sessionTimeout: 30, // in minutes
        idleTimeout: 15      // in minutes
    },
    validationRules: {
        required: 'This field is required',
        email: 'Invalid email address',
        minLength: (min) => `Minimum length is ${min} characters`
    },
    uiSettings: {
        theme: 'light',
        language: 'en'
    }
};

export default config;

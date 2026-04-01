# 📋 Firebase Migration Guide

## Overview
Migration script untuk memindahkan data dari struktur lama (att_xxx collections) ke struktur baru (users + attendance collections).

---

## 🎯 Apa yang akan di-migrate?

### ✅ Di-migrate:
1. **22 Pegawai** → Create user accounts
2. **Attendance History** → Migrate dari att_xxx ke attendance collection
3. **Default Schedules** → Create schedule untuk setiap user
4. **Backup** → Backup data lama

### ❌ Tidak di-migrate (dibuat baru):
1. Admin account (mtsimamsyafiitrk@gmail.com)
2. Jadwal custom (bisa di-edit via admin panel)
3. Keterangan (bisa di-set via admin panel)

---

## 📌 Langkah-Langkah Migrasi

### **STEP 1: Persiapan**
- ✅ Backup database lama (Firebase Console)
- ✅ Login sebagai admin (mtsimamsyafiitrk@gmail.com)
- ✅ Buka browser console (F12)

### **STEP 2: Jalankan Migration**
```javascript
// Di browser console, jalankan:
firebaseMigration.runFullMigration()
```

### **STEP 3: Tunggu Proses Selesai**
- Proses akan:
  1. Create 22 user accounts
  2. Migrate attendance records
  3. Create default schedules
  4. Backup data lama

- Waktu estimasi: **5-10 menit** (tergantung data size)

### **STEP 4: Verifikasi**
```javascript
// Check migration status
await firebaseMigration.getMigrationStatus()
```

Expected output:
```javascript
{
  totalUsers: 22,
  totalAttendanceRecords: ~500-1000,
  hasBackup: true
}
```

---

## 👥 Default User Credentials

Setelah migration, 22 user akan dibuat dengan:

| No. | Nama | Email | Password |
|-----|------|-------|----------|
| 1 | HARMIN, S.Pd. | harmin-spd@daftarhadir.local | TempPass123! |
| 2 | ADNAN ABDUL RASYID, S.T. | adnan-abdul-rasyid@daftarhadir.local | TempPass123! |
| ... | ... | ... | TempPass123! |
| 22 | ALFATH MUSYAHADAH, S.H. | alfath-musyahadah-sh@daftarhadir.local | TempPass123! |

**⚠️ PENTING:** Suruh user untuk change password saat first login!

---

## 📊 Struktur Data Setelah Migration

### Firestore Collections:

```
├── users/
│   ├── {uid1}
│   │   ├── uid
│   │   ├── name: "HARMIN, S.Pd."
│   │   ├── email: "harmin-spd@daftarhadir.local"
│   │   ├── role: "user"
│   │   ├── status: "active"
│   │   ├── createdAt: timestamp
│   │   └── createdBy: "migration-script"
│   │
│   └── {uid2}
│       └── ...
│
├── schedules/
│   ├── {uid1}
│   │   ├── senin: ["H1", "J1", "J2"]
│   │   ├── selasa: ["H2", "J1", "J2"]
│   │   └── ...
│   │
│   └── {uid2}
│       └── ...
│
├── attendance/
│   ├── {docId1}
│   │   ├── userId: "{uid1}"
│   │   ├── date: "2026-03-07"
│   │   ├── H1: true
│   │   ├── H1_status: "present"
│   │   ├── J1: false
│   │   ├── J1_status: "pending"
│   │   └── ...
│   │
│   └── {docId2}
│       └── ...
│
└── _backups/
    └── pre-migration-backup
        └── timestamp: ...
```

---

## ⚠️ PENTING: Security Rules

Setelah migration, pastikan update Firestore Security Rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Admin access
    match /users/{document=**} {
      allow read, write: if request.auth.uid == "admin-uid-here";
    }
    
    // User access (read own data)
    match /users/{uid} {
      allow read: if request.auth.uid == uid;
      allow write: if request.auth.uid == uid && !resource.data.role;
    }
    
    // Attendance (user read/write own, admin read all)
    match /attendance/{document=**} {
      allow read, write: if request.auth.uid == resource.data.userId;
      allow read: if isAdmin();
    }
    
    // Schedules (user read own, admin write)
    match /schedules/{uid} {
      allow read: if request.auth.uid == uid;
      allow write: if isAdmin();
    }
    
    function isAdmin() {
      return request.auth.token.email == 'mtsimamsyafiitrk@gmail.com';
    }
  }
}
```

---

## 🔍 Troubleshooting

### ❌ Error: "Only admin can run migration!"
- Login sebagai admin (mtsimamsyafiitrk@gmail.com)
- Refresh page
- Coba lagi

### ❌ Error: "User already exists"
- Migration boleh di-run berkali-kali (skip existing users)
- Bukan masalah serius

### ❌ Error: "quota exceeded"
- Firebase memiliki rate limit
- Tunggu beberapa jam
- Coba lagi

### ❌ Attendance data tidak ter-migrate
- Check apakah att_xxx collections ada data
- Check Firestore permissions
- Cek console untuk error details

---

## 📞 Support
Hubungi admin untuk bantuan: `mtsimamsyafiitrk@gmail.com`

---

## ✅ Checklist Setelah Migration

- [ ] Run migration script
- [ ] Verify status (22 users + attendance records)
- [ ] Update Firestore Security Rules
- [ ] Test login dengan salah satu user
- [ ] Test attendance check-in
- [ ] Test admin panel
- [ ] Inform semua user tentang default password
- [ ] Backup database (Firebase Console)
- [ ] Document migration date & status

---

**Migration completed! 🎉**

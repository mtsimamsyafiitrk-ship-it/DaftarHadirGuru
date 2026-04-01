// User Manager - Manage 22 pegawai (Admin Only)
class UserManager {
  constructor() {
    this.users = [];
  }

  // Load semua users dari Firestore
  async loadAllUsers() {
    try {
      const snapshot = await db.collection('users').get();
      this.users = [];
      snapshot.forEach((doc) => {
        this.users.push({
          id: doc.id,
          ...doc.data()
        });
      });
      console.log('[UserManager] Loaded', snapshot.size, 'users');
      return this.users;
    } catch (error) {
      console.error('[UserManager] Error loading users:', error);
      return [];
    }
  }

  // Create user baru (Admin only)
  async createUser(userData) {
    try {
      loader.show('Creating user...');
      
      // userData: { name, email, password, role }
      const email = userData.email;
      const password = userData.password || 'DefaultPass123'; // Default password
      const name = userData.name;
      const role = userData.role || 'user';

      // Validate
      if (!email || !name) {
        throw new Error('Email dan nama wajib diisi');
      }

      // Create Firebase Auth user
      const userCredential = await firebase.auth().createUserWithEmailAndPassword(email, password);
      const user = userCredential.user;

      // Set display name
      await user.updateProfile({
        displayName: name
      });

      // Create user document di Firestore
      const userId = user.uid;
      await db.collection('users').doc(userId).set({
        uid: userId,
        name: name,
        email: email,
        role: role,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: firebase.auth().currentUser.uid
      });

      // Create default schedule
      const defaultSchedule = scheduleManager.createDefaultSchedule();
      await db.collection('schedules').doc(userId).set(defaultSchedule);

      loader.hide();
      notification.success(`User ${name} berhasil dibuat!`);
      console.log('[UserManager] Created user:', name, email);
      
      return { success: true, userId: userId };
    } catch (error) {
      loader.hide();
      console.error('[UserManager] Error creating user:', error);
      
      let message = error.message;
      if (error.code === 'auth/email-already-in-use') {
        message = 'Email sudah terdaftar';
      }
      
      notification.error('Error: ' + message);
      return { success: false, message: message };
    }
  }

  // Update user
  async updateUser(userId, updateData) {
    try {
      loader.show('Updating user...');
      
      // updateData: { name, email, role }
      await db.collection('users').doc(userId).update({
        ...updateData,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: firebase.auth().currentUser.uid
      });

      loader.hide();
      notification.success('User berhasil diupdate!');
      console.log('[UserManager] Updated user:', userId);
      
      return { success: true };
    } catch (error) {
      loader.hide();
      console.error('[UserManager] Error updating user:', error);
      return { success: false, message: error.message };
    }
  }

  // Delete user
  async deleteUser(userId) {
    try {
      if (!confirm('Yakin ingin menghapus user ini?')) {
        return { success: false };
      }

      loader.show('Deleting user...');

      // Delete from Firestore
      await db.collection('users').doc(userId).delete();
      
      // Delete schedule
      await db.collection('schedules').doc(userId).delete();

      // Delete from Firebase Auth (optional - bisa via admin SDK)
      // Note: Cannot delete auth user from client SDK

      loader.hide();
      notification.success('User berhasil dihapus!');
      console.log('[UserManager] Deleted user:', userId);
      
      return { success: true };
    } catch (error) {
      loader.hide();
      console.error('[UserManager] Error deleting user:', error);
      return { success: false, message: error.message };
    }
  }

  // Reset password (Admin can reset)
  async resetPassword(userId, newPassword) {
    try {
      // Note: Can't reset password dari client SDK for other users
      // Admin harus use Firebase Admin SDK atau Console
      notification.warning('Reset password harus via Firebase Admin Console');
      return { success: false };
    } catch (error) {
      console.error('[UserManager] Error resetting password:', error);
      return { success: false };
    }
  }

  // Get user by ID
  async getUser(userId) {
    try {
      const doc = await db.collection('users').doc(userId).get();
      if (doc.exists) {
        return { id: doc.id, ...doc.data() };
      }
      return null;
    } catch (error) {
      console.error('[UserManager] Error getting user:', error);
      return null;
    }
  }

  // Search users
  searchUsers(query) {
    return this.users.filter(user => 
      user.name.toLowerCase().includes(query.toLowerCase()) ||
      user.email.toLowerCase().includes(query.toLowerCase())
    );
  }

  // Export users
  async exportUsers() {
    try {
      return await this.loadAllUsers();
    } catch (error) {
      console.error('[UserManager] Error exporting users:', error);
      return [];
    }
  }
}

const userManager = new UserManager();

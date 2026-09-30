/**
 * ========================================================
 * Chef Mama - Firebase Integration & Cloud Sync Engine
 * ========================================================
 * Menyediakan sinkronisasi cloud data pemain, skor tertinggi,
 * bintang resep, profil koki, dan papan peringkat (leaderboard)
 * dengan fallback otomatis ke LocalStorage jika offline/belum dikonfigurasi.
 */

// 1. TEMPATKAN KREDENSIAL FIREBASE ANDA DI SINI
// Ambil dari: Firebase Console -> Project Settings -> General -> Your apps -> Web app
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyD6uuoiIZFSpfZ4ovlttY7ySCsDeCd4pvU",
  authDomain: "fransiscaws-84b8a.firebaseapp.com",
  projectId: "fransiscaws-84b8a",
  storageBucket: "fransiscaws-84b8a.firebasestorage.app",
  messagingSenderId: "243010512562",
  appId: "1:243010512562:web:c7f12f475f2aea74578bab"
};

class FirebaseSyncEngine {
  constructor() {
    this.app = null;
    this.auth = null;
    this.db = null;
    this.currentUser = null;
    this.isCloudActive = false;
    this.statusMessage = "Mode Lokal (Offline)";
    
    // Load local cache
    this.localData = this.loadLocalCache();
  }

  loadLocalCache() {
    try {
      const raw = localStorage.getItem('chefmama_save_data');
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn("Gagal membaca localStorage:", e);
    }
    return {
      chefName: "Chef Gourmet #" + Math.floor(1000 + Math.random() * 9000),
      recipes: {},
      totalScore: 0,
      totalStars: 0,
      firebaseConfig: null
    };
  }

  saveLocalCache() {
    try {
      localStorage.setItem('chefmama_save_data', JSON.stringify(this.localData));
    } catch (e) {
      console.warn("Gagal menyimpan ke localStorage:", e);
    }
  }

  getActiveConfig() {
    // Utamakan konfigurasi yang tersimpan di localStorage (jika user input via modal),
    // atau DEFAULT_FIREBASE_CONFIG
    if (this.localData.firebaseConfig && this.localData.firebaseConfig.apiKey && this.localData.firebaseConfig.apiKey !== "YOUR_API_KEY") {
      return this.localData.firebaseConfig;
    }
    return DEFAULT_FIREBASE_CONFIG;
  }

  async init() {
    const config = this.getActiveConfig();

    // Cek apakah konfigurasi sudah valid (bukan placeholder "YOUR_API_KEY")
    const isConfigured = config && config.apiKey && config.apiKey !== "YOUR_API_KEY" && config.projectId && config.projectId !== "YOUR_PROJECT_ID";

    if (!isConfigured) {
      this.isCloudActive = false;
      this.statusMessage = "Mode Lokal (Offline)";
      console.log("ℹ️ Firebase belum dikonfigurasi. Menggunakan penyimpanan LocalStorage.");
      this.notifyListeners();
      return;
    }

    if (typeof firebase === 'undefined') {
      console.warn("SDK Firebase belum dimuat di HTML.");
      this.isCloudActive = false;
      this.statusMessage = "SDK Firebase Belum Siap";
      this.notifyListeners();
      return;
    }

    try {
      if (!firebase.apps.length) {
        this.app = firebase.initializeApp(config);
      } else {
        this.app = firebase.app();
      }

      this.auth = firebase.auth();
      this.db = firebase.firestore();

      // Login Anonim (memudahkan pemain tanpa perlu password)
      const userCredential = await this.auth.signInAnonymously();
      this.currentUser = userCredential.user;
      this.isCloudActive = true;
      this.statusMessage = "Cloud Terhubung (Online)";

      console.log("🔥 Firebase terhubung sebagai:", this.currentUser.uid);

      // Sinkronkan data profil dari / ke Cloud
      await this.syncWithCloud();
    } catch (err) {
      console.error("Gagal inisialisasi Firebase:", err);
      this.isCloudActive = false;
      this.statusMessage = "Koneksi Cloud Gagal";
    }

    this.notifyListeners();
  }

  async syncWithCloud() {
    if (!this.isCloudActive || !this.currentUser || !this.db) return;

    try {
      const userDocRef = this.db.collection('users').doc(this.currentUser.uid);
      const docSnap = await userDocRef.get();

      if (docSnap.exists) {
        const cloudData = docSnap.data();
        // Gabungkan data cloud ke data lokal (ambil nilai tertinggi)
        if (cloudData.chefName) {
          this.localData.chefName = cloudData.chefName;
        }

        if (cloudData.recipes) {
          for (const [recipeId, info] of Object.entries(cloudData.recipes)) {
            const currentLocal = this.localData.recipes[recipeId] || { highScore: 0, stars: 0, scorePct: 0 };
            this.localData.recipes[recipeId] = {
              highScore: Math.max(currentLocal.highScore || 0, info.highScore || 0),
              stars: Math.max(currentLocal.stars || 0, info.stars || 0),
              scorePct: Math.max(currentLocal.scorePct || 0, info.scorePct || 0),
              playCount: (currentLocal.playCount || 0) + (info.playCount || 0),
              badge: info.badge || currentLocal.badge
            };
          }
        }
        this.recalculateTotals();
        this.saveLocalCache();
      } else {
        // Dokumen baru untuk pemain ini di cloud
        await userDocRef.set({
          chefName: this.localData.chefName,
          recipes: this.localData.recipes,
          totalScore: this.localData.totalScore,
          totalStars: this.localData.totalStars,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastPlayed: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
    } catch (err) {
      console.warn("Gagal sinkron data cloud:", err);
    }
  }

  setChefName(name) {
    if (!name || !name.trim()) return;
    this.localData.chefName = name.trim();
    this.saveLocalCache();

    if (this.isCloudActive && this.currentUser && this.db) {
      this.db.collection('users').doc(this.currentUser.uid).set({
        chefName: this.localData.chefName,
        lastPlayed: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch(err => console.warn(err));
    }
    this.notifyListeners();
  }

  getChefName() {
    return this.localData.chefName || "Chef Koki";
  }

  getRecipeProgress(recipeId) {
    return this.localData.recipes[recipeId] || { highScore: 0, stars: 0, scorePct: 0, playCount: 0 };
  }

  recalculateTotals() {
    let score = 0;
    let stars = 0;
    Object.values(this.localData.recipes).forEach(r => {
      score += (r.highScore || 0);
      stars += (r.stars || 0);
    });
    this.localData.totalScore = score;
    this.localData.totalStars = stars;
  }

  async saveCookingResult({ recipeId, recipeName, score, scorePct, stars, verdict }) {
    const prev = this.localData.recipes[recipeId] || { highScore: 0, stars: 0, scorePct: 0, playCount: 0 };
    
    const isNewHighScore = score > prev.highScore;
    const isMoreStars = stars > prev.stars;

    const updatedRecipeData = {
      highScore: Math.max(prev.highScore, score),
      bestScorePct: Math.max(prev.scorePct || 0, scorePct),
      stars: Math.max(prev.stars, stars),
      playCount: (prev.playCount || 0) + 1,
      badge: verdict,
      lastPlayed: new Date().toISOString()
    };

    this.localData.recipes[recipeId] = updatedRecipeData;
    this.recalculateTotals();
    this.saveLocalCache();
    this.notifyListeners();

    // Simpan ke Firestore jika terhubung
    if (this.isCloudActive && this.currentUser && this.db) {
      try {
        const userRef = this.db.collection('users').doc(this.currentUser.uid);
        await userRef.set({
          chefName: this.localData.chefName,
          [`recipes.${recipeId}`]: updatedRecipeData,
          totalScore: this.localData.totalScore,
          totalStars: this.localData.totalStars,
          lastPlayed: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // Simpan juga ke Leaderboard Global jika skor tinggi
        const leaderRef = this.db.collection('leaderboard').doc(`${this.currentUser.uid}_${recipeId}`);
        await leaderRef.set({
          uid: this.currentUser.uid,
          chefName: this.localData.chefName,
          recipeId: recipeId,
          recipeName: recipeName,
          score: updatedRecipeData.highScore,
          stars: updatedRecipeData.stars,
          scorePct: updatedRecipeData.bestScorePct,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.log("☁️ Skor berhasil disinkronkan ke Cloud Firestore!");
      } catch (err) {
        console.warn("Gagal menyimpan ke Firestore:", err);
      }
    }

    return { isNewHighScore, isMoreStars };
  }

  async fetchLeaderboard(limitCount = 10) {
    if (!this.isCloudActive || !this.db) {
      return [];
    }

    try {
      const snap = await this.db.collection('leaderboard')
        .orderBy('score', 'desc')
        .limit(limitCount)
        .get();

      const list = [];
      snap.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() });
      });
      return list;
    } catch (err) {
      console.warn("Gagal mengambil leaderboard:", err);
      return [];
    }
  }

  saveCustomConfig(newConfig) {
    this.localData.firebaseConfig = newConfig;
    this.saveLocalCache();
    // Restart koneksi
    return this.init();
  }

  listeners = [];
  onStatusChange(fn) {
    this.listeners.push(fn);
    fn(this);
  }

  notifyListeners() {
    this.listeners.forEach(fn => {
      try { fn(this); } catch (e) { console.error(e); }
    });
  }
}

// Inisialisasi Singleton
window.FirebaseSync = new FirebaseSyncEngine();

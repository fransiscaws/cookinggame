/**
 * ========================================================
 * Chef Mama - Firebase Integration & Local/Cloud Sync Engine
 * ========================================================
 * Sistem penyimpanan lengkap: Nama Koki, Total Poin, 
 * Papan Peringkat (Leaderboard) Lokal & Cloud, serta
 * status penyimpanan otomatis & manual (LocalStorage + Firestore).
 */

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyD6uuoiIZFSpfZ4ovlttY7ySCsDeCd4pvU",
  authDomain: "fransiscaws-84b8a.firebaseapp.com",
  projectId: "fransiscaws-84b8a",
  storageBucket: "fransiscaws-84b8a.firebasestorage.app",
  messagingSenderId: "243010512562",
  appId: "1:243010512562:web:c7f12f475f2aea74578bab"
};

// Daftar koki penantang bawaan untuk papan peringkat kompetitif
const DEFAULT_RIVAL_CHEFS = [
  { id: "rival_mama", chefName: "Chef Mama 🌟", recipeName: "All Star Gourmet", score: 2850, stars: 3, scorePct: 100, isPlayer: false, badge: "Master Chef" },
  { id: "rival_gordon", chefName: "Chef Gordon 🔥", recipeName: "Truffle Wagyu Smash Burger", score: 2420, stars: 3, scorePct: 98, isPlayer: false, badge: "Head Chef" },
  { id: "rival_arnold", chefName: "Chef Arnold 🍳", recipeName: "Fluffy Matcha Soufflé", score: 2150, stars: 3, scorePct: 96, isPlayer: false, badge: "Head Chef" },
  { id: "rival_renatta", chefName: "Chef Renatta 🥗", recipeName: "Artisan Avocado Toast", score: 1880, stars: 3, scorePct: 94, isPlayer: false, badge: "Sous Chef" },
  { id: "rival_juna", chefName: "Chef Juna 🌶️", recipeName: "Rainbow Salmon Poke Bowl", score: 1650, stars: 2, scorePct: 90, isPlayer: false, badge: "Sous Chef" },
  { id: "rival_sanji", chefName: "Chef Sanji 🍱", recipeName: "Artisan Toast & Egg", score: 1390, stars: 2, scorePct: 88, isPlayer: false, badge: "Koki Junior" },
  { id: "rival_devina", chefName: "Chef Devina 🍰", recipeName: "Japanese Soufflé", score: 1150, stars: 2, scorePct: 85, isPlayer: false, badge: "Koki Junior" },
  { id: "rival_budi", chefName: "Chef Budi 🥑", recipeName: "Truffle Burger", score: 850, stars: 1, scorePct: 75, isPlayer: false, badge: "Koki Magang" }
];

class FirebaseSyncEngine {
  constructor() {
    this.app = null;
    this.auth = null;
    this.db = null;
    this.currentUser = null;
    this.isCloudActive = false;
    this.statusMessage = "Mode Penyimpanan Lokal (LocalStorage)";
    this.listeners = [];
    
    // Inisialisasi cache lokal
    this.localData = this.loadLocalCache();
  }

  loadLocalCache() {
    try {
      const raw = localStorage.getItem('chefmama_save_data');
      if (raw) {
        const parsed = JSON.parse(raw);
        // Pastikan struktur lengkap
        if (!parsed.chefName) parsed.chefName = "Chef Pemula";
        if (!parsed.recipes) parsed.recipes = {};
        if (typeof parsed.totalScore !== 'number') parsed.totalScore = 0;
        if (typeof parsed.totalStars !== 'number') parsed.totalStars = 0;
        if (!Array.isArray(parsed.localLeaderboard) || parsed.localLeaderboard.length === 0) {
          parsed.localLeaderboard = this.generateInitialLeaderboard(parsed.chefName, parsed.totalScore);
        }
        if (!parsed.lastSaved) parsed.lastSaved = new Date().toISOString();
        return parsed;
      }
    } catch (e) {
      console.warn("Gagal membaca localStorage:", e);
    }

    const defaultName = "Chef " + ["Gourmet", "Bintang", "Handal", "Kreatif", "Cilik"][Math.floor(Math.random() * 5)];
    return {
      chefName: defaultName,
      recipes: {},
      totalScore: 0,
      totalStars: 0,
      lastSaved: new Date().toISOString(),
      localLeaderboard: this.generateInitialLeaderboard(defaultName, 0),
      firebaseConfig: null
    };
  }

  generateInitialLeaderboard(playerName, playerScore) {
    const list = [...DEFAULT_RIVAL_CHEFS];
    // Masukkan entri pemain awal
    list.push({
      id: "player_main",
      chefName: playerName,
      recipeName: "Total Rekor Koki",
      score: playerScore || 0,
      stars: 1,
      scorePct: 70,
      isPlayer: true,
      badge: "Koki Magang"
    });
    list.sort((a, b) => b.score - a.score);
    return list;
  }

  saveLocalCache() {
    try {
      this.localData.lastSaved = new Date().toISOString();
      localStorage.setItem('chefmama_save_data', JSON.stringify(this.localData));
    } catch (e) {
      console.warn("Gagal menyimpan ke localStorage:", e);
    }
  }

  getActiveConfig() {
    if (this.localData.firebaseConfig && this.localData.firebaseConfig.apiKey && this.localData.firebaseConfig.apiKey !== "YOUR_API_KEY") {
      return this.localData.firebaseConfig;
    }
    return DEFAULT_FIREBASE_CONFIG;
  }

  async init() {
    const config = this.getActiveConfig();
    const isConfigured = config && config.apiKey && config.apiKey !== "YOUR_API_KEY" && config.projectId && config.projectId !== "YOUR_PROJECT_ID";

    if (!isConfigured) {
      this.isCloudActive = false;
      this.statusMessage = "Penyimpanan Lokal Aktif (Offline)";
      this.notifyListeners();
      return;
    }

    if (typeof firebase === 'undefined') {
      this.isCloudActive = false;
      this.statusMessage = "Penyimpanan Lokal (SDK Firebase Belum Dimuat)";
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
      this.statusMessage = "Cloud Firebase Terhubung (Online)";

      console.log("🔥 Firebase terhubung sebagai:", this.currentUser.uid);
      await this.syncWithCloud();
    } catch (err) {
      console.warn("Koneksi Firebase Cloud tidak dapat terhubung, melanjutkan mode lokal aman:", err.message);
      this.isCloudActive = false;
      this.statusMessage = "Mode Penyimpanan Lokal (Offline)";
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
        if (cloudData.chefName && cloudData.chefName !== "Chef Koki") {
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
        this.updatePlayerInLeaderboard();
        this.saveLocalCache();
      } else {
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
      console.warn("Gagal sinkron data cloud, tetap menggunakan data lokal:", err);
    }
  }

  // Mengubah & menyimpan nama koki
  setChefName(name) {
    if (!name || !name.trim()) return;
    const cleanName = name.trim();
    this.localData.chefName = cleanName;

    // Perbarui nama di entri papan peringkat lokal
    this.updatePlayerInLeaderboard();
    this.saveLocalCache();

    // Perbarui ke cloud jika online
    if (this.isCloudActive && this.currentUser && this.db) {
      this.db.collection('users').doc(this.currentUser.uid).set({
        chefName: cleanName,
        lastPlayed: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch(err => console.warn(err));
    }

    this.notifyListeners();
    return cleanName;
  }

  getChefName() {
    return this.localData.chefName || "Chef Gourmet";
  }

  getTotalScore() {
    return this.localData.totalScore || 0;
  }

  getTotalStars() {
    return this.localData.totalStars || 0;
  }

  getRecipeProgress(recipeId) {
    return this.localData.recipes[recipeId] || { highScore: 0, stars: 0, scorePct: 0, playCount: 0 };
  }

  // Menghitung gelar & tingkatan koki berdasarkan total poin
  getChefRankInfo() {
    const score = this.getTotalScore();
    let title = "🍳 Koki Magang";
    let icon = "🍳";
    let nextThreshold = 400;
    let minThreshold = 0;

    if (score >= 2500) {
      title = "👑 Master Chef Bintang 5";
      icon = "👑";
      nextThreshold = 3500;
      minThreshold = 2500;
    } else if (score >= 1600) {
      title = "⭐ Head Chef Bintang 2";
      icon = "⭐";
      nextThreshold = 2500;
      minThreshold = 1600;
    } else if (score >= 900) {
      title = "👨‍🍳 Sous Chef Berbakat";
      icon = "👨‍🍳";
      nextThreshold = 1600;
      minThreshold = 900;
    } else if (score >= 400) {
      title = "🔪 Koki Junior";
      icon = "🔪";
      nextThreshold = 900;
      minThreshold = 400;
    }

    const progressPct = nextThreshold 
      ? Math.min(100, Math.round(((score - minThreshold) / (nextThreshold - minThreshold)) * 100))
      : 100;

    // Tentukan posisi peringkat di leaderboard lokal
    const rankPos = this.getPlayerRankPosition();

    return {
      title,
      icon,
      score,
      nextThreshold,
      progressPct: Math.max(5, progressPct),
      rankPos
    };
  }

  getPlayerRankPosition() {
    const list = this.getLocalLeaderboard();
    const idx = list.findIndex(item => item.isPlayer);
    return idx >= 0 ? idx + 1 : list.length;
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

  updatePlayerInLeaderboard() {
    if (!this.localData.localLeaderboard) {
      this.localData.localLeaderboard = this.generateInitialLeaderboard(this.localData.chefName, this.localData.totalScore);
    }

    const playerName = this.localData.chefName;
    const totalScore = this.localData.totalScore;
    const rankInfo = this.getChefRankInfo();

    // Perbarui entri utama pemain
    let playerEntry = this.localData.localLeaderboard.find(item => item.isPlayer && item.id === "player_main");
    if (!playerEntry) {
      playerEntry = {
        id: "player_main",
        chefName: playerName,
        recipeName: "Total Rekor Koki",
        score: totalScore,
        stars: this.localData.totalStars,
        scorePct: 95,
        isPlayer: true,
        badge: rankInfo.title
      };
      this.localData.localLeaderboard.push(playerEntry);
    } else {
      playerEntry.chefName = playerName;
      playerEntry.score = totalScore;
      playerEntry.stars = this.localData.totalStars;
      playerEntry.badge = rankInfo.title;
    }

    // Perbarui nama di entri resep pemain lainnya jika ada
    this.localData.localLeaderboard.forEach(item => {
      if (item.isPlayer) {
        item.chefName = playerName;
      }
    });

    // Urutkan kembali berdasarkan skor tertinggi
    this.localData.localLeaderboard.sort((a, b) => b.score - a.score);
  }

  // Simpan hasil memasak
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

    // Tambah / Perbarui entri resep ini di leaderboard lokal
    const recipeEntryId = `player_${recipeId}`;
    let recipeEntry = this.localData.localLeaderboard.find(item => item.id === recipeEntryId);
    if (!recipeEntry) {
      this.localData.localLeaderboard.push({
        id: recipeEntryId,
        chefName: this.localData.chefName,
        recipeName: recipeName,
        score: updatedRecipeData.highScore,
        stars: updatedRecipeData.stars,
        scorePct: updatedRecipeData.bestScorePct,
        isPlayer: true,
        badge: verdict
      });
    } else {
      recipeEntry.chefName = this.localData.chefName;
      recipeEntry.score = updatedRecipeData.highScore;
      recipeEntry.stars = updatedRecipeData.stars;
      recipeEntry.scorePct = updatedRecipeData.bestScorePct;
      recipeEntry.badge = verdict;
    }

    this.updatePlayerInLeaderboard();
    this.saveLocalCache();
    this.notifyListeners();

    // Simpan ke Firestore jika aktif
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
      } catch (err) {
        console.warn("Gagal menyimpan ke Firestore, data lokal tetap aman:", err);
      }
    }

    const rankPos = this.getPlayerRankPosition();
    return {
      isNewHighScore,
      isMoreStars,
      totalScore: this.localData.totalScore,
      rankPos
    };
  }

  // Dapatkan Papan Peringkat Lokal
  getLocalLeaderboard(limitCount = 10) {
    if (!this.localData.localLeaderboard) {
      this.localData.localLeaderboard = this.generateInitialLeaderboard(this.localData.chefName, this.localData.totalScore);
    }
    // Urutkan skor tertinggi
    const sorted = [...this.localData.localLeaderboard].sort((a, b) => b.score - a.score);
    return sorted.slice(0, limitCount);
  }

  // Dapatkan Papan Peringkat (Cloud dengan fallback ke Lokal)
  async fetchLeaderboard(limitCount = 10) {
    if (this.isCloudActive && this.db) {
      try {
        const snap = await this.db.collection('leaderboard')
          .orderBy('score', 'desc')
          .limit(limitCount)
          .get();

        if (!snap.empty) {
          const list = [];
          snap.forEach(doc => {
            const data = doc.data();
            list.push({
              id: doc.id,
              ...data,
              isPlayer: (this.currentUser && data.uid === this.currentUser.uid) || (data.chefName === this.localData.chefName)
            });
          });
          if (list.length > 0) return list;
        }
      } catch (err) {
        console.warn("Koneksi Firestore gagal mengambil leaderboard, menggunakan lokal:", err);
      }
    }

    // Fallback otomatis ke Papan Peringkat Lokal
    return this.getLocalLeaderboard(limitCount);
  }

  // Simpan manual dengan feedback langsung
  manualSave() {
    this.saveLocalCache();
    if (this.isCloudActive && this.currentUser && this.db) {
      this.syncWithCloud();
    }
    this.notifyListeners();
    return {
      success: true,
      timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      totalScore: this.localData.totalScore,
      chefName: this.localData.chefName,
      isCloud: this.isCloudActive
    };
  }

  getLastSavedTime() {
    if (!this.localData.lastSaved) return "Baru saja";
    try {
      const d = new Date(this.localData.lastSaved);
      return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return "Tersimpan";
    }
  }

  // Reset data (jika pemain ingin mengulang dari 0)
  resetSaveData() {
    localStorage.removeItem('chefmama_save_data');
    this.localData = this.loadLocalCache();
    this.notifyListeners();
    return true;
  }

  saveCustomConfig(newConfig) {
    this.localData.firebaseConfig = newConfig;
    this.saveLocalCache();
    return this.init();
  }

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

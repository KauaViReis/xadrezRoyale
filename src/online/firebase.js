/* ============================================================
   XADREZ ROYALE — Modo Online (Firebase Auth + Firestore)
   Coleções prefixadas (chess_*) + Regra VIP (elkaua1227@gmail.com)
   ============================================================ */

import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, signInAnonymously,
  GoogleAuthProvider, linkWithPopup, linkWithRedirect,
  getRedirectResult, signInWithCredential
} from 'firebase/auth';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, query, where, orderBy, limit, getDocs,
  onSnapshot, runTransaction, arrayUnion, serverTimestamp
} from 'firebase/firestore';
import { RATING_INICIAL, eloDelta } from '../core/elo.js';

const VIP_EMAIL = 'elkaua1227@gmail.com';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || ''
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('COLE_')
);

export class OnlineManager {
  constructor() {
    this.ready = false;
    this.uid = null;
    this.user = null;
    this.profile = null;
    this.auth = null;
    this.db = null;
    this.game = null;
    this.unsubGame = null;
    this.unsubLobby = null;
    this.hbTimer = null;
    this.presenceTimer = null;
    this.searchTimer = null;
    this.searchStart = 0;
    this.appliedMoves = 0;
    this.rated = false;

    this.onMatchFound = null;
    this.onOpponentMove = null;
    this.onGameEnd = null;
    this.onRated = null;
    this.onDrawOffer = null;
    this.onPresence = null;
    this.onSearchBand = null;
  }

  isVipDev() {
    const email = (this.user?.email || this.profile?.email || '').toLowerCase();
    return email === VIP_EMAIL || this.profile?.dev === true;
  }

  async init(nick = 'JOGADOR') {
    if (!isFirebaseConfigured) return false;
    try {
      const app = initializeApp(firebaseConfig);
      this.auth = getAuth(app);
      this.db = getFirestore(app);

      await new Promise(res => {
        const stop = onAuthStateChanged(this.auth, () => { stop(); res(); });
      });
      if (!this.auth.currentUser) await signInAnonymously(this.auth);

      let cameFromGoogle = false;
      try {
        const result = await getRedirectResult(this.auth);
        if (result && result.user) {
          this.user = result.user;
          this.uid = result.user.uid;
          cameFromGoogle = true;
          await this._loadProfile(null);
          await this._syncGoogleInfo(result.user);
        }
      } catch (e) {
        if (e.code === 'auth/credential-already-in-use') {
          const cred = GoogleAuthProvider.credentialFromError(e);
          if (cred) {
            const res = await signInWithCredential(this.auth, cred);
            this.user = res.user;
            this.uid = res.user.uid;
            cameFromGoogle = true;
            await this._loadProfile(null);
            await this._syncGoogleInfo(res.user);
          }
        }
      }

      this.user = this.auth.currentUser;
      this.uid = this.user.uid;
      if (!cameFromGoogle) await this._loadProfile(nick);
      this.ready = true;
      return true;
    } catch (e) {
      console.error('Falha ao iniciar Firebase:', e);
      return false;
    }
  }

  _defaultProfile(nick) {
    return {
      name: nick || 'JOGADOR',
      rating: RATING_INICIAL,
      wins: 0,
      losses: 0,
      draws: 0,
      games: 0,
      photoURL: null,
      email: null,
      google: false,
      dev: false
    };
  }

  async _loadProfile(nick) {
    const ref = doc(this.db, 'chess_players', this.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      this.profile = { ...this._defaultProfile(nick), ...snap.data() };
      if (nick && nick !== this.profile.name && !this.profile.google) {
        await this.setName(nick);
      }
    } else {
      this.profile = this._defaultProfile(nick);
      await setDoc(ref, { ...this.profile, createdAt: serverTimestamp() });
    }
  }

  async setName(name) {
    if (!this.profile || !this.db) return;
    this.profile.name = name;
    await updateDoc(doc(this.db, 'chess_players', this.uid), { name }).catch(() => {});
  }

  async linkGoogle() {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      const result = await linkWithPopup(this.auth.currentUser, provider);
      if (result && result.user) {
        this.user = result.user;
        this.uid = result.user.uid;
        await this._loadProfile(null);
        await this._syncGoogleInfo(result.user);
      }
      return { linked: true, msg: '✓ Conta Google conectada — progresso salvo' };
    } catch (e) {
      if (e.code === 'auth/credential-already-in-use') {
        const cred = GoogleAuthProvider.credentialFromError(e);
        if (cred) {
          const res = await signInWithCredential(this.auth, cred);
          this.user = res.user;
          this.uid = res.user.uid;
          await this._loadProfile(null);
          await this._syncGoogleInfo(res.user);
          return { linked: true, msg: 'Bem-vindo de volta! Conta Google carregada' };
        }
      }
      if (e.code === 'auth/popup-blocked') {
        await linkWithRedirect(this.auth.currentUser, provider);
        return { redirected: true };
      }
      throw e;
    }
  }

  async _syncGoogleInfo(user) {
    const photoURL = user.photoURL || null;
    const email = user.email || null;
    this.profile.photoURL = photoURL;
    this.profile.email = email;
    this.profile.google = true;
    await updateDoc(doc(this.db, 'chess_players', this.uid), {
      photoURL,
      email,
      google: true
    }).catch(() => {});
  }

  _me() {
    return {
      uid: this.uid,
      name: this.profile.name,
      rating: this.profile.rating,
      photoURL: this.profile.photoURL || null
    };
  }

  _newGameDoc(white, black, status, tc) {
    tc = tc || { base: 300000, inc: 0, label: '5+0' };
    return {
      status,
      white,
      black,
      moves: [],
      drawOffer: null,
      winner: null,
      reason: null,
      hbWhite: Date.now(),
      hbBlack: Date.now(),
      tc,
      clockW: tc.base,
      clockB: tc.base,
      turnStartedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    };
  }

  async quickMatch(tc) {
    this.searchStart = Date.now();
    const myRef = doc(this.db, 'chess_lobby', this.uid);
    await setDoc(myRef, {
      ...this._me(),
      tc: tc || { base: 300000, inc: 0, label: '5+0' },
      gameId: null,
      createdAt: serverTimestamp()
    });
    this.unsubLobby = onSnapshot(myRef, s => {
      const v = s.data();
      if (v && v.gameId && !this.game) {
        this._stopSearch();
        deleteDoc(myRef).catch(() => {});
        this._attachGame(v.gameId, 'w');
      }
    });
    this._scanLobby(tc);
    this.searchTimer = setInterval(() => this._scanLobby(tc), 4000);
  }

  _searchBand() {
    const sec = (Date.now() - this.searchStart) / 1000;
    if (sec >= 20) return Infinity;
    return 150 + Math.floor(sec / 5) * 100;
  }

  async _scanLobby(myTc) {
    if (this.game || !this.unsubLobby) return;
    const band = this._searchBand();
    if (this.onSearchBand) this.onSearchBand(band);
    let snap;
    try {
      snap = await getDocs(query(collection(this.db, 'chess_lobby'), orderBy('createdAt'), limit(15)));
    } catch { return; }

    const myRef = doc(this.db, 'chess_lobby', this.uid);
    for (const d of snap.docs) {
      const e = d.data();
      if (e.uid === this.uid || e.gameId) continue;
      if (myTc && e.tc && e.tc.label !== myTc.label) continue;
      if (band !== Infinity && Math.abs((e.rating || RATING_INICIAL) - this.profile.rating) > band) continue;

      const gameId = this._randomId(10);
      try {
        let matchedId = null;
        await runTransaction(this.db, async tx => {
          const mine = await tx.get(myRef);
          if (mine.exists() && mine.data().gameId) {
            matchedId = mine.data().gameId;
            return;
          }
          const fresh = await tx.get(d.ref);
          if (!fresh.exists() || fresh.data().gameId) throw new Error('busy');
          const host = fresh.data();
          tx.set(doc(this.db, 'chess_games', gameId), this._newGameDoc(
            { uid: host.uid, name: host.name, rating: host.rating, photoURL: host.photoURL || null },
            this._me(),
            'active',
            host.tc
          ));
          tx.update(d.ref, { gameId });
          tx.delete(myRef);
        });
        if (this.game) return;
        this._stopSearch();
        if (matchedId) {
          deleteDoc(myRef).catch(() => {});
          this._attachGame(matchedId, 'w');
        } else {
          this._attachGame(gameId, 'b');
        }
        return;
      } catch { /* candidato ocupado */ }
    }
  }

  async cancelSearch() {
    this._stopSearch();
    if (this.db && this.uid) {
      await deleteDoc(doc(this.db, 'chess_lobby', this.uid)).catch(() => {});
    }
  }

  _stopSearch() {
    if (this.unsubLobby) { this.unsubLobby(); this.unsubLobby = null; }
    if (this.searchTimer) { clearInterval(this.searchTimer); this.searchTimer = null; }
  }

  async createRoom(tc) {
    const code = this._randomId(6);
    await setDoc(doc(this.db, 'chess_games', code), this._newGameDoc(this._me(), null, 'waiting', tc));
    this._attachGame(code, 'w');
    return code;
  }

  async joinRoom(code) {
    code = (code || '').trim().toUpperCase();
    if (!code) throw new Error('INFORME O CÓDIGO DA SALA');
    const ref = doc(this.db, 'chess_games', code);
    await runTransaction(this.db, async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('SALA NÃO ENCONTRADA');
      const g = snap.data();
      if (g.status !== 'waiting') throw new Error('SALA JÁ ESTÁ CHEIA');
      if (g.white.uid === this.uid) throw new Error('VOCÊ CRIOU ESTA SALA');
      tx.update(ref, {
        black: this._me(),
        status: 'active',
        hbBlack: Date.now(),
        turnStartedAt: serverTimestamp()
      });
    });
    this._attachGame(code, 'b');
  }

  _attachGame(gameId, myColor) {
    this._detachGame();
    this.appliedMoves = 0;
    this.rated = false;
    const ref = doc(this.db, 'chess_games', gameId);
    this.game = { id: gameId, ref, myColor, data: null, started: false, lastOppHb: null, lastOppSeen: Date.now() };

    this.unsubGame = onSnapshot(ref, snap => {
      if (!snap.exists() || !this.game) return;
      const g = snap.data();
      this.game.data = g;

      if (!this.game.started && g.status !== 'waiting') {
        this.game.started = true;
        this._startHeartbeat();
        const opponent = myColor === 'b' ? g.white : g.black;
        if (this.onMatchFound) {
          this.onMatchFound({
            myColor,
            opponent,
            code: gameId,
            moves: (g.moves || []).map(s => JSON.parse(s)),
            data: g
          });
        }
      }

      const moves = g.moves || [];
      while (this.appliedMoves < moves.length) {
        const entry = JSON.parse(moves[this.appliedMoves]);
        this.appliedMoves++;
        if (entry.by !== this.uid && this.onOpponentMove) {
          this.onOpponentMove(entry);
        }
      }

      if (g.status === 'active' && g.drawOffer && g.drawOffer !== this.uid && this.onDrawOffer) {
        this.onDrawOffer();
      }

      const oppHb = myColor === 'w' ? g.hbBlack : g.hbWhite;
      if (oppHb !== this.game.lastOppHb) {
        this.game.lastOppHb = oppHb;
        this.game.lastOppSeen = Date.now();
      }

      if (g.status === 'finished' && !this.rated) {
        this.rated = true;
        this._applyRating(g);
        this._saveMatchHistory(gameId, g);
        this._stopTimers();
        if (this.onGameEnd) this.onGameEnd(g.winner, g.reason);
      }
    });

    this.presenceTimer = setInterval(() => {
      if (!this.game || !this.game.started) return;
      if (this.game.data && this.game.data.status !== 'active') return;
      if (this.onPresence) this.onPresence(Math.floor((Date.now() - this.game.lastOppSeen) / 1000));
    }, 1000);
  }

  _startHeartbeat() {
    const field = this.game.myColor === 'w' ? 'hbWhite' : 'hbBlack';
    const beat = () => {
      if (!this.game || !this.game.data || this.game.data.status !== 'active') return;
      updateDoc(this.game.ref, { [field]: Date.now() }).catch(() => {});
    };
    beat();
    this.hbTimer = setInterval(beat, 20000);
  }

  _stopTimers() {
    if (this.hbTimer) { clearInterval(this.hbTimer); this.hbTimer = null; }
    if (this.presenceTimer) { clearInterval(this.presenceTimer); this.presenceTimer = null; }
  }

  _detachGame() {
    this._stopTimers();
    if (this.unsubGame) { this.unsubGame(); this.unsubGame = null; }
    this.game = null;
  }

  async sendMove(moveObj, myClockMs = null) {
    if (!this.game || !this.game.data) return;
    const n = (this.game.data.moves || []).length;
    const upd = {
      moves: arrayUnion(JSON.stringify({ n, by: this.uid, from: moveObj.from, to: moveObj.to, promotion: moveObj.promotion || null })),
      drawOffer: null,
      turnStartedAt: serverTimestamp()
    };
    if (myClockMs !== null) {
      upd[this.game.myColor === 'w' ? 'clockW' : 'clockB'] = Math.max(0, Math.round(myClockMs));
    }
    await updateDoc(this.game.ref, upd).catch(() => {});
  }

  async finishGame(winner, reason) {
    if (!this.game || !this.game.data || this.game.data.status === 'finished') return;
    await updateDoc(this.game.ref, { status: 'finished', winner, reason }).catch(() => {});
  }

  resign() {
    if (!this.game) return Promise.resolve();
    return this.finishGame(this.game.myColor === 'w' ? 'b' : 'w', 'resign');
  }

  claimTimeout() {
    if (!this.game) return Promise.resolve();
    return this.finishGame(this.game.myColor, 'timeout');
  }

  async offerDraw() {
    if (!this.game) return;
    await updateDoc(this.game.ref, { drawOffer: this.uid }).catch(() => {});
  }

  async respondDraw(accept) {
    if (!this.game) return;
    if (accept) await this.finishGame('draw', 'draw');
    else await updateDoc(this.game.ref, { drawOffer: null }).catch(() => {});
  }

  async leaveGame() {
    if (this.game && this.game.data && this.game.data.status === 'active') {
      await this.resign();
    }
    this._detachGame();
  }

  async _applyRating(g) {
    if (!g.white || !g.black) return;
    const myColor = this.game.myColor;
    const opp = myColor === 'w' ? g.black : g.white;
    const score = g.winner === 'draw' ? 0.5 : (g.winner === myColor ? 1 : 0);
    const delta = eloDelta(this.profile.rating, opp.rating, score, this.profile.games);

    const p = this.profile;
    p.rating += delta;
    p.games += 1;
    if (score === 1) p.wins++;
    else if (score === 0) p.losses++;
    else p.draws++;

    await updateDoc(doc(this.db, 'chess_players', this.uid), {
      rating: p.rating,
      games: p.games,
      wins: p.wins,
      losses: p.losses,
      draws: p.draws
    }).catch(() => {});
    if (this.onRated) this.onRated(delta, p.rating);
  }

  async _saveMatchHistory(gameId, g) {
    if (!g.white || !g.black) return;
    await setDoc(doc(this.db, 'chess_match_history', gameId), {
      players: [g.white.uid, g.black.uid],
      white: g.white,
      black: g.black,
      winner: g.winner,
      reason: g.reason || 'game',
      moves: g.moves || [],
      tc: g.tc || null,
      endedAtMs: Date.now(),
      endedAt: serverTimestamp()
    }, { merge: true }).catch(() => {});
  }

  async leaderboard(top = 10) {
    const snap = await getDocs(query(collection(this.db, 'chess_players'), where('google', '==', true), limit(100)));
    return snap.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, top);
  }

  _randomId(len) {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < len; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }
}

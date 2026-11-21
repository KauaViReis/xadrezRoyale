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
      chat: [],
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

  /* ============ TV XADREZ ROYALE (ESPECTADOR AO VIVO) ============ */
  async listActiveGames(top = 15) {
    if (!this.ready || !this.db) return [];
    const snap = await getDocs(query(collection(this.db, 'chess_games'), where('status', '==', 'active'), limit(top)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(g => g.white && g.black);
  }

  spectateGame(gameId) {
    this._attachGame(gameId, 'w', { spectate: true });
  }

  _attachGame(gameId, myColor, opts = {}) {
    this._detachGame();
    this.appliedMoves = 0;
    this.appliedChat = 0;
    this.rated = false;
    const ref = doc(this.db, 'chess_games', gameId);
    this.game = {
      id: gameId,
      ref,
      myColor,
      spectate: !!opts.spectate,
      data: null,
      started: false,
      lastOppHb: null,
      lastOppSeen: Date.now(),
      rematchJoined: false
    };

    this.unsubGame = onSnapshot(ref, snap => {
      if (!snap.exists() || !this.game) return;
      const g = snap.data();
      this.game.data = g;

      if (!this.game.started && g.status !== 'waiting') {
        this.game.started = true;
        if (!this.game.spectate) this._startHeartbeat();
        const opponent = myColor === 'b' ? g.white : g.black;
        if (this.onMatchFound) {
          this.onMatchFound({
            myColor,
            opponent,
            code: gameId,
            spectate: this.game.spectate,
            moves: (g.moves || []).map(s => JSON.parse(s)),
            data: g
          });
        }
      }

      const moves = g.moves || [];
      while (this.appliedMoves < moves.length) {
        const entry = JSON.parse(moves[this.appliedMoves]);
        this.appliedMoves++;
        if ((this.game.spectate || entry.by !== this.uid) && this.onOpponentMove) {
          this.onOpponentMove(entry);
        }
      }

      const chat = g.chat || [];
      while (this.appliedChat < chat.length) {
        try {
          const msg = JSON.parse(chat[this.appliedChat]);
          if (this.onChatMessage) this.onChatMessage(msg, msg.by === this.uid);
        } catch { /* noop */ }
        this.appliedChat++;
      }

      if (g.status === 'active' && g.drawOffer && g.drawOffer !== this.uid && !this.game.spectate && this.onDrawOffer) {
        this.onDrawOffer();
      }

      const oppHb = myColor === 'w' ? g.hbBlack : g.hbWhite;
      if (oppHb !== this.game.lastOppHb) {
        this.game.lastOppHb = oppHb;
        this.game.lastOppSeen = Date.now();
      }

      if (g.status === 'finished' && !this.rated) {
        this.rated = true;
        if (!this.game.spectate) {
          this._applyRating(g);
          this._saveMatchHistory(gameId, g);
        }
        this._stopTimers();
        if (this.onGameEnd) this.onGameEnd(g.winner, g.reason);
      }

      /* Revanche Instantânea na Mesma Sala (Opção A) */
      if (g.status === 'finished' && !this.game.spectate) {
        if (g.nextGameId && !this.game.rematchJoined) {
          this.game.rematchJoined = true;
          const nextColor = myColor === 'w' ? 'b' : 'w';
          const nextId = g.nextGameId;
          this._attachGame(nextId, nextColor);
          return;
        }
        if (g.rematchOffer && g.rematchOffer !== this.uid && this.onRematchOffer) {
          this.onRematchOffer();
        }
      }
    });

    if (!opts.spectate) {
      this.presenceTimer = setInterval(() => {
        if (!this.game || !this.game.started) return;
        if (this.game.data && this.game.data.status !== 'active') return;
        if (this.onPresence) this.onPresence(Math.floor((Date.now() - this.game.lastOppSeen) / 1000));
      }, 1000);
    }
  }

  async sendChat(text, isEmote = false) {
    if (!this.game || !this.game.ref || !text) return;
    const clean = String(text).trim().slice(0, 140);
    if (!clean) return;
    const payload = JSON.stringify({
      by: this.uid,
      name: this.profile?.name || 'JOGADOR',
      text: clean,
      isEmote: !!isEmote,
      spectate: !!this.game.spectate,
      ts: Date.now()
    });
    await updateDoc(this.game.ref, { chat: arrayUnion(payload) }).catch(() => {});
  }

  /* Pede ou aceita Revanche Instantânea invertendo as cores */
  async requestRematch() {
    if (!this.game || !this.game.data || this.game.spectate) return { status: 'none' };
    const g = this.game.data;
    if (g.rematchOffer && g.rematchOffer !== this.uid && !g.nextGameId) {
      const nextId = this._randomId(10);
      await setDoc(doc(this.db, 'chess_games', nextId), this._newGameDoc(g.black, g.white, 'active', g.tc));
      await updateDoc(this.game.ref, { nextGameId: nextId }).catch(() => {});
      return { status: 'started', nextId };
    }
    await updateDoc(this.game.ref, { rematchOffer: this.uid }).catch(() => {});
    return { status: 'offered' };
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
    if (!this.game || !this.game.data || this.game.spectate) return;
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
    if (!this.game || !this.game.data || this.game.data.status === 'finished' || this.game.spectate) return;
    await updateDoc(this.game.ref, { status: 'finished', winner, reason }).catch(() => {});
  }

  resign() {
    if (!this.game || this.game.spectate) return Promise.resolve();
    return this.finishGame(this.game.myColor === 'w' ? 'b' : 'w', 'resign');
  }

  claimTimeout() {
    if (!this.game || this.game.spectate) return Promise.resolve();
    return this.finishGame(this.game.myColor, 'timeout');
  }

  async offerDraw() {
    if (!this.game || this.game.spectate) return;
    await updateDoc(this.game.ref, { drawOffer: this.uid }).catch(() => {});
  }

  async respondDraw(accept) {
    if (!this.game || this.game.spectate) return;
    if (accept) await this.finishGame('draw', 'draw');
    else await updateDoc(this.game.ref, { drawOffer: null }).catch(() => {});
  }

  async leaveGame() {
    if (this.game && !this.game.spectate && this.game.data && this.game.data.status === 'active') {
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
    if (score === 1) {
      p.wins++;
      p.streak = (p.streak || 0) + 1;
    } else if (score === 0) {
      p.losses++;
      p.streak = 0;
    } else {
      p.draws++;
      p.streak = 0;
    }

    await updateDoc(doc(this.db, 'chess_players', this.uid), {
      rating: p.rating,
      games: p.games,
      wins: p.wins,
      losses: p.losses,
      draws: p.draws,
      streak: p.streak
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

  /* ============ PRESENÇA, AMIGOS & DESAFIOS DIRETOS ============ */
  async updateActive() {
    if (!this.ready || !this.uid) return;
    await updateDoc(doc(this.db, 'chess_players', this.uid), { lastActive: Date.now() }).catch(() => {});
  }

  async listOnlinePlayers() {
    if (!this.ready || !this.db) return [];
    const cutoff = Date.now() - 10 * 60 * 1000;
    const snap = await getDocs(query(collection(this.db, 'chess_players'), where('lastActive', '>=', cutoff), limit(40)));
    return snap.docs.map(d => ({ uid: d.id, ...d.data() })).filter(p => p.uid !== this.uid);
  }

  async addFriend(target) {
    if (!this.ready || !this.uid || !target?.uid || target.uid === this.uid) return;
    const now = Date.now();
    await setDoc(doc(this.db, 'chess_players', this.uid, 'friends', target.uid), {
      name: target.name || 'JOGADOR',
      rating: target.rating || RATING_INICIAL,
      addedAt: now
    });
  }

  async listFriends() {
    if (!this.ready || !this.uid) return [];
    const snap = await getDocs(collection(this.db, 'chess_players', this.uid, 'friends'));
    return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  }

  async sendChallenge(target, tc) {
    if (!this.ready || !this.uid || !target?.uid) return;
    await setDoc(doc(this.db, 'chess_challenges', this.uid), {
      from: this._me(),
      to: { uid: target.uid, name: target.name, rating: target.rating || RATING_INICIAL },
      tc: tc || { base: 180000, inc: 2000, label: '3+2' },
      status: 'pending',
      gameId: null,
      createdAt: Date.now()
    });
  }

  listenIncomingChallenges(onChallenge) {
    if (!this.ready || !this.uid) return () => {};
    return onSnapshot(query(
      collection(this.db, 'chess_challenges'),
      where('to.uid', '==', this.uid),
      where('status', '==', 'pending')
    ), snap => {
      snap.docChanges().forEach(ch => {
        if (ch.type === 'added' || ch.type === 'modified') {
          onChallenge({ id: ch.doc.id, ...ch.doc.data() });
        }
      });
    }, () => { /* silencia permission-denied caso regras de chess_challenges ainda não tenham sido publicadas */ });
  }

  listenOutgoingChallenge(onAccepted) {
    if (!this.ready || !this.uid) return () => {};
    return onSnapshot(doc(this.db, 'chess_challenges', this.uid), snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      if (d.status === 'accepted' && d.gameId) {
        deleteDoc(doc(this.db, 'chess_challenges', this.uid)).catch(() => {});
        onAccepted(d.gameId);
      }
    }, () => {});
  }

  async acceptChallenge(ch) {
    if (!this.ready) return null;
    const gameId = this._randomId(10);
    await setDoc(doc(this.db, 'chess_games', gameId), this._newGameDoc(ch.from, ch.to, 'active', ch.tc));
    await updateDoc(doc(this.db, 'chess_challenges', ch.id), { status: 'accepted', gameId });
    this._attachGame(gameId, 'b');
    return gameId;
  }

  joinChallengeAsWhite(gameId) {
    this._attachGame(gameId, 'w');
  }

  async declineChallenge(ch) {
    if (!this.ready) return;
    await deleteDoc(doc(this.db, 'chess_challenges', ch.id)).catch(() => {});
  }

  _randomId(len) {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < len; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }
}

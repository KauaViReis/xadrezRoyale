/* ============================================================
   E2E Test Double for src/online/firebase.js
   Served via CDP Fetch interception in place of /src/online/firebase.js
   Uses BroadcastChannel('xadrez-e2e-online') + localStorage for real
   multi-tab synchronization without network or Firebase credentials.
   ============================================================ */

export const ONLINE_DOUBLE_SOURCE = `
const VIP_EMAIL = 'elkaua1227@gmail.com';
const CHANNEL_NAME = 'xadrez-e2e-online';
const GAMES_KEY = 'xadrezRoyale.e2e.games';
const LOBBY_KEY = 'xadrezRoyale.e2e.lobby';
const PLAYERS_KEY = 'xadrezRoyale.e2e.players';
const TAB_UID_KEY = 'xadrezRoyale.e2e.tabUid';

export const RATING_INICIAL = 1200;

function kFactor(games, rating) {
  if (games < 15) return 40;
  if (rating >= 2100) return 10;
  return 20;
}

function expectedScore(myRating, oppRating) {
  return 1 / (1 + Math.pow(10, (oppRating - myRating) / 400));
}

function eloDelta(myRating, oppRating, score, games = 0) {
  const k = kFactor(games, myRating);
  return Math.round(k * (score - expectedScore(myRating, oppRating)));
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getOrCreateTabUid() {
  try {
    let uid = sessionStorage.getItem(TAB_UID_KEY);
    if (!uid) {
      uid = 'e2e_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
      sessionStorage.setItem(TAB_UID_KEY, uid);
    }
    return uid;
  } catch {
    return 'e2e_' + Math.random().toString(36).slice(2, 10);
  }
}

export const isFirebaseConfigured = true;

export class OnlineManager {
  constructor() {
    this.ready = false;
    this.uid = null;
    this.nick = 'JOGADOR';
    this.user = null;
    this.profile = null;
    this.auth = null;
    this.db = true;
    this.game = null;
    this.myColor = null;
    this.unsubGame = null;
    this.unsubLobby = null;
    this.hbTimer = null;
    this.presenceTimer = null;
    this.searchTimer = null;
    this.pollTimer = null;
    this.searchStart = 0;
    this.appliedMoves = 0;
    this.rated = false;
    this._lastDrawOfferNotified = null;

    this.onMatchFound = null;
    this.onOpponentMove = null;
    this.onClockSync = null;
    this.onPresence = null;
    this.onDrawOffer = null;
    this.onGameEnd = null;
    this.onRated = null;
    this.onStatus = null;
    this.onSearchBand = null;

    this._channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;
    this._onChannelMsg = (ev) => this._handleSignal(ev?.data);
    this._onStorage = (ev) => {
      if (ev.key === GAMES_KEY && this.game) this._syncCurrentGame();
      if (ev.key === LOBBY_KEY && this.searchTimer) this._scanLobby(this._searchTc);
    };
    if (this._channel) this._channel.addEventListener('message', this._onChannelMsg);
    if (typeof window !== 'undefined') window.addEventListener('storage', this._onStorage);
  }

  _broadcast(payload) {
    if (this._channel) {
      try { this._channel.postMessage(payload); } catch { /* noop */ }
    }
  }

  _handleSignal(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'game-update' && this.game && msg.gameId === this.game.id) {
      this._syncCurrentGame();
    } else if (msg.type === 'match-created' && !this.game) {
      if (msg.whiteUid === this.uid) {
        this._stopSearch();
        this._removeFromLobby(this.uid);
        this._attachGame(msg.gameId, 'w');
      } else if (msg.blackUid === this.uid) {
        this._stopSearch();
        this._removeFromLobby(this.uid);
        this._attachGame(msg.gameId, 'b');
      }
    } else if (msg.type === 'lobby-update' && this.searchTimer) {
      this._scanLobby(this._searchTc);
    }
  }

  _getInjectedEmail() {
    if (typeof window === 'undefined') return '';
    return String(window.__E2E_AUTH_EMAIL__ || window.__E2E_TEST_EMAIL__ || '').trim();
  }

  _getInjectedNick(fallback) {
    if (typeof window === 'undefined') return fallback;
    const n = String(window.__E2E_AUTH_NICK__ || '').trim();
    return n || fallback;
  }

  isVipDev() {
    const email = (this.user?.email || this.profile?.email || '').toLowerCase();
    return email === VIP_EMAIL || this.profile?.dev === true;
  }

  async init(nick = 'JOGADOR') {
    this.onStatus?.('connecting');
    this.uid = getOrCreateTabUid();
    const resolvedNick = this._getInjectedNick(nick || 'JOGADOR').toUpperCase().slice(0, 16);
    this.nick = resolvedNick;

    const injectedEmail = this._getInjectedEmail();
    const players = readJson(PLAYERS_KEY, {});
    const existing = players[this.uid];

    if (existing) {
      this.profile = { ...this._defaultProfile(resolvedNick), ...existing };
      if (injectedEmail && !this.profile.email) {
        this.profile.email = injectedEmail;
        this.profile.google = true;
        this.profile.dev = injectedEmail.toLowerCase() === VIP_EMAIL;
      }
    } else {
      this.profile = this._defaultProfile(resolvedNick);
      if (injectedEmail) {
        this.profile.email = injectedEmail;
        this.profile.google = true;
        this.profile.dev = injectedEmail.toLowerCase() === VIP_EMAIL;
      }
    }

    this.user = {
      uid: this.uid,
      email: this.profile.email || null,
      photoURL: this.profile.photoURL || null
    };

    players[this.uid] = this.profile;
    writeJson(PLAYERS_KEY, players);

    this.ready = true;
    this.onStatus?.('connected');
    return true;
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

  _saveMyProfile() {
    if (!this.uid || !this.profile) return;
    const players = readJson(PLAYERS_KEY, {});
    players[this.uid] = this.profile;
    writeJson(PLAYERS_KEY, players);
  }

  async setName(name) {
    if (!this.profile) return;
    const clean = String(name || 'JOGADOR').trim().toUpperCase().slice(0, 16) || 'JOGADOR';
    this.nick = clean;
    this.profile.name = clean;
    this._saveMyProfile();
  }

  async setNick(nick) {
    return this.setName(nick);
  }

  async linkGoogle() {
    const email = this._getInjectedEmail() || 'jogador@e2e.local';
    if (!this.profile) this.profile = this._defaultProfile(this.nick);
    this.profile.email = email;
    this.profile.google = true;
    this.profile.dev = email.toLowerCase() === VIP_EMAIL;
    this.user = {
      uid: this.uid,
      email,
      photoURL: null
    };
    this._saveMyProfile();
    return { linked: true, msg: '✓ Conta Google conectada — progresso salvo' };
  }

  _me() {
    return {
      uid: this.uid,
      name: this.profile?.name || this.nick || 'JOGADOR',
      rating: this.profile?.rating ?? RATING_INICIAL,
      photoURL: this.profile?.photoURL || null
    };
  }

  _newGameDoc(white, black, status, tc) {
    const resolvedTc = tc || { base: 300000, inc: 0, label: '5+0' };
    const now = Date.now();
    return {
      status,
      white,
      black,
      moves: [],
      drawOffer: null,
      winner: null,
      reason: null,
      hbWhite: now,
      hbBlack: now,
      tc: resolvedTc,
      clockW: resolvedTc.base,
      clockB: resolvedTc.base,
      turnStartedAt: now,
      createdAt: now
    };
  }

  _removeFromLobby(uid) {
    const lobby = readJson(LOBBY_KEY, {});
    if (lobby[uid]) {
      delete lobby[uid];
      writeJson(LOBBY_KEY, lobby);
    }
  }

  async quickMatch(tc) {
    this.searchStart = Date.now();
    this._searchTc = tc || { base: 300000, inc: 0, label: '5+0' };
    const lobby = readJson(LOBBY_KEY, {});
    lobby[this.uid] = {
      ...this._me(),
      tc: this._searchTc,
      gameId: null,
      createdAt: Date.now()
    };
    writeJson(LOBBY_KEY, lobby);
    this._broadcast({ type: 'lobby-update', uid: this.uid });
    this.onStatus?.('searching');

    this.unsubLobby = () => {};
    await this._scanLobby(this._searchTc);
    if (!this.game) {
      this.searchTimer = setInterval(() => this._scanLobby(this._searchTc), 250);
    }
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

    const lobby = readJson(LOBBY_KEY, {});
    const mine = lobby[this.uid];
    if (mine && mine.gameId) {
      const gameId = mine.gameId;
      this._stopSearch();
      this._removeFromLobby(this.uid);
      this._attachGame(gameId, 'w');
      return;
    }

    const candidates = Object.values(lobby)
      .filter((e) => e && e.uid !== this.uid && !e.gameId)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

    for (const host of candidates) {
      if (myTc && host.tc && host.tc.label !== myTc.label) continue;
      if (band !== Infinity && Math.abs((host.rating || RATING_INICIAL) - (this.profile?.rating ?? RATING_INICIAL)) > band) continue;

      const gameId = this._randomId(10);
      const games = readJson(GAMES_KEY, {});
      games[gameId] = this._newGameDoc(
        { uid: host.uid, name: host.name, rating: host.rating, photoURL: host.photoURL || null },
        this._me(),
        'active',
        host.tc
      );
      writeJson(GAMES_KEY, games);

      lobby[host.uid] = { ...host, gameId };
      delete lobby[this.uid];
      writeJson(LOBBY_KEY, lobby);

      this._broadcast({ type: 'match-created', gameId, whiteUid: host.uid, blackUid: this.uid });
      this._stopSearch();
      this._attachGame(gameId, 'b');
      return;
    }
  }

  async cancelSearch() {
    this._stopSearch();
    this._removeFromLobby(this.uid);
    this.onStatus?.('connected');
  }

  _stopSearch() {
    if (this.unsubLobby) {
      this.unsubLobby = null;
    }
    if (this.searchTimer) {
      clearInterval(this.searchTimer);
      this.searchTimer = null;
    }
  }

  async createRoom(tc) {
    const code = this._randomId(6);
    const games = readJson(GAMES_KEY, {});
    games[code] = this._newGameDoc(this._me(), null, 'waiting', tc);
    writeJson(GAMES_KEY, games);
    this._attachGame(code, 'w');
    this._broadcast({ type: 'game-update', gameId: code });
    this.onStatus?.('waiting');
    return code;
  }

  async joinRoom(code) {
    code = String(code || '').trim().toUpperCase();
    if (!code) throw new Error('INFORME O CÓDIGO DA SALA');
    const games = readJson(GAMES_KEY, {});
    const g = games[code];
    if (!g) throw new Error('SALA NÃO ENCONTRADA');
    if (g.status !== 'waiting') throw new Error('SALA JÁ ESTÁ CHEIA');
    if (g.white && g.white.uid === this.uid) throw new Error('VOCÊ CRIOU ESTA SALA');

    const now = Date.now();
    g.black = this._me();
    g.status = 'active';
    g.hbBlack = now;
    g.turnStartedAt = now;
    games[code] = g;
    writeJson(GAMES_KEY, games);

    this._attachGame(code, 'b');
    this._broadcast({ type: 'game-update', gameId: code });
    this._syncCurrentGame();
  }

  _attachGame(gameId, myColor) {
    this._detachGame();
    this.appliedMoves = 0;
    this.rated = false;
    this.myColor = myColor;
    this._lastDrawOfferNotified = null;
    this.game = {
      id: gameId,
      myColor,
      data: null,
      started: false,
      lastOppHb: null,
      lastOppSeen: Date.now()
    };

    this.pollTimer = setInterval(() => this._syncCurrentGame(), 120);
    this.presenceTimer = setInterval(() => {
      if (!this.game || !this.game.started) return;
      if (this.game.data && this.game.data.status !== 'active') return;
      if (this.onPresence) this.onPresence(Math.floor((Date.now() - this.game.lastOppSeen) / 1000));
    }, 1000);

    queueMicrotask(() => this._syncCurrentGame());
  }

  _syncCurrentGame() {
    if (!this.game) return;
    const games = readJson(GAMES_KEY, {});
    const g = games[this.game.id];
    if (!g) return;

    const prevMovesLen = this.game.data?.moves?.length ?? 0;
    const prevClockW = this.game.data?.clockW;
    const prevClockB = this.game.data?.clockB;
    this.game.data = g;
    const myColor = this.game.myColor;

    if (!this.game.started && g.status !== 'waiting') {
      this.game.started = true;
      this._startHeartbeat();
      this.onStatus?.('in_game');
      const opponent = myColor === 'b' ? g.white : g.black;
      if (this.onMatchFound) {
        this.onMatchFound({
          myColor,
          opponent,
          code: this.game.id,
          moves: (g.moves || []).map((s) => JSON.parse(s)),
          data: g
        });
      }
      if (this.onClockSync) {
        this.onClockSync({
          clockW: g.clockW,
          clockB: g.clockB,
          turnStartedAt: g.turnStartedAt,
          serverNow: Date.now()
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

    if (
      this.game.started &&
      this.onClockSync &&
      (moves.length !== prevMovesLen || g.clockW !== prevClockW || g.clockB !== prevClockB)
    ) {
      this.onClockSync({
        clockW: g.clockW,
        clockB: g.clockB,
        turnStartedAt: g.turnStartedAt,
        serverNow: Date.now()
      });
    }

    if (!g.drawOffer) {
      this._lastDrawOfferNotified = null;
    } else if (g.status === 'active' && g.drawOffer !== this.uid && this._lastDrawOfferNotified !== g.drawOffer) {
      this._lastDrawOfferNotified = g.drawOffer;
      if (this.onDrawOffer) this.onDrawOffer();
    }

    const oppHb = myColor === 'w' ? g.hbBlack : g.hbWhite;
    if (oppHb !== this.game.lastOppHb) {
      this.game.lastOppHb = oppHb;
      this.game.lastOppSeen = Date.now();
    }

    if (g.status === 'finished' && !this.rated) {
      this.rated = true;
      this._applyRating(g);
      this._stopTimers();
      this.onStatus?.('finished');
      if (this.onGameEnd) this.onGameEnd(g.winner, g.reason);
    }
  }

  _startHeartbeat() {
    if (!this.game) return;
    const field = this.game.myColor === 'w' ? 'hbWhite' : 'hbBlack';
    const beat = () => {
      if (!this.game || !this.game.data || this.game.data.status !== 'active') return;
      const games = readJson(GAMES_KEY, {});
      const g = games[this.game.id];
      if (!g || g.status !== 'active') return;
      g[field] = Date.now();
      games[this.game.id] = g;
      writeJson(GAMES_KEY, games);
      this._broadcast({ type: 'game-update', gameId: this.game.id });
    };
    beat();
    this.hbTimer = setInterval(beat, 3000);
  }

  _stopTimers() {
    if (this.hbTimer) { clearInterval(this.hbTimer); this.hbTimer = null; }
    if (this.presenceTimer) { clearInterval(this.presenceTimer); this.presenceTimer = null; }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  _detachGame() {
    this._stopTimers();
    if (this.unsubGame) { this.unsubGame(); this.unsubGame = null; }
    this.game = null;
    this.myColor = null;
  }

  async sendMove(moveObj, myClockMs = null) {
    if (!this.game) return;
    const games = readJson(GAMES_KEY, {});
    const g = games[this.game.id];
    if (!g) return;
    const n = (g.moves || []).length;
    const entry = JSON.stringify({
      n,
      by: this.uid,
      from: moveObj.from,
      to: moveObj.to,
      promotion: moveObj.promotion || null
    });
    g.moves = [...(g.moves || []), entry];
    g.drawOffer = null;
    g.turnStartedAt = Date.now();
    if (myClockMs !== null && myClockMs !== undefined) {
      if (this.game.myColor === 'w') g.clockW = Math.max(0, Math.round(myClockMs));
      else g.clockB = Math.max(0, Math.round(myClockMs));
    }
    games[this.game.id] = g;
    writeJson(GAMES_KEY, games);
    this._broadcast({ type: 'game-update', gameId: this.game.id });
    this._syncCurrentGame();
  }

  async finishGame(winner, reason) {
    if (!this.game) return;
    const games = readJson(GAMES_KEY, {});
    const g = games[this.game.id];
    if (!g || g.status === 'finished') return;
    g.status = 'finished';
    g.winner = winner;
    g.reason = reason;
    games[this.game.id] = g;
    writeJson(GAMES_KEY, games);
    this._broadcast({ type: 'game-update', gameId: this.game.id });
    this._syncCurrentGame();
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
    const games = readJson(GAMES_KEY, {});
    const g = games[this.game.id];
    if (!g || g.status !== 'active') return;
    g.drawOffer = this.uid;
    games[this.game.id] = g;
    writeJson(GAMES_KEY, games);
    this._broadcast({ type: 'game-update', gameId: this.game.id });
  }

  async respondDraw(accept) {
    if (!this.game) return;
    if (accept) {
      await this.finishGame('draw', 'draw');
    } else {
      const games = readJson(GAMES_KEY, {});
      const g = games[this.game.id];
      if (!g) return;
      g.drawOffer = null;
      games[this.game.id] = g;
      writeJson(GAMES_KEY, games);
      this._broadcast({ type: 'game-update', gameId: this.game.id });
    }
  }

  async leaveGame() {
    if (this.game && this.game.data && this.game.data.status === 'active') {
      await this.resign();
    }
    this._detachGame();
  }

  _applyRating(g) {
    if (!g.white || !g.black || !this.profile) return;
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
    this._saveMyProfile();
    if (this.onRated) this.onRated(delta, p.rating);
  }

  async leaderboard(top = 10) {
    const players = readJson(PLAYERS_KEY, {});
    return Object.entries(players)
      .filter(([, p]) => p && p.google === true)
      .map(([uid, p]) => ({ uid, ...p }))
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, top);
  }

  async getLeaderboard(top = 10) {
    return this.leaderboard(top);
  }

  _randomId(len) {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < len; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }
}
`;

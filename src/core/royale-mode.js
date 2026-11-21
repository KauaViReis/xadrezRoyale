/* ============================================================
   XADREZ ROYALE — Motor de Modos Especiais:
   1. Battle Royale (Zona de Colapso 3D 8×8 → 6×6 → 4×4 + Cristais de Relíquia)
   2. Modo Heróis & Poderes (Barra de Energia de 3 Cargas: Escudo, Gelo, Ultimate)
   3. Neblina de Guerra 3D (Fog of War — Visibilidade Real por Alcance)
   4. Xadrez 960 (Fischer Random FIDE)
   ============================================================ */

import { Chess } from 'chess.js';
import { squareToRC, rcToSquare } from './chess-engine.js';

export const SPECIAL_RULESETS = [
  { id: 'classic', name: 'Clássico FIDE', icon: '♔', desc: 'Regras oficiais FIDE sem modificadores' },
  { id: 'royale',  name: 'Battle Royale 3D', icon: '🔥', desc: 'Borda desaba a cada 12 lances + Relíquias 3D + Poderes' },
  { id: 'heroes',  name: 'Heróis & Poderes', icon: '⚡', desc: 'Capturas carregam Escudo Arcano, Gelo 3D e Ultimate' },
  { id: 'fog',     name: 'Neblina de Guerra', icon: '🌫️', desc: 'Você só enxerga casas no campo de visão das suas peças' },
  { id: 'chess960',name: 'Xadrez 960', icon: '🎲', desc: 'Posição inicial sorteada (Fischer Random)' }
];

export const HERO_POWERS = [
  {
    id: 'shield',
    cost: 1,
    name: 'Escudo Arcano',
    icon: '🛡️',
    color: 0x38BDF8,
    desc: 'Protege a peça selecionada (ou mais valiosa) contra capturas por 1 rodada'
  },
  {
    id: 'freeze',
    cost: 2,
    name: 'Prisão de Gelo',
    icon: '❄️',
    color: 0x60A5FA,
    desc: 'Congela uma peça inimiga de alto valor por 1 turno'
  },
  {
    id: 'ultimate',
    cost: 3,
    name: 'Trovão Royale',
    icon: '⚡',
    color: 0xF4C96B,
    desc: 'Ultimate: Escudo na sua melhor peça + Congela peça inimiga com Raio Orbital 3D'
  }
];

const CENTER_SQUARES = ['d4', 'e4', 'd5', 'e5'];
const PIECE_RANK_VALUE = { q: 9, r: 5, b: 3, n: 3, p: 1, k: 0 };

/**
 * Verifica se (r, c) pertence ao anel de colapso `ringLevel` (1 = borda A/H/1/8, 2 = B/G/2/7).
 */
export function isSquareInRing(r, c, ringLevel) {
  if (ringLevel === 1) {
    return r === 0 || r === 7 || c === 0 || c === 7;
  }
  if (ringLevel === 2) {
    const inOuter = r === 0 || r === 7 || c === 0 || c === 7;
    const inSecond = r <= 1 || r >= 6 || c <= 1 || c >= 6;
    return !inOuter && inSecond;
  }
  return false;
}

/**
 * Verifica se a casa (r, c) já desabou dado o número de anéis colapsados (0, 1 ou 2).
 */
export function isSquareCollapsed(r, c, collapsedRings = 0) {
  if (collapsedRings >= 1 && (r === 0 || r === 7 || c === 0 || c === 7)) return true;
  if (collapsedRings >= 2 && (r <= 1 || r >= 6 || c <= 1 || c >= 6)) return true;
  return false;
}

/**
 * Retorna lista de coordenadas [{ r, c, sq }] que pertencem a um anel específico.
 */
export function getRingSquares(ringLevel) {
  const list = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (isSquareInRing(r, c, ringLevel)) {
        list.push({ r, c, sq: rcToSquare(r, c) });
      }
    }
  }
  return list;
}

/**
 * Estado de partida para Battle Royale & Heróis.
 */
export class RoyaleMatchManager {
  constructor() {
    this.reset('classic');
  }

  reset(ruleset = 'classic') {
    this.ruleset = ruleset || 'classic';
    this.collapsedRings = 0;
    this.warningRing = 0;
    this.relicSquare = null;
    this.nextRelicPly = 4;
    this.energy = { w: 0, b: 0 };
    this.maxEnergy = 3;
    // Map<square, expirePly>
    this.shieldedSquares = new Map();
    this.frozenSquares = new Map();
  }

  isRoyaleActive() {
    return this.ruleset === 'royale';
  }

  isPowersActive() {
    return this.ruleset === 'royale' || this.ruleset === 'heroes';
  }

  isFogActive() {
    return this.ruleset === 'fog';
  }

  addEnergy(color, amount = 1) {
    if (!this.isPowersActive()) return 0;
    this.energy[color] = Math.max(0, Math.min(this.maxEnergy, (this.energy[color] || 0) + amount));
    return this.energy[color];
  }

  isSquareShielded(sq, currentPly) {
    const exp = this.shieldedSquares.get(sq);
    if (exp === undefined) return false;
    if (currentPly >= exp) {
      this.shieldedSquares.delete(sq);
      return false;
    }
    return true;
  }

  isSquareFrozen(sq, currentPly) {
    const exp = this.frozenSquares.get(sq);
    if (exp === undefined) return false;
    if (currentPly >= exp) {
      this.frozenSquares.delete(sq);
      return false;
    }
    return true;
  }

  /**
   * Atualiza a posição das peças com escudo/gelo após um lance (from -> to).
   */
  onPieceMoved(from, to, capturedSq = null) {
    if (capturedSq) {
      this.shieldedSquares.delete(capturedSq);
      this.frozenSquares.delete(capturedSq);
    }
    if (this.shieldedSquares.has(from)) {
      const exp = this.shieldedSquares.get(from);
      this.shieldedSquares.delete(from);
      this.shieldedSquares.set(to, exp);
    }
    if (this.frozenSquares.has(from)) {
      const exp = this.frozenSquares.get(from);
      this.frozenSquares.delete(from);
      this.frozenSquares.set(to, exp);
    }
  }

  /**
   * Limpa efeitos expirados e retorna listas de casas ativas.
   */
  getActiveStatusSquares(currentPly) {
    const shields = [];
    const frozen = [];
    for (const [sq, exp] of this.shieldedSquares.entries()) {
      if (currentPly >= exp) this.shieldedSquares.delete(sq);
      else shields.push(sq);
    }
    for (const [sq, exp] of this.frozenSquares.entries()) {
      if (currentPly >= exp) this.frozenSquares.delete(sq);
      else frozen.push(sq);
    }
    return { shields, frozen };
  }

  /**
   * Filtra lances legais removendo:
   * - Origem congelada (frozenSquares)
   * - Destino colapsado (Battle Royale)
   * - Captura em casa protegida por Escudo Arcano
   */
  filterLegalMoves(moves, currentPly) {
    if (this.ruleset === 'classic' || this.ruleset === 'chess960' || this.ruleset === 'fog') {
      return moves;
    }
    return moves.filter(m => {
      if (this.isSquareFrozen(m.from, currentPly)) return false;
      const toRC = squareToRC(m.to);
      if (isSquareCollapsed(toRC.r, toRC.c, this.collapsedRings)) return false;
      if (m.captured && this.isSquareShielded(m.to, currentPly)) return false;
      return true;
    });
  }

  /**
   * Processa eventos de fim de turno do Modo Battle Royale (alerta de anel, colapso 3D, coleta e spawn de relíquia).
   */
  advanceTurn(chess, lastMove, currentPly) {
    const events = {
      relicClaimed: null,
      relicSpawned: null,
      warningRing: 0,
      collapsedRing: 0,
      destroyedSquares: [],
      kingRelocated: []
    };

    if (!this.isRoyaleActive()) return events;

    // 1. Coleta de Relíquia Central
    if (this.relicSquare && lastMove && lastMove.to === this.relicSquare) {
      const claimer = lastMove.color;
      this.addEnergy(claimer, 2);
      this.shieldedSquares.set(lastMove.to, currentPly + 2);
      events.relicClaimed = { square: this.relicSquare, color: claimer };
      this.relicSquare = null;
      this.nextRelicPly = currentPly + 6;
    }

    // 2. Cronograma de Alerta e Colapso (Anel 1 no ply 10/12; Anel 2 no ply 24/26)
    if (currentPly === 10 && this.collapsedRings === 0) {
      this.warningRing = 1;
      events.warningRing = 1;
    } else if (currentPly === 12 && this.collapsedRings === 0) {
      this.warningRing = 0;
      this.collapsedRings = 1;
      events.collapsedRing = 1;
      this._destroyPiecesOnRing(chess, 1, events);
    } else if (currentPly === 24 && this.collapsedRings === 1) {
      this.warningRing = 2;
      events.warningRing = 2;
    } else if (currentPly === 26 && this.collapsedRings === 1) {
      this.warningRing = 0;
      this.collapsedRings = 2;
      events.collapsedRing = 2;
      this._destroyPiecesOnRing(chess, 2, events);
    }

    // 3. Spawn de nova Relíquia 3D no centro
    if (!this.relicSquare && currentPly >= this.nextRelicPly) {
      const emptyCenter = CENTER_SQUARES.filter(sq => !chess.get(sq));
      if (emptyCenter.length > 0) {
        const pick = emptyCenter[currentPly % emptyCenter.length];
        this.relicSquare = pick;
        events.relicSpawned = pick;
      }
    }

    return events;
  }

  _destroyPiecesOnRing(chess, ringLevel, events) {
    const ringSqs = getRingSquares(ringLevel);
    for (const { r, c, sq } of ringSqs) {
      const piece = chess.get(sq);
      if (!piece) continue;
      if (piece.type === 'k') {
        // Evacuação de emergência do Rei para a casa segura mais próxima
        const safeSq = this._findNearestSafeEmptySquare(chess, r, c);
        if (safeSq) {
          chess.remove(sq);
          chess.put({ type: 'k', color: piece.color }, safeSq);
          events.kingRelocated.push({ color: piece.color, from: sq, to: safeSq });
        }
      } else {
        chess.remove(sq);
        this.shieldedSquares.delete(sq);
        this.frozenSquares.delete(sq);
        events.destroyedSquares.push({ sq, r, c, type: piece.type, color: piece.color });
      }
    }
  }

  _findNearestSafeEmptySquare(chess, kr, kc) {
    let bestSq = null;
    let bestDist = 999;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (isSquareCollapsed(r, c, this.collapsedRings)) continue;
        const sq = rcToSquare(r, c);
        if (chess.get(sq)) continue;
        const dist = Math.hypot(r - kr, c - kc);
        if (dist < bestDist) {
          bestDist = dist;
          bestSq = sq;
        }
      }
    }
    return bestSq;
  }

  /**
   * Ativa um poder de Herói (`shield`, `freeze`, `ultimate`) para a cor `color`.
   */
  activatePower(powerId, chess, color, currentPly, preferredSq = null) {
    const power = HERO_POWERS.find(p => p.id === powerId);
    if (!power || (this.energy[color] || 0) < power.cost) {
      return { ok: false, reason: 'Energia insuficiente! Capture peças para carregar.' };
    }

    const board = chess.board();
    const myPieces = [];
    const enemyPieces = [];

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (isSquareCollapsed(r, c, this.collapsedRings)) continue;
        const cell = board[r][c];
        if (!cell || cell.type === 'k') continue;
        const sq = rcToSquare(r, c);
        const item = { sq, r, c, type: cell.type, val: PIECE_RANK_VALUE[cell.type] || 1 };
        if (cell.color === color) myPieces.push(item);
        else enemyPieces.push(item);
      }
    }

    myPieces.sort((a, b) => b.val - a.val);
    enemyPieces.sort((a, b) => b.val - a.val);

    let shieldedSq = null;
    let frozenSq = null;

    if (powerId === 'shield' || powerId === 'ultimate') {
      const target = (preferredSq && myPieces.find(p => p.sq === preferredSq)) || myPieces[0];
      if (!target && powerId === 'shield') {
        return { ok: false, reason: 'Nenhuma peça aliada elegível para Escudo.' };
      }
      if (target) {
        this.shieldedSquares.set(target.sq, currentPly + 3);
        shieldedSq = target.sq;
      }
    }

    if (powerId === 'freeze' || powerId === 'ultimate') {
      const target = enemyPieces.find(p => !this.isSquareFrozen(p.sq, currentPly)) || enemyPieces[0];
      if (!target && powerId === 'freeze') {
        return { ok: false, reason: 'Nenhuma peça inimiga elegível para Congelar.' };
      }
      if (target) {
        this.frozenSquares.set(target.sq, currentPly + 2);
        frozenSq = target.sq;
      }
    }

    this.energy[color] -= power.cost;
    return {
      ok: true,
      power,
      shieldedSq,
      frozenSq,
      remainingEnergy: this.energy[color]
    };
  }
}

/**
 * Calcula o conjunto de casas visíveis na Neblina de Guerra 3D (Fog of War) para `perspectiveColor`.
 */
export function computeFogVisibleSquares(chess, perspectiveColor = 'w') {
  const visible = new Set();
  const b = chess.board();

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = b[r][c];
      if (cell && cell.color === perspectiveColor) {
        const sq = rcToSquare(r, c);
        visible.add(sq);
        // Visão de proximidade (1 casa ao redor de cada peça aliada)
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
              visible.add(rcToSquare(nr, nc));
            }
          }
        }
      }
    }
  }

  // Adiciona todas as casas alcançáveis por lances das peças aliadas
  try {
    const parts = chess.fen().split(' ');
    parts[1] = perspectiveColor;
    parts[3] = '-';
    const probe = new Chess(parts.join(' '));
    for (const m of probe.moves({ verbose: true })) {
      visible.add(m.to);
    }
  } catch {
    for (const m of chess.moves({ verbose: true })) {
      if (m.color === perspectiveColor) visible.add(m.to);
    }
  }

  return visible;
}

/**
 * Gera uma posição inicial oficial FIDE Xadrez 960 (Fischer Random).
 * @param {number} [seedIndex] Índice opcional 0..959 (ou aleatório se omitido)
 */
export function generateChess960Fen(seedIndex = Math.floor(Math.random() * 960)) {
  let n = ((seedIndex % 960) + 960) % 960;
  const rank = Array(8).fill(null);

  // 1. Bispo nas casas claras (índices ímpares 1, 3, 5, 7)
  const b1 = n % 4;
  n = Math.floor(n / 4);
  rank[b1 * 2 + 1] = 'b';

  // 2. Bispo nas casas escuras (índices pares 0, 2, 4, 6)
  const b2 = n % 4;
  n = Math.floor(n / 4);
  rank[b2 * 2] = 'b';

  // 3. Dama em uma das 6 casas restantes
  const qIdx = n % 6;
  n = Math.floor(n / 6);
  const emptyForQ = [];
  for (let i = 0; i < 8; i++) if (!rank[i]) emptyForQ.push(i);
  rank[emptyForQ[qIdx]] = 'q';

  // 4. Dois Cavalos nas 5 casas restantes (10 combinações)
  const knightPairs = [
    [0, 1], [0, 2], [0, 3], [0, 4],
    [1, 2], [1, 3], [1, 4],
    [2, 3], [2, 4],
    [3, 4]
  ];
  const pair = knightPairs[n % 10];
  const emptyForN = [];
  for (let i = 0; i < 8; i++) if (!rank[i]) emptyForN.push(i);
  rank[emptyForN[pair[0]]] = 'n';
  rank[emptyForN[pair[1]]] = 'n';

  // 5. As 3 casas restantes recebem Torre - Rei - Torre (Rei sempre entre as Torres)
  const emptyForRKR = [];
  for (let i = 0; i < 8; i++) if (!rank[i]) emptyForRKR.push(i);
  rank[emptyForRKR[0]] = 'r';
  rank[emptyForRKR[1]] = 'k';
  rank[emptyForRKR[2]] = 'r';

  const blackRank = rank.join('');
  const whiteRank = blackRank.toUpperCase();
  return `${blackRank}/pppppppp/8/8/8/8/PPPPPPPP/${whiteRank} w - - 0 1`;
}

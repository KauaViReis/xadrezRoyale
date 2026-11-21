/* ============================================================
   XADREZ ROYALE — Torre Royale (Modo Campanha / Roguelike PvE)
   8 Andares em dificuldade crescente + Escolha de Relíquias/Buffs
   ============================================================ */

import { Chess } from 'chess.js';
import { generateChess960Fen } from './royale-mode.js';

export const TOWER_FLOORS = [
  {
    floor: 1,
    name: 'Portão de Bronze',
    guardian: 'Guardiã Sofia',
    avatar: '🌱',
    rating: 750,
    botId: 'sofia',
    depth: 1,
    ruleset: 'heroes',
    desc: 'Vanguarda inicial sem Dama inimiga. Ideal para carregar sua primeira energia.',
    fen: 'rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  },
  {
    floor: 2,
    name: 'Pátio dos Escudos',
    guardian: 'Sentinela Sofia',
    avatar: '🛡️',
    rating: 950,
    botId: 'sofia',
    depth: 1,
    ruleset: 'heroes',
    desc: 'Exército completo com Poderes de Heróis habilitados.'
  },
  {
    floor: 3,
    name: 'Salão das Lâminas',
    guardian: 'Cavaleiro Viktor',
    avatar: '⚔️',
    rating: 1250,
    botId: 'viktor',
    depth: 2,
    ruleset: 'heroes',
    desc: 'Tático agressivo que busca ataques rápidos ao Rei.'
  },
  {
    floor: 4,
    name: 'Ponte do Abismo (Mini-Boss)',
    guardian: 'Comandante Viktor',
    avatar: '🔥',
    rating: 1400,
    botId: 'viktor',
    depth: 2,
    ruleset: 'royale',
    desc: 'Battle Royale 3D! A borda externa desaba no 12º lance e Relíquias surgem no centro.'
  },
  {
    floor: 5,
    name: 'Câmara de Cristal',
    guardian: 'Estrategista Helena',
    avatar: '🏛️',
    rating: 1580,
    botId: 'helena',
    depth: 3,
    ruleset: 'heroes',
    desc: 'Jogo posicional sólido com domínio das colunas centrais.'
  },
  {
    floor: 6,
    name: 'Labirinto Caótico 960',
    guardian: 'Oráculo Helena',
    avatar: '🎲',
    rating: 1700,
    botId: 'helena',
    depth: 3,
    ruleset: 'heroes',
    use960: true,
    desc: 'Primeira fileira embaralhada (Xadrez 960) + Poderes de Heróis!'
  },
  {
    floor: 7,
    name: 'Trono de Obsidiana (Sub-Boss)',
    guardian: 'Arconte Helena',
    avatar: '⚡',
    rating: 1850,
    botId: 'helena',
    depth: 3,
    ruleset: 'royale',
    desc: 'Arena Battle Royale 3D de alta intensidade.'
  },
  {
    floor: 8,
    name: 'Cúpula Imperial (Boss Final)',
    guardian: 'Imperador Stockfish',
    avatar: '👑',
    rating: 2400,
    botId: 'stockfish',
    depth: 4,
    style: 'stockfish',
    ruleset: 'royale',
    desc: 'O Grande Chefe da Torre Royale na Arena de Colapso 3D!'
  }
];

export const TOWER_BOONS = [
  {
    id: 'energy_surge',
    name: 'Bateria Arcana',
    icon: '⚡',
    desc: 'Inicia cada andar com +2⚡ Cargas de Energia de Herói.'
  },
  {
    id: 'royal_aegis',
    name: 'Égide da Dama',
    icon: '🛡️',
    desc: 'Sua Dama inicia cada batalha com Escudo Arcano 3D por 2 rodadas.'
  },
  {
    id: 'frost_ambush',
    name: 'Emboscada Glacial',
    icon: '❄️',
    desc: 'Congela a Dama (ou peça mais forte) inimiga nos 2 primeiros turnos.'
  },
  {
    id: 'sniper_strike',
    name: 'Sabotagem Real',
    icon: '🎯',
    desc: 'Destrói a Torre inimiga de a8 antes do início da batalha.'
  },
  {
    id: 'vanguard_knight',
    name: 'Cavalaria de Elite',
    icon: '♘',
    desc: 'Transforma seu peão de c2 em um 3º Cavalo Real extra no início.'
  },
  {
    id: 'max_capacitor',
    name: 'Reator Supremo',
    icon: '🔋',
    desc: 'Amplia a barra máxima para 5⚡ Cargas e concede +1⚡ inicial.'
  }
];

const TOWER_STORAGE_KEY = 'xadrezRoyale.tower';

export class TowerRunManager {
  constructor() {
    this.floor = 1;
    this.boons = [];
    this.bestFloor = 1;
    this.clears = 0;
    this._loadProgress();
  }

  _loadProgress() {
    try {
      const raw = JSON.parse(localStorage.getItem(TOWER_STORAGE_KEY));
      if (raw) {
        this.bestFloor = Number(raw.bestFloor) || 1;
        this.clears = Number(raw.clears) || 0;
        this.floor = Number(raw.floor) || 1;
        this.boons = Array.isArray(raw.boons) ? raw.boons : [];
      }
    } catch {
      /* noop */
    }
  }

  _saveProgress() {
    try {
      localStorage.setItem(TOWER_STORAGE_KEY, JSON.stringify({
        floor: this.floor,
        boons: this.boons,
        bestFloor: this.bestFloor,
        clears: this.clears
      }));
    } catch {
      /* noop */
    }
  }

  startNewRun() {
    this.floor = 1;
    this.boons = [];
    this._saveProgress();
  }

  getCurrentFloorConfig() {
    return TOWER_FLOORS[Math.max(0, Math.min(TOWER_FLOORS.length - 1, this.floor - 1))];
  }

  hasBoon(id) {
    return this.boons.includes(id);
  }

  addBoon(id) {
    if (!this.boons.includes(id)) {
      this.boons.push(id);
      this._saveProgress();
    }
  }

  /**
   * Sorteia até 3 bênçãos ainda não adquiridas para escolha entre andares.
   */
  getRewardChoices(count = 3) {
    const pool = TOWER_BOONS.filter(b => !this.boons.includes(b.id));
    const source = pool.length >= count ? pool : TOWER_BOONS;
    const shuffled = [...source].sort((a, b) => (a.id.charCodeAt(0) + this.floor) % 3 - 1);
    return shuffled.slice(0, count);
  }

  /**
   * Avança de andar após vitória. Retorna `{ clearedRun: boolean, nextFloor: number }`.
   */
  advanceAfterWin() {
    if (this.floor >= TOWER_FLOORS.length) {
      this.clears++;
      this.bestFloor = TOWER_FLOORS.length;
      this.floor = 1;
      this.boons = [];
      this._saveProgress();
      return { clearedRun: true, nextFloor: 1 };
    }
    this.floor++;
    if (this.floor > this.bestFloor) this.bestFloor = this.floor;
    this._saveProgress();
    return { clearedRun: false, nextFloor: this.floor };
  }

  /**
   * Prepara o FEN inicial e aplica todos os Buffs/Relíquias da run no `chess` e `royale`.
   */
  prepareFloorMatch(chess, royale) {
    const cfg = this.getCurrentFloorConfig();
    const baseFen = cfg.use960 ? generateChess960Fen() : (cfg.fen || new Chess().fen());
    chess.load(baseFen);
    royale.reset(cfg.ruleset || 'heroes');

    if (this.hasBoon('max_capacitor')) {
      royale.maxEnergy = 5;
      royale.addEnergy('w', 1);
    }
    if (this.hasBoon('energy_surge')) {
      royale.addEnergy('w', 2);
    }
    if (this.hasBoon('sniper_strike')) {
      const a8 = chess.get('a8');
      if (a8 && a8.color === 'b' && a8.type !== 'k') chess.remove('a8');
    }
    if (this.hasBoon('vanguard_knight')) {
      const c2 = chess.get('c2');
      if (c2 && c2.color === 'w' && c2.type === 'p') {
        chess.remove('c2');
        chess.put({ type: 'n', color: 'w' }, 'c2');
      }
    }
    if (this.hasBoon('royal_aegis')) {
      const b = chess.board();
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          if (b[r][c]?.color === 'w' && b[r][c]?.type === 'q') {
            const files = 'abcdefgh';
            royale.shieldedSquares.set(`${files[c]}${8 - r}`, 4);
          }
        }
      }
    }
    if (this.hasBoon('frost_ambush')) {
      const b = chess.board();
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          if (b[r][c]?.color === 'b' && (b[r][c]?.type === 'q' || b[r][c]?.type === 'r')) {
            const files = 'abcdefgh';
            royale.frozenSquares.set(`${files[c]}${8 - r}`, 3);
            break;
          }
        }
      }
    }

    return cfg;
  }
}

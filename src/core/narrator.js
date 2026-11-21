/* ============================================================
   XADREZ ROYALE — Narrador & Comentarista Reativo PT-BR (Web Speech API)
   ============================================================ */

const PIECE_NAMES = {
  p: 'Peão',
  n: 'Cavalo',
  b: 'Bispo',
  r: 'Torre',
  q: 'Dama',
  k: 'Rei'
};

const BLUNDER_QUIPS = [
  'Capivara detectada! Essa peça ficou completamente pendurada!',
  'Erro grave no tabuleiro! A avaliação despencou!',
  'Ai, que entrega! O adversário agradece o presente!'
];

const BRILLIANT_QUIPS = [
  'Lance de Grande Mestre! Precisão cirúrgica!',
  'Jogada brilhante! Dominando completamente a posição!',
  'Lance fino! Pressão máxima no tabuleiro!'
];

const COMEBACK_QUIPS = [
  'Virada histórica no tabuleiro! O jogo mudou de mãos!',
  'Inacreditável! Virada dramática na partida!'
];

const OPENING_FLAVOR = {
  'Defesa Siciliana': 'Entramos na Defesa Siciliana! Prepare-se para luta assimétrica!',
  'Ruy Lopez (Espanhola)': 'Abertura Espanhola Ruy Lopez no tabuleiro! Clássico absoluto!',
  'Abertura Italiana': 'Abertura Italiana! Olho vivo no ponto f7!',
  'Gambito da Dama': 'Gambito da Dama em jogo! Luta intensa pelo centro!',
  'Defesa Francesa': 'Defesa Francesa! Cadeia de peões cerrada!',
  'Defesa Caro-Kann': 'Defesa Caro-Kann! Solidez máxima das pretas!',
  'Defesa Índia do Rei': 'Defesa Índia do Rei! Tempestade tática a caminho!'
};

export class VoiceNarrator {
  constructor() {
    this.enabled = false;
    this.lastOpeningSpoken = null;
    this.lastCommentPly = -99;
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled && typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  speak(text, priority = false) {
    if (!this.enabled || !text) return;
    if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return;
    try {
      if (priority) window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pt-BR';
      u.rate = 1.09;
      u.pitch = 1.02;
      u.volume = 0.88;
      window.speechSynthesis.speak(u);
    } catch {
      /* noop */
    }
  }

  announceMove(move, { isCheck = false, isCheckmate = false } = {}) {
    if (!this.enabled || !move) return;
    if (isCheckmate) {
      this.speak(`Xeque-mate! ${move.color === 'w' ? 'Brancas vencem a partida!' : 'Pretas vencem a partida!'}`, true);
      return;
    }
    const pieceName = PIECE_NAMES[move.piece] || 'Peça';
    if (move.flags?.includes('k')) {
      this.speak('Roque pequeno.');
      return;
    }
    if (move.flags?.includes('q')) {
      this.speak('Roque grande.');
      return;
    }
    let phrase = '';
    if (move.promotion) {
      const promoName = PIECE_NAMES[move.promotion] || 'Dama';
      phrase = `Promoção para ${promoName} em ${move.to}!`;
    } else if (move.captured) {
      const capName = PIECE_NAMES[move.captured] || 'peça';
      phrase = `${pieceName} captura ${capName} em ${move.to}.`;
    } else if (isCheck) {
      phrase = `${pieceName} em ${move.to}.`;
    }
    if (isCheck) {
      phrase = `${phrase ? phrase + ' ' : ''}Xeque ao Rei!`;
    }
    if (phrase) this.speak(phrase, isCheck);
  }

  announceOpening(op) {
    if (!this.enabled || !op || op.name === this.lastOpeningSpoken) return;
    this.lastOpeningSpoken = op.name;
    const custom = OPENING_FLAVOR[op.name];
    this.speak(custom || `Abertura detectada: ${op.name}.`);
  }

  /**
   * Reage a grandes oscilações de avaliação (Capivara ??, Virada ou Lance Fino !!)
   * @param {{ prevWhiteCp: number, newWhiteCp: number, moverColor: 'w'|'b', ply: number }} params
   * @returns {{ tag: 'blunder'|'comeback'|'brilliant'|null, text: string|null }}
   */
  reactToEvalSwing({ prevWhiteCp = 0, newWhiteCp = 0, moverColor = 'w', ply = 0 } = {}) {
    const sign = moverColor === 'w' ? 1 : -1;
    const prevMover = prevWhiteCp * sign;
    const newMover = newWhiteCp * sign;
    const delta = newMover - prevMover;

    let tag = null;
    let text = null;

    if (prevMover <= -180 && newMover >= 150) {
      tag = 'comeback';
      text = COMEBACK_QUIPS[ply % COMEBACK_QUIPS.length];
    } else if (delta <= -230) {
      tag = 'blunder';
      text = BLUNDER_QUIPS[ply % BLUNDER_QUIPS.length];
    } else if (delta >= 190 && prevMover >= -120) {
      tag = 'brilliant';
      text = BRILLIANT_QUIPS[ply % BRILLIANT_QUIPS.length];
    }

    if (tag && text && ply - this.lastCommentPly >= 2) {
      this.lastCommentPly = ply;
      this.speak(text, false);
    }
    return { tag, text };
  }

  announceEsportsEvent(eventKey) {
    if (!this.enabled) return;
    const map = {
      first_blood: 'Primeiro sangue no tabuleiro!',
      double_capture: 'Combo duplo de capturas!',
      queen_snipe: 'A Dama foi abatida!',
      royale_warning: 'Alerta vermelho! A borda externa vai desabar!',
      royale_collapse: 'Colapso da arena! O tabuleiro encolheu!',
      relic_claim: 'Relíquia ancestral coletada no centro!'
    };
    if (map[eventKey]) this.speak(map[eventKey], false);
  }

  resetMatch() {
    this.lastOpeningSpoken = null;
    this.lastCommentPly = -99;
  }
}

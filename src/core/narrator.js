/* ============================================================
   XADREZ ROYALE — Narrador de Voz em Português (Web Speech API)
   ============================================================ */

const PIECE_NAMES = {
  p: 'Peão',
  n: 'Cavalo',
  b: 'Bispo',
  r: 'Torre',
  q: 'Dama',
  k: 'Rei'
};

export class VoiceNarrator {
  constructor() {
    this.enabled = false;
    this.lastOpeningSpoken = null;
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
      u.rate = 1.08;
      u.pitch = 1.0;
      u.volume = 0.85;
      window.speechSynthesis.speak(u);
    } catch {
      /* noop */
    }
  }

  announceMove(move, { isCheck = false, isCheckmate = false } = {}) {
    if (!this.enabled || !move) return;
    if (isCheckmate) {
      this.speak(`Xeque-mate! ${move.color === 'w' ? 'Brancas vencem!' : 'Pretas vencem!'}`, true);
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
      phrase = `${pieceName} captura em ${move.to}.`;
    } else if (isCheck) {
      phrase = `${pieceName} em ${move.to}.`;
    }
    if (isCheck) {
      phrase = `${phrase ? phrase + ' ' : ''}Xeque!`;
    }
    if (phrase) this.speak(phrase, isCheck);
  }

  announceOpening(op) {
    if (!this.enabled || !op || op.name === this.lastOpeningSpoken) return;
    this.lastOpeningSpoken = op.name;
    this.speak(`Abertura: ${op.name}.`);
  }

  resetMatch() {
    this.lastOpeningSpoken = null;
  }
}

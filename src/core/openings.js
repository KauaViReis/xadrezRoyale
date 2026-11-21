/* ============================================================
   XADREZ ROYALE — Explorador de Aberturas (ECO) em Tempo Real
   ============================================================ */

export const OPENINGS_BOOK = [
  { eco: 'B90', name: 'Defesa Siciliana: Najdorf', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'] },
  { eco: 'B70', name: 'Defesa Siciliana: Dragão', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6'] },
  { eco: 'B33', name: 'Defesa Siciliana: Sveshnikov', moves: ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'e5'] },
  { eco: 'B22', name: 'Defesa Siciliana: Alapin', moves: ['e4', 'c5', 'c3'] },
  { eco: 'B23', name: 'Defesa Siciliana: Fechada', moves: ['e4', 'c5', 'Nc3'] },
  { eco: 'B50', name: 'Defesa Siciliana', moves: ['e4', 'c5', 'Nf3', 'd6'] },
  { eco: 'B30', name: 'Defesa Siciliana', moves: ['e4', 'c5', 'Nf3', 'Nc6'] },
  { eco: 'B20', name: 'Defesa Siciliana', moves: ['e4', 'c5'] },

  { eco: 'C65', name: 'Ruy Lopez: Defesa Berlim', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6'] },
  { eco: 'C68', name: 'Ruy Lopez: Variante das Trocas', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6'] },
  { eco: 'C89', name: 'Ruy Lopez: Ataque Marshall', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'O-O', 'c3', 'd5'] },
  { eco: 'C60', name: 'Abertura Espanhola (Ruy Lopez)', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'] },

  { eco: 'C54', name: 'Abertura Italiana: Giuoco Piano', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6'] },
  { eco: 'C51', name: 'Gambito Evans', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'b4'] },
  { eco: 'C55', name: 'Defesa dos Dois Cavalos', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'] },
  { eco: 'C50', name: 'Abertura Italiana', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] },

  { eco: 'C45', name: 'Abertura Escocesa', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4'] },
  { eco: 'C44', name: 'Abertura Escocesa', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'] },
  { eco: 'C42', name: 'Defesa Petrov (Russa)', moves: ['e4', 'e5', 'Nf3', 'Nf6'] },
  { eco: 'C41', name: 'Defesa Philidor', moves: ['e4', 'e5', 'Nf3', 'd6'] },
  { eco: 'C30', name: 'Gambito do Rei', moves: ['e4', 'e5', 'f4'] },
  { eco: 'C25', name: 'Partida Vienense', moves: ['e4', 'e5', 'Nc3'] },
  { eco: 'C20', name: 'Abertura do Peão do Rei', moves: ['e4', 'e5'] },

  { eco: 'C11', name: 'Defesa Francesa: Clássica', moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6'] },
  { eco: 'C02', name: 'Defesa Francesa: Avanço', moves: ['e4', 'e6', 'd4', 'd5', 'e5'] },
  { eco: 'C00', name: 'Defesa Francesa', moves: ['e4', 'e6'] },

  { eco: 'B12', name: 'Defesa Caro-Kann: Avanço', moves: ['e4', 'c6', 'd4', 'd5', 'e5'] },
  { eco: 'B18', name: 'Defesa Caro-Kann: Clássica', moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5'] },
  { eco: 'B10', name: 'Defesa Caro-Kann', moves: ['e4', 'c6'] },

  { eco: 'B01', name: 'Defesa Escandinava', moves: ['e4', 'd5'] },
  { eco: 'B07', name: 'Defesa Pirc', moves: ['e4', 'd6', 'd4', 'Nf6'] },
  { eco: 'B02', name: 'Defesa Alekhine', moves: ['e4', 'Nf6'] },
  { eco: 'B00', name: 'Abertura do Peão do Rei', moves: ['e4'] },

  { eco: 'D20', name: 'Gambito da Dama Aceito', moves: ['d4', 'd5', 'c4', 'dxc4'] },
  { eco: 'D30', name: 'Gambito da Dama Recusado', moves: ['d4', 'd5', 'c4', 'e6'] },
  { eco: 'D10', name: 'Defesa Eslava', moves: ['d4', 'd5', 'c4', 'c6'] },
  { eco: 'D06', name: 'Gambito da Dama', moves: ['d4', 'd5', 'c4'] },
  { eco: 'D02', name: 'Sistema Londres', moves: ['d4', 'd5', 'Bf4'] },
  { eco: 'A45', name: 'Sistema Londres', moves: ['d4', 'Nf6', 'Bf4'] },

  { eco: 'E60', name: 'Defesa Índia do Rei', moves: ['d4', 'Nf6', 'c4', 'g6'] },
  { eco: 'D80', name: 'Defesa Grünfeld', moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5'] },
  { eco: 'E20', name: 'Defesa Nimzo-Índia', moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'] },
  { eco: 'E12', name: 'Defesa Índia da Dama', moves: ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'b6'] },
  { eco: 'A80', name: 'Defesa Holandesa', moves: ['d4', 'f5'] },
  { eco: 'D00', name: 'Abertura do Peão da Dama', moves: ['d4', 'd5'] },
  { eco: 'A40', name: 'Abertura do Peão da Dama', moves: ['d4'] },

  { eco: 'A20', name: 'Abertura Inglesa: Siciliana Invertida', moves: ['c4', 'e5'] },
  { eco: 'A10', name: 'Abertura Inglesa', moves: ['c4'] },
  { eco: 'A04', name: 'Abertura Réti', moves: ['Nf3'] },
  { eco: 'A02', name: 'Abertura Bird', moves: ['f4'] },
  { eco: 'A01', name: 'Ataque Nimzowitsch-Larsen', moves: ['b3'] }
];

export function detectOpening(sanHistory = []) {
  if (!Array.isArray(sanHistory) || sanHistory.length === 0) return null;
  const clean = sanHistory.map(s => String(s || '').replace(/[+#?!]+$/g, ''));

  let best = null;
  for (const entry of OPENINGS_BOOK) {
    const len = entry.moves.length;
    if (len > clean.length) continue;
    let match = true;
    for (let i = 0; i < len; i++) {
      if (clean[i] !== entry.moves[i]) {
        match = false;
        break;
      }
    }
    if (match && (!best || len > best.moves.length)) {
      best = entry;
    }
  }
  return best ? { eco: best.eco, name: best.name } : null;
}

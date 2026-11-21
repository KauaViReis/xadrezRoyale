/* ============================================================
   XADREZ ROYALE — Puzzles Táticos (20 Desafios) & Balanço Material
   ============================================================ */

export const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export function computeMaterialBalance(chess) {
  let w = 0;
  let b = 0;
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = board[r][c];
      if (!cell) continue;
      const val = PIECE_VALUES[cell.type] || 0;
      if (cell.color === 'w') w += val;
      else b += val;
    }
  }
  return {
    w,
    b,
    diffW: w > b ? w - b : 0,
    diffB: b > w ? b - w : 0
  };
}

/* Cada puzzle tem `moves` em UCI (ex: 'h5f7').
   Índices pares (0, 2, ...) são lances do jogador; ímpares (1, 3, ...) são respostas automáticas do oponente. */
export const TACTICAL_PUZZLES = [
  {
    id: 'p01',
    title: 'Mate do Pastor',
    theme: 'Mate em 1',
    rating: 650,
    fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
    moves: ['h5f7']
  },
  {
    id: 'p02',
    title: 'Corredor Fatal',
    theme: 'Mate na 8ª Fileira',
    rating: 750,
    fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
    moves: ['d1d8']
  },
  {
    id: 'p03',
    title: 'O Beijo da Morte',
    theme: 'Mate em 1',
    rating: 800,
    fen: '5rk1/5ppp/8/8/3Q4/8/1B3PPP/6K1 w - - 0 1',
    moves: ['d4g7']
  },
  {
    id: 'p04',
    title: 'Mate do Louco (Pretas)',
    theme: 'Mate em 1',
    rating: 800,
    fen: 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2',
    moves: ['d8h4']
  },
  {
    id: 'p05',
    title: 'Sufocamento Real',
    theme: 'Mate de Cavalo',
    rating: 950,
    fen: '6rk/5Npp/8/8/8/8/5PPP/6K1 w - - 0 1',
    moves: ['f7h6']
  },
  {
    id: 'p06',
    title: 'Bateria Fatal',
    theme: 'Mate em 1',
    rating: 900,
    fen: '4r1k1/5ppp/8/8/8/6Q1/1B3PPP/6K1 w - - 0 1',
    moves: ['g3g7']
  },
  {
    id: 'p07',
    title: 'Captura da Dama',
    theme: 'Tática',
    rating: 1000,
    fen: 'r3k3/ppp2ppp/8/3q4/8/2N5/PPP2PPP/R3K2R w KQq - 0 1',
    moves: ['c3d5']
  },
  {
    id: 'p08',
    title: 'Dupla de Torres',
    theme: 'Mate em 2',
    rating: 1100,
    fen: 'r5k1/5ppp/8/8/8/8/3R2PP/3R2K1 w - - 0 1',
    moves: ['d2d8', 'a8d8', 'd1d8']
  },
  {
    id: 'p09',
    title: 'Promoção com Xeque-Mate',
    theme: 'Promoção',
    rating: 1050,
    fen: '6k1/4Pppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',
    moves: ['e7e8q']
  },
  {
    id: 'p10',
    title: 'Bateria Diagonal',
    theme: 'Mate em 1',
    rating: 1100,
    fen: 'r1bq1rk1/ppp2ppp/2n5/3p4/2B5/5Q2/PPPP1PPP/RNB2RK1 w - - 0 1',
    moves: ['f3f7']
  },
  {
    id: 'p11',
    title: 'Sacrifício na 8ª Fileira',
    theme: 'Mate em 2',
    rating: 1250,
    fen: '5rk1/5ppp/8/8/8/8/4QPPP/4R1K1 w - - 0 1',
    moves: ['e2e8', 'f8e8', 'e1e8']
  },
  {
    id: 'p12',
    title: 'Ataque ao Rei Exposto',
    theme: 'Mate em 1',
    rating: 1150,
    fen: 'r2q1rk1/ppp2p1p/2n3pQ/3p4/8/8/PPPP1PPP/R1B2RK1 w - - 0 1',
    moves: ['h6g7']
  },
  {
    id: 'p13',
    title: 'Mate Árabe',
    theme: 'Torre + Cavalo',
    rating: 1200,
    fen: '7k/7p/5N2/8/8/8/7P/6RK w - - 0 1',
    moves: ['g1g8']
  },
  {
    id: 'p14',
    title: 'Desvio da Defesa',
    theme: 'Mate em 1',
    rating: 1300,
    fen: '3r2k1/5ppp/8/8/8/8/4QPPP/3R2K1 w - - 0 1',
    moves: ['d1d8']
  },
  {
    id: 'p15',
    title: 'Golpe nas Pretas',
    theme: 'Mate em 1',
    rating: 1200,
    fen: '6k1/5ppp/8/8/8/8/5PPP/3q2K1 b - - 0 1',
    moves: ['d1e1']
  },
  {
    id: 'p16',
    title: 'Mate de Ópera Clássico',
    theme: 'Torre + Bispo',
    rating: 1300,
    fen: '3rkb1r/p2nqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2KR3R w k - 0 1',
    moves: ['d1d7', 'd8d7', 'h1d1']
  },
  {
    id: 'p17',
    title: 'Cravada Mortal',
    theme: 'Mate em 1',
    rating: 1250,
    fen: 'r4rk1/ppp2ppp/8/8/2B5/8/PPP2PPP/4R1K1 w - - 0 1',
    moves: ['e1e8']
  },
  {
    id: 'p18',
    title: 'Subpromoção para Cavalo',
    theme: 'Tática Avançada',
    rating: 1500,
    fen: '5k2/4P1pp/8/8/8/8/6PP/6K1 w - - 0 1',
    moves: ['e7e8q']
  },
  {
    id: 'p19',
    title: 'Invasão na Sétima',
    theme: 'Mate em 2',
    rating: 1450,
    fen: '2r3k1/5ppp/8/8/8/5Q2/5PPP/4R1K1 w - - 0 1',
    moves: ['e1e8', 'c8e8', 'f3f7']
  },
  {
    id: 'p20',
    title: 'Final de Grande Mestre',
    theme: 'Mate em 2',
    rating: 1600,
    fen: 'r4rk1/6pp/8/8/8/8/5PPP/3QR1K1 w - - 0 1',
    moves: ['d1d5', 'g8h8', 'e1e8']
  }
];

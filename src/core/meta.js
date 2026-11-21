/* ============================================================
   XADREZ ROYALE — Bots com Personalidades, Ligas Elo & Conquistas
   ============================================================ */

export const BOT_PROFILES = [
  {
    id: 'sofia',
    name: 'Sofia',
    title: 'Aprendiz do Clube',
    avatar: '🌱',
    rating: 850,
    depth: 1,
    style: 'casual',
    desc: 'Joga rápido e comete deslizes táticos ocasionais.'
  },
  {
    id: 'viktor',
    name: 'Viktor',
    title: 'Tático Agressivo',
    avatar: '⚔️',
    rating: 1350,
    depth: 2,
    style: 'aggressive',
    desc: 'Busca ataques diretos ao rei, sacrifícios e xeques.'
  },
  {
    id: 'helena',
    name: 'Helena',
    title: 'Estrategista FIDE',
    avatar: '🏛️',
    rating: 1650,
    depth: 3,
    style: 'positional',
    desc: 'Domina o centro e pune peças mal coordenadas.'
  },
  {
    id: 'stockfish',
    name: 'Stockfish 19',
    title: 'Grande Mestre NNUE',
    avatar: '🤖',
    rating: 2750,
    depth: 14,
    style: 'stockfish',
    desc: 'Motor oficial Stockfish 19 WASM em força máxima.'
  }
];

export function getBotById(id) {
  return BOT_PROFILES.find(b => b.id === id) || BOT_PROFILES[1];
}

export const LEAGUES = [
  { id: 'bronze',   name: 'Bronze',        icon: '🥉', min: 0,    max: 1099, color: '#CD7F32' },
  { id: 'silver',   name: 'Prata',         icon: '🥈', min: 1100, max: 1299, color: '#C0C6CF' },
  { id: 'gold',     name: 'Ouro',          icon: '🥇', min: 1300, max: 1499, color: '#E6B84D' },
  { id: 'diamond',  name: 'Diamante',      icon: '💎', min: 1500, max: 1799, color: '#45C4F9' },
  { id: 'master',   name: 'Mestre',        icon: '👑', min: 1800, max: 2099, color: '#C99A3E' },
  { id: 'gm',       name: 'Grande Mestre', icon: '⚜️', min: 2100, max: Infinity, color: '#FF5FA2' }
];

export function getLeague(rating = 1200) {
  const r = Number.isFinite(rating) ? rating : 1200;
  let cur = LEAGUES[0];
  for (const lg of LEAGUES) {
    if (r >= lg.min) cur = lg;
  }
  return cur;
}

export const ACHIEVEMENTS = [
  { id: 'first_win',    icon: '🏆', name: 'Primeira Vitória',   desc: 'Vença sua primeira partida no Xadrez Royale.' },
  { id: 'checkmate',    icon: '♚',  name: 'Xeque-Mate Real',    desc: 'Vença uma partida aplicando Xeque-Mate.' },
  { id: 'scholar',      icon: '⚡',  name: 'Relâmpago',          desc: 'Vença uma partida em até 16 lances (32 plies).' },
  { id: 'castle_win',   icon: '🏰', name: 'Fortaleza Segura',   desc: 'Faça o roque e vença a partida.' },
  { id: 'promo_win',    icon: '👑', name: 'Coroação Imperial',  desc: 'Promova um peão e vença a partida.' },
  { id: 'streak_3',     icon: '🔥', name: 'Imparável (3x)',     desc: 'Alcance uma sequência de 3 vitórias seguidas.' },
  { id: 'beat_helena',  icon: '🏛️', name: 'Mestre do Clube',    desc: 'Derrote a estrategista Helena ou o Stockfish 19.' }
];

export function evaluateMatchAchievements({ won, isCheckmate, pliesCount, castled, promoted, streak = 0, botId = null }) {
  const unlocked = [];
  if (!won) return unlocked;
  unlocked.push('first_win');
  if (isCheckmate) unlocked.push('checkmate');
  if (pliesCount > 0 && pliesCount <= 32) unlocked.push('scholar');
  if (castled) unlocked.push('castle_win');
  if (promoted) unlocked.push('promo_win');
  if (streak >= 3) unlocked.push('streak_3');
  if (botId === 'helena' || botId === 'stockfish') unlocked.push('beat_helena');
  return unlocked;
}

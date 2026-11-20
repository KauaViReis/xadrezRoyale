export const RATING_INICIAL = 1200;

export function kFactor(games, rating) {
  if (games < 15) return 40;
  if (rating >= 2100) return 10;
  return 20;
}

export function expectedScore(myRating, oppRating) {
  return 1 / (1 + Math.pow(10, (oppRating - myRating) / 400));
}

export function eloDelta(myRating, oppRating, score, games = 0) {
  const k = kFactor(games, myRating);
  return Math.round(k * (score - expectedScore(myRating, oppRating)));
}

export function formatClock(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '--:--';
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

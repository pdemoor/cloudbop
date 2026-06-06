export function getSecondsUntil5am() {
  const now = new Date();
  const next5am = new Date();
  next5am.setHours(5, 0, 0, 0);
  // If it's already past 5am today, target tomorrow's 5am
  if (now >= next5am) next5am.setDate(next5am.getDate() + 1);
  return Math.floor((next5am - now) / 1000);
}

export function formatCountdown(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

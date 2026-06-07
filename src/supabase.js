import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = 'https://oqxjclyotquyhuscciiw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_eO8R92a_GeSPV40wkarJsA_GTVN8eoS';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Player identity ──────────────────────────────────────────────────────────

export function getPlayerId() {
  let id = localStorage.getItem('cloudbop_player_id');
  if (!id) {
    id = 'p_' + Math.random().toString(36).slice(2) + Date.now();
    localStorage.setItem('cloudbop_player_id', id);
  }
  return id;
}

// ── Score helpers ────────────────────────────────────────────────────────────

export async function submitDailyScore(score, initials = null) {
  const player_id = getPlayerId();
  const payload = { player_id, score };
  if (initials && initials.trim().length > 0) {
    payload.initials = initials.toUpperCase().slice(0, 3);
  }
  const { data, error } = await supabase
    .from('daily_scores')
    .insert(payload)
    .select();
  if (error) console.error('Score submit error:', error);
  return data;
}

export async function getTopDaily() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('daily_scores')
    .select('score, initials')
    .gte('created_at', since)
    .order('score', { ascending: false })
    .limit(500); // fetch more so dedup has enough data
  if (error) { console.error('Leaderboard error:', error); return []; }

  // Deduplicate — keep highest score per initials.
  // Since results are sorted desc, first occurrence is always the best.
  // Anonymous entries (no initials) are each kept as-is.
  const seen = new Map();
  const deduped = [];
  for (const entry of (data ?? [])) {
    if (!entry.initials) {
      // Anonymous — always include
      deduped.push(entry);
    } else {
      const key = entry.initials.toUpperCase().trim();
      if (!seen.has(key)) {
        seen.set(key, true);
        deduped.push(entry);
      }
      // Duplicate initials with lower score — skip
    }
  }
  return deduped.slice(0, 100);
}

export async function initialsAlreadyHasHigherScore(initials, newScore) {
  if (!initials || initials.trim().length !== 3) return false;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('daily_scores')
    .select('score')
    .eq('initials', initials.toUpperCase().trim())
    .gte('created_at', since)
    .order('score', { ascending: false })
    .limit(1);
  if (error) return false;
  if (!data || data.length === 0) return false;
  return data[0].score >= newScore;
}

export async function getDailyBest() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('daily_scores')
    .select('score')
    .gte('created_at', since)
    .order('score', { ascending: false })
    .limit(1);
  if (error) { console.error('Best score error:', error); return null; }
  return data?.[0]?.score ?? null;
}

// ── Daily comp gate ──────────────────────────────────────────────────────────

// Returns the timestamp (ms) of the most recent 5am that has already passed
function getLast5am() {
  const now = new Date();
  const todayAt5am = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    5, 0, 0, 0
  );
  if (now >= todayAt5am) {
    // We are past today's 5am — use today's 5am
    return todayAt5am.getTime();
  } else {
    // We are before today's 5am — use yesterday's 5am
    const yesterdayAt5am = new Date(todayAt5am);
    yesterdayAt5am.setDate(yesterdayAt5am.getDate() - 1);
    return yesterdayAt5am.getTime();
  }
}

export function hasPlayedToday() {
  const last = localStorage.getItem('cloudbop_last_comp');
  if (!last) return false;
  const lastPlayed = parseInt(last);
  // Player has played in the current 5am–5am window if their last play
  // timestamp is after the most recent 5am boundary
  return lastPlayed >= getLast5am();
}

export function markPlayedToday() {
  localStorage.setItem('cloudbop_last_comp', Date.now().toString());
}

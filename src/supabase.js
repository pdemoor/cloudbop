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
  if (initials) payload.initials = initials.toUpperCase().slice(0, 3);
  const { error } = await supabase
    .from('daily_scores')
    .insert(payload);
  if (error) console.error('Score submit error:', error);
}

export async function getTopDaily() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('daily_scores')
    .select('score, initials')
    .gte('created_at', since)
    .order('score', { ascending: false })
    .limit(100);
  if (error) { console.error('Leaderboard error:', error); return []; }
  return data ?? [];
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

export function hasPlayedToday() {
  const last = localStorage.getItem('cloudbop_last_comp');
  if (!last) return false;
  const lastDate = new Date(parseInt(last));
  const now = new Date();
  return lastDate.toDateString() === now.toDateString();
}

export function markPlayedToday() {
  localStorage.setItem('cloudbop_last_comp', Date.now().toString());
}

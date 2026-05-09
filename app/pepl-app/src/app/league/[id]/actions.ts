// =============================================================================
// League server actions — round/event creation, picks, resolution, finalize.
// All writes are gated by RLS or by SECURITY DEFINER Postgres functions.
// =============================================================================
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// ----- Season ---------------------------------------------------------------
export async function startSeasonAction(formData: FormData) {
  const seasonId = String(formData.get('season_id') ?? '');
  const leagueId = String(formData.get('league_id') ?? '');
  if (!seasonId) throw new Error('season_id required');

  const supabase = await createClient();
  const { error } = await supabase.rpc('start_season', { p_season_id: seasonId });
  if (error) throw new Error(error.message);

  revalidatePath(`/league/${leagueId}`);
}

// ----- Rounds ---------------------------------------------------------------
export async function createRoundAction(formData: FormData) {
  const seasonId = String(formData.get('season_id') ?? '');
  const leagueId = String(formData.get('league_id') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  if (!seasonId || !title) throw new Error('season_id and title required');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Compute next round_number
  const { data: existing = [] } = await supabase
    .from('rounds')
    .select('round_number')
    .eq('season_id', seasonId);
  const nextNum = (existing?.length ?? 0) + 1;

  const { error } = await supabase.from('rounds').insert({
    season_id: seasonId,
    round_number: nextNum,
    title,
    status: 'open',
  });
  if (error) throw error;

  revalidatePath(`/league/${leagueId}`);
}

// ----- Events ---------------------------------------------------------------
export async function createEventAction(formData: FormData) {
  const roundId = String(formData.get('round_id') ?? '');
  const leagueId = String(formData.get('league_id') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const prompt = String(formData.get('prompt') ?? '').trim();
  const lockMinutes = parseInt(String(formData.get('lock_minutes') ?? '60'), 10);

  if (!roundId || !title || !prompt) {
    throw new Error('round_id, title, and prompt are required');
  }

  const lockAt = new Date(Date.now() + lockMinutes * 60_000).toISOString();
  const supabase = await createClient();

  const { error } = await supabase.from('events').insert({
    round_id: roundId,
    title,
    prompt,
    pick_lock_at: lockAt,
    status: 'open',
  });
  if (error) throw error;

  revalidatePath(`/league/${leagueId}`);
}

export async function forceLockEventAction(formData: FormData) {
  const eventId = String(formData.get('event_id') ?? '');
  const leagueId = String(formData.get('league_id') ?? '');
  if (!eventId) throw new Error('event_id required');

  const supabase = await createClient();
  // Note: this UPDATE goes through events_block_edit_after_picks trigger,
  // which blocks pick_lock_at edits if picks exist. We bypass by setting only
  // status — wait, actually setting pick_lock_at IS what the trigger blocks.
  // Solution: set lock to now() via a SECURITY DEFINER RPC if we want this
  // feature to work post-pick. For now, only set status='locked' which the
  // trigger allows. The lock check uses pick_lock_at, so we'd need either
  // (a) trigger relaxation for "lock to now" or
  // (b) a dedicated lock_event() RPC. Going with (b) below.
  const { error } = await supabase.rpc('lock_event_now', { p_event_id: eventId });
  if (error) throw new Error(error.message);

  revalidatePath(`/league/${leagueId}`);
}

// ----- Picks ----------------------------------------------------------------
export async function submitPickAction(formData: FormData) {
  const eventId = String(formData.get('event_id') ?? '');
  const leagueId = String(formData.get('league_id') ?? '');
  const choice = String(formData.get('choice') ?? '');
  if (!eventId || !['yes', 'no'].includes(choice)) {
    throw new Error('event_id and valid choice required');
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Upsert: one pick per (event_id, user_id). The picks_validate trigger
  // enforces lock-time, elimination, and participation rules.
  const { error } = await supabase
    .from('picks')
    .upsert(
      {
        event_id: eventId,
        user_id: user.id,
        choice,
        submitted_at: new Date().toISOString(),
      },
      { onConflict: 'event_id,user_id' }
    );
  if (error) throw new Error(error.message);

  revalidatePath(`/league/${leagueId}`);
}

// ----- Resolve event --------------------------------------------------------
export async function resolveEventAction(formData: FormData) {
  const eventId = String(formData.get('event_id') ?? '');
  const leagueId = String(formData.get('league_id') ?? '');
  const outcome = String(formData.get('outcome') ?? '');
  if (!eventId || !['yes', 'no'].includes(outcome)) {
    throw new Error('event_id and valid outcome required');
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('resolve_event', {
    p_event_id: eventId,
    p_outcome: outcome,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/league/${leagueId}`);
}

// ----- Finalize round (the big one) -----------------------------------------
export async function finalizeRoundAction(formData: FormData) {
  const roundId = String(formData.get('round_id') ?? '');
  const leagueId = String(formData.get('league_id') ?? '');
  if (!roundId) throw new Error('round_id required');

  const supabase = await createClient();
  // Calls the atomic finalize_round() Postgres function.
  // On exception, the entire transaction rolls back — no partial scoring.
  const { error } = await supabase.rpc('finalize_round', { p_round_id: roundId });
  if (error) throw new Error(error.message);

  revalidatePath(`/league/${leagueId}`);
}

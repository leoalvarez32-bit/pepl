// =============================================================================
// Dashboard server actions — createLeague, joinLeague, signOut.
// All multi-table writes go through SECURITY DEFINER Postgres functions
// (see supabase/migrations/0004_app_functions.sql) for atomicity.
// =============================================================================
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function createLeagueAction(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  const sourceOfTruth = String(formData.get('source_of_truth') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();

  if (!name || !sourceOfTruth) {
    throw new Error('Name and source_of_truth are required');
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: leagueId, error } = await supabase.rpc('create_league', {
    p_name: name,
    p_source_of_truth: sourceOfTruth,
    p_description: description || null,
  });
  if (error) throw error;

  revalidatePath('/dashboard');
  redirect(`/league/${leagueId}`);
}

export async function joinLeagueAction(formData: FormData) {
  const code = String(formData.get('code') ?? '').trim().toUpperCase();
  if (!code) throw new Error('Invite code required');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: leagueId, error } = await supabase.rpc('join_league_by_code', {
    p_code: code,
  });
  if (error) throw new Error(error.message);
  if (!leagueId) throw new Error('Invalid invite code');

  revalidatePath('/dashboard');
  redirect(`/league/${leagueId}`);
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

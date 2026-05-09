-- =============================================================================
-- PEPL — RLS Policies (Migration 0002)
-- Implements PRD §11 (Access Control) at the database layer.
-- All tables get RLS ON. Server-side checks are mandatory (PRD §15.3).
-- =============================================================================

-- ----- Helper functions ----------------------------------------------------
-- These are used by the policies below. Marked STABLE so PostgreSQL caches
-- per-row evaluations within a single statement.

create or replace function public.is_league_member(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.league_memberships
    where league_id = p_league_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_league_admin(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.leagues
    where id = p_league_id and admin_user_id = auth.uid()
  );
$$;

create or replace function public.season_league_id(p_season_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select league_id from public.seasons where id = p_season_id;
$$;

create or replace function public.round_league_id(p_round_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.league_id
  from public.rounds r
  join public.seasons s on s.id = r.season_id
  where r.id = p_round_id;
$$;

create or replace function public.event_league_id(p_event_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.league_id
  from public.events e
  join public.rounds r on r.id = e.round_id
  join public.seasons s on s.id = r.season_id
  where e.id = p_event_id;
$$;

-- =============================================================================
-- Enable RLS on every table
-- =============================================================================
alter table public.profiles             enable row level security;
alter table public.leagues              enable row level security;
alter table public.league_memberships   enable row level security;
alter table public.seasons              enable row level security;
alter table public.rounds               enable row level security;
alter table public.events               enable row level security;
alter table public.picks                enable row level security;
alter table public.season_participants  enable row level security;
alter table public.credit_ledger        enable row level security;

-- =============================================================================
-- profiles
-- - Read: any authenticated user (display names are not private)
-- - Update: own row only
-- - Insert: blocked (handled by trigger on auth.users)
-- =============================================================================
create policy "profiles_read_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles_update_self"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- =============================================================================
-- leagues
-- - Read: members only
-- - Insert: any authenticated user (becomes admin via app layer assigning admin_user_id = auth.uid())
-- - Update/Delete: admin only
-- =============================================================================
create policy "leagues_read_members"
  on public.leagues for select
  to authenticated
  using (public.is_league_member(id));

create policy "leagues_insert_self_admin"
  on public.leagues for insert
  to authenticated
  with check (admin_user_id = auth.uid());

create policy "leagues_update_admin"
  on public.leagues for update
  to authenticated
  using (admin_user_id = auth.uid())
  with check (admin_user_id = auth.uid());

create policy "leagues_delete_admin"
  on public.leagues for delete
  to authenticated
  using (admin_user_id = auth.uid());

-- =============================================================================
-- league_memberships
-- - Read: visible to other members of the same league
-- - Insert: self only (joining a league creates own membership)
-- - Delete: self (leave) or admin (kick)
-- =============================================================================
create policy "memberships_read_co_members"
  on public.league_memberships for select
  to authenticated
  using (public.is_league_member(league_id));

create policy "memberships_insert_self"
  on public.league_memberships for insert
  to authenticated
  with check (user_id = auth.uid() and role = 'member');

create policy "memberships_delete_self_or_admin"
  on public.league_memberships for delete
  to authenticated
  using (user_id = auth.uid() or public.is_league_admin(league_id));

-- =============================================================================
-- seasons
-- - Read: members
-- - Write: admin only (via Insert/Update; Delete cascades from league)
-- =============================================================================
create policy "seasons_read_members"
  on public.seasons for select
  to authenticated
  using (public.is_league_member(league_id));

create policy "seasons_insert_admin"
  on public.seasons for insert
  to authenticated
  with check (public.is_league_admin(league_id));

create policy "seasons_update_admin"
  on public.seasons for update
  to authenticated
  using (public.is_league_admin(league_id))
  with check (public.is_league_admin(league_id));

-- =============================================================================
-- rounds
-- - Read: members
-- - Write: admin only
-- (finalize_round() runs as SECURITY DEFINER so it bypasses these policies.)
-- =============================================================================
create policy "rounds_read_members"
  on public.rounds for select
  to authenticated
  using (public.is_league_member(public.season_league_id(season_id)));

create policy "rounds_insert_admin"
  on public.rounds for insert
  to authenticated
  with check (public.is_league_admin(public.season_league_id(season_id)));

create policy "rounds_update_admin"
  on public.rounds for update
  to authenticated
  using (public.is_league_admin(public.season_league_id(season_id)))
  with check (public.is_league_admin(public.season_league_id(season_id)));

-- =============================================================================
-- events
-- - Read: members
-- - Write: admin only (with the §7.6 trigger blocking content edits after picks)
-- =============================================================================
create policy "events_read_members"
  on public.events for select
  to authenticated
  using (public.is_league_member(public.round_league_id(round_id)));

create policy "events_insert_admin"
  on public.events for insert
  to authenticated
  with check (public.is_league_admin(public.round_league_id(round_id)));

create policy "events_update_admin"
  on public.events for update
  to authenticated
  using (public.is_league_admin(public.round_league_id(round_id)))
  with check (public.is_league_admin(public.round_league_id(round_id)));

-- =============================================================================
-- picks
-- - Read: members (transparency; UI hides until lock if desired)
-- - Insert/Update: own picks only, validated by picks_validate trigger
-- - Delete: blocked (immutable for audit)
-- =============================================================================
create policy "picks_read_members"
  on public.picks for select
  to authenticated
  using (public.is_league_member(public.event_league_id(event_id)));

create policy "picks_insert_self"
  on public.picks for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_league_member(public.event_league_id(event_id))
  );

create policy "picks_update_self"
  on public.picks for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =============================================================================
-- season_participants
-- - Read: members
-- - Insert: self only (via joinLeague flow)
-- - Update: blocked at policy level — only finalize_round() (SECURITY DEFINER) updates these
-- =============================================================================
create policy "participants_read_members"
  on public.season_participants for select
  to authenticated
  using (public.is_league_member(public.season_league_id(season_id)));

create policy "participants_insert_self"
  on public.season_participants for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_league_member(public.season_league_id(season_id))
  );

-- No update or delete policy — locked to SECURITY DEFINER functions.

-- =============================================================================
-- credit_ledger
-- - Read: members of the league (transparency, PRD §15.4)
-- - Insert: blocked at policy level — only finalize_round() inserts
-- =============================================================================
create policy "ledger_read_members"
  on public.credit_ledger for select
  to authenticated
  using (public.is_league_member(public.season_league_id(season_id)));

-- No insert policy — locked to SECURITY DEFINER functions.

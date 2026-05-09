-- =============================================================================
-- PEPL — App Helper Functions (Migration 0004)
--
-- These SECURITY DEFINER functions encapsulate multi-table writes that would
-- otherwise require either (a) loosening RLS or (b) multi-step server actions
-- with risk of partial failure.
--
-- They handle:
--   - create_league(): league + season + admin membership + admin participant
--   - join_league_by_code(): invite-code lookup + membership + participant
--   - league_invite_code(): canonical invite code derivation
-- =============================================================================

-- ----- Invite code derivation ----------------------------------------------
-- The invite code is the first 6 hex chars of the league UUID, uppercase.
-- This is collision-resistant for the small-group scale we target. For larger
-- scale, replace with a dedicated invite_codes table.
create or replace function public.league_invite_code(p_league_id uuid)
returns text
language sql
immutable
as $$
  select upper(substring(replace(p_league_id::text, '-', ''), 1, 6));
$$;

-- ----- Lookup league by invite code ----------------------------------------
-- Public: any authenticated user can resolve a code (so they can join).
-- Returns league_id or null.
create or replace function public.league_by_invite_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league_id uuid;
  v_normalized text := upper(trim(p_code));
begin
  if v_normalized is null or length(v_normalized) <> 6 then
    return null;
  end if;

  select id into v_league_id
    from public.leagues
    where public.league_invite_code(id) = v_normalized
    limit 1;

  return v_league_id;
end;
$$;

grant execute on function public.league_by_invite_code(text) to authenticated;

-- ----- create_league -------------------------------------------------------
-- Atomically creates: league, season 1, admin membership, admin participant.
create or replace function public.create_league(
  p_name             text,
  p_source_of_truth  text,
  p_description      text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller    uuid := auth.uid();
  v_league_id uuid;
  v_season_id uuid;
begin
  if v_caller is null then
    raise exception 'Authentication required';
  end if;

  -- Insert league
  insert into public.leagues (name, admin_user_id, source_of_truth, description, status)
    values (p_name, v_caller, p_source_of_truth, p_description, 'draft')
    returning id into v_league_id;

  -- Admin membership (role='admin' — bypasses the memberships_insert_self
  -- check which mandates 'member', because we run as SECURITY DEFINER).
  insert into public.league_memberships (league_id, user_id, role)
    values (v_league_id, v_caller, 'admin');

  -- Season 1 (defaults: 6 rounds, 100 credits, -5 per wrong)
  insert into public.seasons (league_id, season_number)
    values (v_league_id, 1)
    returning id into v_season_id;

  -- Admin's participant row
  insert into public.season_participants (season_id, user_id, credits_remaining)
    values (v_season_id, v_caller, (select starting_credits from public.seasons where id = v_season_id));

  return v_league_id;
end;
$$;

grant execute on function public.create_league(text, text, text) to authenticated;

-- ----- join_league_by_code -------------------------------------------------
-- Atomically: creates membership + participant for the active season.
create or replace function public.join_league_by_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller    uuid := auth.uid();
  v_league_id uuid;
  v_season    public.seasons%rowtype;
begin
  if v_caller is null then
    raise exception 'Authentication required';
  end if;

  v_league_id := public.league_by_invite_code(p_code);
  if v_league_id is null then
    raise exception 'Invalid invite code';
  end if;

  -- Idempotent: skip if already a member
  if not exists (
    select 1 from public.league_memberships
    where league_id = v_league_id and user_id = v_caller
  ) then
    insert into public.league_memberships (league_id, user_id, role)
      values (v_league_id, v_caller, 'member');
  end if;

  -- Attach to the latest non-completed season, if one exists
  select * into v_season
    from public.seasons
    where league_id = v_league_id and status <> 'completed'
    order by season_number desc
    limit 1;

  if found then
    insert into public.season_participants (season_id, user_id, credits_remaining)
      values (v_season.id, v_caller, v_season.starting_credits)
      on conflict (season_id, user_id) do nothing;
  end if;

  return v_league_id;
end;
$$;

grant execute on function public.join_league_by_code(text) to authenticated;

-- ----- start_season --------------------------------------------------------
-- Convenience wrapper: admin starts season + flips league status to 'active'.
create or replace function public.start_season(p_season_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller   uuid := auth.uid();
  v_season   public.seasons%rowtype;
  v_league   public.leagues%rowtype;
begin
  select * into v_season from public.seasons where id = p_season_id;
  if not found then raise exception 'Season not found'; end if;

  select * into v_league from public.leagues where id = v_season.league_id;
  if v_league.admin_user_id <> v_caller then
    raise exception 'Only the league admin can start the season';
  end if;
  if v_season.status <> 'not_started' then
    raise exception 'Season is already %', v_season.status;
  end if;

  update public.seasons
    set status = 'in_progress', start_date = now()
    where id = p_season_id;

  update public.leagues
    set status = 'active'
    where id = v_season.league_id;
end;
$$;

grant execute on function public.start_season(uuid) to authenticated;

-- ----- lock_event_now ------------------------------------------------------
-- Demo helper: force lock an event immediately. Bypasses the
-- events_block_edit_after_picks trigger because we want this to work even
-- after picks exist. Only league admin may call.
create or replace function public.lock_event_now(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller     uuid := auth.uid();
  v_league_id  uuid := public.event_league_id(p_event_id);
  v_admin      uuid;
begin
  select admin_user_id into v_admin from public.leagues where id = v_league_id;
  if v_admin is null or v_admin <> v_caller then
    raise exception 'Only the league admin can lock events';
  end if;

  -- Direct UPDATE without firing the content-edit trigger:
  -- The trigger only blocks if pick_lock_at IS DISTINCT FROM old.pick_lock_at
  -- AND picks exist. Here we explicitly set both pick_lock_at and status,
  -- but the trigger won't allow the pick_lock_at change if picks exist.
  -- So we use ALTER TABLE ... DISABLE TRIGGER pattern via SECURITY DEFINER:
  set local session_replication_role = 'replica';
  update public.events
    set pick_lock_at = now(), status = 'locked'
    where id = p_event_id and resolved_outcome is null;
  set local session_replication_role = 'origin';
end;
$$;

grant execute on function public.lock_event_now(uuid) to authenticated;

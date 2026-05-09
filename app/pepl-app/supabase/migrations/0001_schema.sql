-- =============================================================================
-- PEPL — Schema Migration 0001
-- Implements PRD §9 (Data Model) + §10 (Status Values) + §14 (Validation)
-- =============================================================================

-- ----- profiles ------------------------------------------------------------
-- Mirrors auth.users. Auto-created via trigger on auth user signup.
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 60),
  created_at   timestamptz not null default now()
);

-- Auto-insert a profile row when a new auth user is created.
-- display_name pulled from raw_user_meta_data.display_name; falls back to email local-part.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'display_name', ''),
      split_part(new.email, '@', 1)
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----- leagues -------------------------------------------------------------
create table public.leagues (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(name) between 1 and 80),
  admin_user_id   uuid not null references public.profiles(id) on delete restrict,
  source_of_truth text not null check (length(source_of_truth) between 1 and 500),
  description     text,
  status          text not null default 'draft'
                    check (status in ('draft', 'active', 'completed')),
  created_at      timestamptz not null default now()
);

create index leagues_admin_idx on public.leagues(admin_user_id);

-- ----- league_memberships --------------------------------------------------
create table public.league_memberships (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references public.leagues(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'member' check (role in ('admin', 'member')),
  joined_at  timestamptz not null default now(),
  unique (league_id, user_id)
);

create index league_memberships_user_idx on public.league_memberships(user_id);
create index league_memberships_league_idx on public.league_memberships(league_id);

-- ----- seasons -------------------------------------------------------------
create table public.seasons (
  id                          uuid primary key default gen_random_uuid(),
  league_id                   uuid not null references public.leagues(id) on delete cascade,
  season_number               int not null check (season_number > 0),
  rounds_total                int not null default 6 check (rounds_total > 0),
  starting_credits            int not null default 100 check (starting_credits > 0),
  credit_loss_per_wrong_pick  int not null default 5 check (credit_loss_per_wrong_pick > 0),
  status                      text not null default 'not_started'
                                check (status in ('not_started', 'in_progress', 'completed')),
  start_date                  timestamptz,
  end_date                    timestamptz,
  created_at                  timestamptz not null default now(),
  unique (league_id, season_number)
);

create index seasons_league_idx on public.seasons(league_id);

-- ----- rounds --------------------------------------------------------------
create table public.rounds (
  id                    uuid primary key default gen_random_uuid(),
  season_id             uuid not null references public.seasons(id) on delete cascade,
  round_number          int not null check (round_number > 0),
  title                 text not null check (length(title) between 1 and 120),
  status                text not null default 'open'
                          check (status in ('open', 'locked', 'resolved')),
  picks_open_at         timestamptz not null default now(),
  round_lock_at         timestamptz,
  finalized_at          timestamptz,
  finalized_by_user_id  uuid references public.profiles(id),
  created_at            timestamptz not null default now(),
  unique (season_id, round_number)
);

create index rounds_season_idx on public.rounds(season_id);

-- ----- events --------------------------------------------------------------
create table public.events (
  id                    uuid primary key default gen_random_uuid(),
  round_id              uuid not null references public.rounds(id) on delete cascade,
  title                 text not null check (length(title) between 1 and 200),
  prompt                text not null check (length(prompt) between 1 and 500),
  start_time            timestamptz not null default now(),
  pick_lock_at          timestamptz not null,
  status                text not null default 'open'
                          check (status in ('open', 'locked', 'resolved')),
  resolved_outcome      text check (resolved_outcome in ('yes', 'no')),
  resolved_by_user_id   uuid references public.profiles(id),
  resolved_at           timestamptz,
  created_at            timestamptz not null default now(),
  -- If resolved, must have all resolution fields
  check ((resolved_outcome is null) = (resolved_at is null)),
  check ((resolved_outcome is null) = (resolved_by_user_id is null))
);

create index events_round_idx on public.events(round_id);

-- ----- picks ---------------------------------------------------------------
create table public.picks (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  choice        text not null check (choice in ('yes', 'no')),
  submitted_at  timestamptz not null default now(),
  unique (event_id, user_id)
);

create index picks_event_idx on public.picks(event_id);
create index picks_user_idx on public.picks(user_id);

-- ----- season_participants -------------------------------------------------
create table public.season_participants (
  id                      uuid primary key default gen_random_uuid(),
  season_id               uuid not null references public.seasons(id) on delete cascade,
  user_id                 uuid not null references public.profiles(id) on delete cascade,
  credits_remaining       int not null default 100 check (credits_remaining >= 0),
  wrong_picks_count       int not null default 0 check (wrong_picks_count >= 0),
  correct_picks_count     int not null default 0 check (correct_picks_count >= 0),
  is_eliminated           boolean not null default false,
  eliminated_at           timestamptz,
  created_at              timestamptz not null default now(),
  unique (season_id, user_id),
  -- Coherence: if eliminated, eliminated_at and credits_remaining=0 must align
  check ((is_eliminated = false) or (eliminated_at is not null))
);

create index season_participants_season_idx on public.season_participants(season_id);
create index season_participants_user_idx on public.season_participants(user_id);

-- ----- credit_ledger -------------------------------------------------------
create table public.credit_ledger (
  id            uuid primary key default gen_random_uuid(),
  season_id     uuid not null references public.seasons(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  event_id      uuid references public.events(id) on delete set null,
  round_number  int not null,
  delta         int not null,
  reason        text not null check (reason in ('Wrong pick', 'No pick forfeiture')),
  created_at    timestamptz not null default now()
);

create index credit_ledger_season_user_idx on public.credit_ledger(season_id, user_id);
create index credit_ledger_created_at_idx on public.credit_ledger(created_at desc);

-- =============================================================================
-- VALIDATION TRIGGERS — encode PRD §14 invariants at the DB layer
-- =============================================================================

-- 7.6: Event cannot be edited once at least one pick exists.
-- Allow only resolution fields to change; block edits to title/prompt/lock.
create or replace function public.events_block_edit_after_picks()
returns trigger
language plpgsql
as $$
begin
  -- Resolution updates (status/resolved_outcome/...) are always allowed.
  -- Reject edits to content fields if any pick exists.
  if (
    new.title       is distinct from old.title
    or new.prompt   is distinct from old.prompt
    or new.start_time is distinct from old.start_time
    or new.pick_lock_at is distinct from old.pick_lock_at
  ) and exists (select 1 from public.picks where event_id = old.id) then
    raise exception 'Event content cannot be edited once at least one pick exists (PRD §7.6)';
  end if;
  return new;
end;
$$;

create trigger events_block_edit_after_picks
  before update on public.events
  for each row execute function public.events_block_edit_after_picks();

-- Picks: enforce lock time + elimination at insert/update time.
-- (Also enforced at app layer — defence in depth.)
create or replace function public.picks_validate()
returns trigger
language plpgsql
as $$
declare
  v_event events%rowtype;
  v_round rounds%rowtype;
  v_participant season_participants%rowtype;
begin
  select * into v_event from public.events where id = new.event_id;
  if v_event.pick_lock_at <= now() then
    raise exception 'Picks are locked for this event (PRD §7.7)';
  end if;
  if v_event.resolved_outcome is not null then
    raise exception 'Cannot pick after event is resolved';
  end if;

  select * into v_round from public.rounds where id = v_event.round_id;
  select * into v_participant from public.season_participants
    where season_id = v_round.season_id and user_id = new.user_id;
  if not found then
    raise exception 'User is not a participant in this season';
  end if;
  if v_participant.is_eliminated then
    raise exception 'Eliminated participants cannot submit picks (PRD §7.7)';
  end if;

  return new;
end;
$$;

create trigger picks_validate_insert
  before insert or update on public.picks
  for each row execute function public.picks_validate();

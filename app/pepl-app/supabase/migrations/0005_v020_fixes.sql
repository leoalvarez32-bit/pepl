-- =============================================================================
-- PEPL v0.2.0 — Bug Fix Migrations (Migration 0005)
--
-- Applies the same fixes that landed in pepl-prototype.html v0.2.0:
--   - Bug #3: track forfeit picks separately from wrong picks so the accuracy
--     metric measures pick quality, not absenteeism.
--
-- Bug #1 (dead-end "Not a member" screen) is a UI-only fix and lives in the
-- Next.js layer — see src/app/league/[id]/page.tsx in the v0.2.0 scaffold.
--
-- Bug #2 (admin/player conflict-of-interest confirmation) is also UI-only —
-- see the resolve-confirmation panel in src/app/league/[id]/page.tsx.
-- =============================================================================

-- ----- Add forfeit_picks_count column --------------------------------------
alter table public.season_participants
  add column if not exists forfeit_picks_count int not null default 0
    check (forfeit_picks_count >= 0);

-- ----- Update finalize_round() to track forfeits separately ----------------
-- Same logic as the v0.1.0 function but with the wrong/forfeit split.
-- Credit deduction unchanged (still -credit_loss_per_wrong_pick for both).

create or replace function public.finalize_round(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller         uuid := auth.uid();
  v_round          public.rounds%rowtype;
  v_season         public.seasons%rowtype;
  v_league         public.leagues%rowtype;
  v_event          public.events%rowtype;
  v_participant    public.season_participants%rowtype;
  v_pick           public.picks%rowtype;
  v_wrong          int;
  v_correct        int;
  v_forfeit        int;  -- NEW in v0.2.0
  v_new_credits    int;
  v_finalized_cnt  int;
  v_unresolved_cnt int;
begin
  if v_caller is null then
    raise exception 'Authentication required';
  end if;

  select * into v_round from public.rounds where id = p_round_id for update;
  if not found then raise exception 'Round not found'; end if;
  if v_round.finalized_at is not null then
    raise exception 'Round already finalized';
  end if;

  select * into v_season from public.seasons where id = v_round.season_id;
  select * into v_league from public.leagues where id = v_season.league_id;

  if v_league.admin_user_id <> v_caller then
    raise exception 'Only the league admin can finalize rounds';
  end if;
  if v_season.status <> 'in_progress' then
    raise exception 'Season is not in progress (status = %)', v_season.status;
  end if;

  if not exists (select 1 from public.events where round_id = p_round_id) then
    raise exception 'Cannot finalize a round with no events';
  end if;

  select count(*) into v_unresolved_cnt
    from public.events
    where round_id = p_round_id and resolved_outcome is null;

  if v_unresolved_cnt > 0 then
    raise exception 'All events must be resolved before finalizing the round (% unresolved)',
      v_unresolved_cnt;
  end if;

  for v_participant in
    select * from public.season_participants
      where season_id = v_season.id and is_eliminated = false
      for update
  loop
    v_wrong := 0;
    v_correct := 0;
    v_forfeit := 0;  -- NEW

    for v_event in
      select * from public.events where round_id = p_round_id
    loop
      select * into v_pick
        from public.picks
        where event_id = v_event.id and user_id = v_participant.user_id;

      if not found then
        -- v0.2.0 change: forfeit, not wrong
        v_forfeit := v_forfeit + 1;
        insert into public.credit_ledger
          (season_id, user_id, event_id, round_number, delta, reason)
        values
          (v_season.id, v_participant.user_id, v_event.id, v_round.round_number,
           -v_season.credit_loss_per_wrong_pick, 'No pick forfeiture');

      elsif v_pick.choice <> v_event.resolved_outcome then
        v_wrong := v_wrong + 1;
        insert into public.credit_ledger
          (season_id, user_id, event_id, round_number, delta, reason)
        values
          (v_season.id, v_participant.user_id, v_event.id, v_round.round_number,
           -v_season.credit_loss_per_wrong_pick, 'Wrong pick');

      else
        v_correct := v_correct + 1;
      end if;
    end loop;

    -- Credit deduction unchanged: both wrong and forfeit cost the same
    v_new_credits := greatest(
      0,
      v_participant.credits_remaining
        - ((v_wrong + v_forfeit) * v_season.credit_loss_per_wrong_pick)
    );

    update public.season_participants set
      credits_remaining   = v_new_credits,
      wrong_picks_count   = wrong_picks_count + v_wrong,
      forfeit_picks_count = forfeit_picks_count + v_forfeit,  -- NEW
      correct_picks_count = correct_picks_count + v_correct,
      is_eliminated       = (v_new_credits = 0),
      eliminated_at       = case
                              when v_new_credits = 0 and eliminated_at is null
                                then now()
                              else eliminated_at
                            end
    where id = v_participant.id;
  end loop;

  update public.rounds set
    status               = 'resolved',
    finalized_at         = now(),
    finalized_by_user_id = v_caller
  where id = p_round_id;

  select count(*) into v_finalized_cnt
    from public.rounds
    where season_id = v_season.id and finalized_at is not null;

  if v_finalized_cnt >= v_season.rounds_total then
    update public.seasons
      set status = 'completed', end_date = now()
      where id = v_season.id;

    update public.leagues
      set status = 'completed'
      where id = v_season.league_id;
  end if;
end;
$$;

grant execute on function public.finalize_round(uuid) to authenticated;

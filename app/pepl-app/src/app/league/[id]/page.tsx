// =============================================================================
// League view — server component.
//
// Does ONE bulk fetch per logical entity (no N+1) and renders:
//   - League header with invite code
//   - Start Season button (admin, if not_started)
//   - Rounds list with events and pick UI
//   - Leaderboard
//   - Members list
//   - Recent credit ledger
//
// All mutations are wired to server actions in ./actions.ts.
// =============================================================================
import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import {
  startSeasonAction,
  createRoundAction,
  createEventAction,
  forceLockEventAction,
  submitPickAction,
  resolveEventAction,
  finalizeRoundAction,
} from './actions';
import type {
  League, Season, Round, PEvent, Pick, SeasonParticipant, Profile, CreditLedgerEntry,
} from '@/lib/types';

function inviteCodeOf(id: string) {
  return id.replace(/-/g, '').slice(0, 6).toUpperCase();
}

export default async function LeaguePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Single fetch of league (RLS will return null if not a member)
  const { data: league } = await supabase
    .from('leagues')
    .select('*')
    .eq('id', leagueId)
    .single<League>();

  if (!league) notFound();

  const isAdmin = league.admin_user_id === user.id;

  // Fetch the rest in parallel
  const [
    seasonsRes,
    membershipsRes,
  ] = await Promise.all([
    supabase.from('seasons').select('*').eq('league_id', leagueId).order('season_number'),
    supabase.from('league_memberships').select('*, profiles(*)').eq('league_id', leagueId),
  ]);

  const seasons = (seasonsRes.data ?? []) as Season[];
  const season = seasons[0] ?? null;
  const memberships = membershipsRes.data ?? [];

  // Fetch round/event/pick/participant/ledger only if a season exists
  let rounds: Round[] = [];
  let events: PEvent[] = [];
  let picks: Pick[] = [];
  let participants: SeasonParticipant[] = [];
  let ledger: CreditLedgerEntry[] = [];
  if (season) {
    const [rRes, pRes, lRes] = await Promise.all([
      supabase.from('rounds').select('*').eq('season_id', season.id).order('round_number'),
      supabase.from('season_participants').select('*').eq('season_id', season.id),
      supabase
        .from('credit_ledger')
        .select('*')
        .eq('season_id', season.id)
        .order('created_at', { ascending: false })
        .limit(10),
    ]);
    rounds = (rRes.data ?? []) as Round[];
    participants = (pRes.data ?? []) as SeasonParticipant[];
    ledger = (lRes.data ?? []) as CreditLedgerEntry[];

    if (rounds.length > 0) {
      const roundIds = rounds.map((r) => r.id);
      const { data: evts } = await supabase
        .from('events')
        .select('*')
        .in('round_id', roundIds)
        .order('created_at');
      events = (evts ?? []) as PEvent[];

      if (events.length > 0) {
        const eventIds = events.map((e) => e.id);
        const { data: pks } = await supabase
          .from('picks')
          .select('*')
          .in('event_id', eventIds);
        picks = (pks ?? []) as Pick[];
      }
    }
  }

  const profileById = new Map<string, Profile>(
    (memberships as any[]).map((m) => [m.user_id, m.profiles])
  );

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Link
          href="/dashboard"
          className="font-mono text-xs text-stone-500 hover:text-stone-900 inline-flex items-center gap-1"
        >
          ← dashboard
        </Link>

        {/* League header */}
        <div className="border border-stone-900 bg-white p-4 my-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-xl font-bold">{league.name}</h1>
                {isAdmin && (
                  <span className="px-2 py-0.5 bg-amber-100 border border-amber-300 font-mono text-[10px] uppercase">
                    you're admin
                  </span>
                )}
              </div>
              {league.description && <p className="text-sm text-stone-600">{league.description}</p>}
              <div className="font-mono text-[10px] text-stone-500 uppercase mt-1">
                source_of_truth: {league.source_of_truth}
              </div>
            </div>
            <div className="border border-stone-300 bg-stone-50 px-3 py-2">
              <div className="font-mono text-[10px] text-stone-500 uppercase">invite_code</div>
              <div className="font-mono text-base font-bold tracking-widest">
                {inviteCodeOf(league.id)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 pt-3 border-t border-stone-200 font-mono text-[10px]">
            <span className="px-1.5 py-0.5 border border-stone-300 bg-stone-50 uppercase">
              {season?.status ?? 'no_season'}
            </span>
            <span className="text-stone-500">season: {season?.season_number ?? '–'}</span>
            <span className="text-stone-500">
              rounds: {rounds.length} / {season?.rounds_total ?? '–'}
            </span>
            <span className="text-stone-500">members: {memberships.length}</span>
          </div>
        </div>

        {/* Start season banner */}
        {isAdmin && season?.status === 'not_started' && (
          <form action={startSeasonAction} className="border border-emerald-600 bg-emerald-50 p-4 mb-4 flex items-center justify-between">
            <div>
              <div className="font-bold text-sm">Season hasn't started yet</div>
              <div className="text-xs text-stone-600">Members will be locked in with their starting credits.</div>
            </div>
            <input type="hidden" name="season_id" value={season.id} />
            <input type="hidden" name="league_id" value={league.id} />
            <button type="submit" className="px-3 py-2 bg-emerald-600 text-white font-mono text-xs uppercase">
              Start Season
            </button>
          </form>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* LEFT: Rounds */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <div className="font-mono text-[10px] uppercase tracking-wider text-stone-500">
                /rounds
              </div>
              {isAdmin && season?.status === 'in_progress' && rounds.length < season.rounds_total && (
                <details className="font-mono text-xs">
                  <summary className="cursor-pointer px-2 py-1 bg-stone-900 text-white inline-block">
                    + new round
                  </summary>
                  <form action={createRoundAction} className="mt-2 border border-stone-900 bg-white p-3 w-72">
                    <input type="hidden" name="season_id" value={season.id} />
                    <input type="hidden" name="league_id" value={league.id} />
                    <input
                      name="title"
                      placeholder="round.title"
                      required
                      className="w-full border border-stone-300 px-2 py-1 mb-2"
                    />
                    <button type="submit" className="px-3 py-1 bg-stone-900 text-white uppercase">
                      Create
                    </button>
                  </form>
                </details>
              )}
            </div>

            {rounds.length === 0 && (
              <div className="border border-dashed border-stone-300 bg-white p-6 text-center font-mono text-[10px] uppercase text-stone-400">
                no_rounds_yet
              </div>
            )}

            {rounds.map((round) => {
              const roundEvents = events.filter((e) => e.round_id === round.id);
              const allResolved =
                roundEvents.length > 0 && roundEvents.every((e) => e.resolved_outcome);
              const isFinalized = !!round.finalized_at;

              return (
                <RoundBlock
                  key={round.id}
                  round={round}
                  events={roundEvents}
                  picks={picks}
                  participants={participants}
                  profileById={profileById}
                  league={league}
                  season={season!}
                  userId={user.id}
                  isAdmin={isAdmin}
                  isFinalized={isFinalized}
                  allResolved={allResolved}
                />
              );
            })}
          </div>

          {/* RIGHT: Leaderboard + Members + Ledger */}
          <div className="space-y-4">
            <Leaderboard participants={participants} profileById={profileById} season={season} />
            <MembersPanel memberships={memberships} adminId={league.admin_user_id} />
            <LedgerPanel ledger={ledger} profileById={profileById} />
          </div>
        </div>
      </main>
    </div>
  );
}

// ============================================================================
// ROUND BLOCK
// ============================================================================
function RoundBlock({
  round, events, picks, participants, profileById,
  league, season, userId, isAdmin, isFinalized, allResolved,
}: {
  round: Round;
  events: PEvent[];
  picks: Pick[];
  participants: SeasonParticipant[];
  profileById: Map<string, Profile>;
  league: League;
  season: Season;
  userId: string;
  isAdmin: boolean;
  isFinalized: boolean;
  allResolved: boolean;
}) {
  return (
    <div className={`border bg-white ${isFinalized ? 'border-stone-300 opacity-90' : 'border-stone-900'}`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-stone-200 bg-stone-50">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold">round_{round.round_number}</span>
          <span className="text-sm">{round.title}</span>
          <span
            className={`px-1.5 py-0.5 border font-mono text-[10px] uppercase ${
              isFinalized
                ? 'bg-stone-100 border-stone-300 text-stone-700'
                : 'bg-emerald-50 border-emerald-300 text-emerald-800'
            }`}
          >
            {isFinalized ? 'finalized' : round.status}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && !isFinalized && (
            <details>
              <summary className="cursor-pointer px-2 py-1 border border-stone-900 font-mono text-[10px] uppercase">
                + event
              </summary>
              <form action={createEventAction} className="absolute z-10 mt-2 border border-stone-900 bg-white p-3 w-80 right-4">
                <input type="hidden" name="round_id" value={round.id} />
                <input type="hidden" name="league_id" value={league.id} />
                <input name="title" placeholder="event.title" required className="w-full border px-2 py-1 mb-2 font-mono text-xs" />
                <input name="prompt" placeholder="event.prompt (Yes/No)" required className="w-full border px-2 py-1 mb-2 font-mono text-xs" />
                <input name="lock_minutes" type="number" defaultValue={60} min={1} className="w-full border px-2 py-1 mb-2 font-mono text-xs" />
                <button type="submit" className="px-3 py-1 bg-stone-900 text-white uppercase font-mono text-[10px]">
                  Create event
                </button>
              </form>
            </details>
          )}
          {isAdmin && !isFinalized && events.length > 0 && (
            <form action={finalizeRoundAction}>
              <input type="hidden" name="round_id" value={round.id} />
              <input type="hidden" name="league_id" value={league.id} />
              <button
                type="submit"
                disabled={!allResolved}
                className={`px-2 py-1 font-mono text-[10px] uppercase ${
                  allResolved
                    ? 'bg-emerald-600 text-white'
                    : 'bg-stone-200 text-stone-400 cursor-not-allowed'
                }`}
              >
                Finalize
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="divide-y divide-stone-100">
        {events.length === 0 && (
          <div className="px-3 py-4 font-mono text-[10px] uppercase text-stone-400">
            no events in this round
          </div>
        )}
        {events.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            round={round}
            picks={picks}
            participants={participants}
            profileById={profileById}
            league={league}
            season={season}
            userId={userId}
            isAdmin={isAdmin}
            isRoundFinalized={isFinalized}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// EVENT ROW
// ============================================================================
function EventRow({
  event, round, picks, participants, profileById, league, season, userId, isAdmin, isRoundFinalized,
}: {
  event: PEvent;
  round: Round;
  picks: Pick[];
  participants: SeasonParticipant[];
  profileById: Map<string, Profile>;
  league: League;
  season: Season;
  userId: string;
  isAdmin: boolean;
  isRoundFinalized: boolean;
}) {
  const locked = new Date(event.pick_lock_at) <= new Date();
  const resolved = !!event.resolved_outcome;
  const myPick = picks.find((p) => p.event_id === event.id && p.user_id === userId);
  const myParticipant = participants.find((p) => p.user_id === userId);
  const isEliminated = myParticipant?.is_eliminated;
  const canPick = !locked && !resolved && !isEliminated && season.status === 'in_progress';

  return (
    <div className="px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="font-bold text-sm">{event.title}</div>
          <div className="text-sm">
            <span className="text-stone-500">prompt:</span> {event.prompt}
          </div>
          <div className="font-mono text-[10px] text-stone-500 mt-1">
            lock: {new Date(event.pick_lock_at).toLocaleString()}
            {resolved && (
              <span className={` ml-3 ${event.resolved_outcome === 'yes' ? 'text-emerald-700' : 'text-rose-700'}`}>
                resolved: {event.resolved_outcome.toUpperCase()}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 min-w-[200px]">
          {!resolved && canPick && (
            <div className="flex gap-1">
              {(['yes', 'no'] as const).map((c) => (
                <form action={submitPickAction} key={c}>
                  <input type="hidden" name="event_id" value={event.id} />
                  <input type="hidden" name="league_id" value={league.id} />
                  <input type="hidden" name="choice" value={c} />
                  <button
                    type="submit"
                    className={`px-3 py-1.5 font-mono text-xs uppercase border ${
                      myPick?.choice === c
                        ? c === 'yes'
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-rose-600 text-white border-rose-600'
                        : 'border-stone-900 hover:bg-stone-900 hover:text-white'
                    }`}
                  >
                    {c}
                  </button>
                </form>
              ))}
            </div>
          )}

          {!resolved && !canPick && (
            <div className="font-mono text-[10px] text-stone-500">
              {isEliminated
                ? 'eliminated'
                : locked
                ? 'picks locked'
                : season.status !== 'in_progress'
                ? 'season not started'
                : ''}
            </div>
          )}

          {myPick && !resolved && (
            <div className="font-mono text-[10px] text-stone-500">
              your pick: <span className="font-bold text-stone-900">{myPick.choice.toUpperCase()}</span>
            </div>
          )}

          {resolved && myPick && (
            <div className="font-mono text-[10px]">
              you: <span className="font-bold">{myPick.choice.toUpperCase()}</span>{' '}
              {myPick.choice === event.resolved_outcome ? '✓' : '✗'}
            </div>
          )}

          {isAdmin && (
            <div className="flex items-center gap-1">
              {!locked && !resolved && (
                <form action={forceLockEventAction}>
                  <input type="hidden" name="event_id" value={event.id} />
                  <input type="hidden" name="league_id" value={league.id} />
                  <button
                    type="submit"
                    className="px-2 py-1 border border-stone-300 font-mono text-[10px] uppercase hover:border-stone-900"
                  >
                    Lock now
                  </button>
                </form>
              )}
              {!resolved && !isRoundFinalized && (
                <>
                  {(['yes', 'no'] as const).map((o) => (
                    <form action={resolveEventAction} key={o}>
                      <input type="hidden" name="event_id" value={event.id} />
                      <input type="hidden" name="league_id" value={league.id} />
                      <input type="hidden" name="outcome" value={o} />
                      <button
                        type="submit"
                        className={`px-2 py-1 border font-mono text-[10px] uppercase ${
                          o === 'yes'
                            ? 'border-emerald-600 text-emerald-700 hover:bg-emerald-600 hover:text-white'
                            : 'border-rose-600 text-rose-700 hover:bg-rose-600 hover:text-white'
                        }`}
                      >
                        Resolve: {o}
                      </button>
                    </form>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* All-picks reveal after resolution */}
      {resolved && (
        <div className="mt-2 pt-2 border-t border-stone-100">
          <div className="font-mono text-[10px] uppercase text-stone-500 mb-1">all_picks</div>
          <div className="flex flex-wrap gap-1">
            {participants.map((sp) => {
              const profile = profileById.get(sp.user_id);
              const pick = picks.find((p) => p.event_id === event.id && p.user_id === sp.user_id);
              const correct = pick && pick.choice === event.resolved_outcome;
              return (
                <span
                  key={sp.id}
                  className={`px-2 py-0.5 border font-mono text-[10px] ${
                    !pick
                      ? 'bg-stone-100 border-stone-300 text-stone-500'
                      : correct
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                      : 'bg-rose-50 border-rose-300 text-rose-800'
                  }`}
                >
                  {profile?.display_name ?? '?'}: {pick?.choice?.toUpperCase() ?? 'NO PICK'}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// LEADERBOARD
// ============================================================================
function Leaderboard({
  participants,
  profileById,
  season,
}: {
  participants: SeasonParticipant[];
  profileById: Map<string, Profile>;
  season: Season | null;
}) {
  const ranked = participants
    .map((sp) => {
      const profile = profileById.get(sp.user_id);
      const total = sp.correct_picks_count + sp.wrong_picks_count;
      const accuracy = total > 0 ? sp.correct_picks_count / total : 0;
      return { ...sp, profile, accuracy };
    })
    .sort((a, b) => {
      if (b.credits_remaining !== a.credits_remaining)
        return b.credits_remaining - a.credits_remaining;
      if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
      return (a.profile?.display_name ?? '').localeCompare(b.profile?.display_name ?? '');
    });

  const seasonComplete = season?.status === 'completed';

  return (
    <div className="border border-stone-900 bg-white">
      <div className="px-3 py-2 border-b border-stone-200 bg-stone-50 font-mono text-xs font-bold uppercase tracking-wider">
        Leaderboard
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="font-mono text-[10px] text-stone-500 uppercase">
            <th className="text-left py-1 pl-2">#</th>
            <th className="text-left">Player</th>
            <th className="text-right">Credits</th>
            <th className="text-right">✓</th>
            <th className="text-right">✗</th>
            <th className="text-right pr-2">Acc</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((r, i) => (
            <tr
              key={r.id}
              className={`border-t border-stone-100 ${r.is_eliminated ? 'opacity-50' : ''}`}
            >
              <td className="py-1.5 pl-2 font-mono text-stone-500">{i + 1}</td>
              <td className="py-1.5">
                {r.profile?.display_name}
                {r.is_eliminated && <span className="ml-1 text-[10px] text-rose-600">☠</span>}
              </td>
              <td className="text-right py-1.5 font-mono tabular-nums font-bold">
                {r.credits_remaining}
              </td>
              <td className="text-right py-1.5 font-mono tabular-nums text-emerald-700">
                {r.correct_picks_count}
              </td>
              <td className="text-right py-1.5 font-mono tabular-nums text-rose-700">
                {r.wrong_picks_count}
              </td>
              <td className="text-right py-1.5 pr-2 font-mono tabular-nums text-stone-600">
                {(r.accuracy * 100).toFixed(0)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {seasonComplete && ranked[0] && (
        <div className="border-t border-amber-300 bg-amber-50 px-3 py-2 font-mono text-[10px] uppercase">
          🏆 Winner: {ranked[0].profile?.display_name}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MEMBERS PANEL
// ============================================================================
function MembersPanel({
  memberships,
  adminId,
}: {
  memberships: any[];
  adminId: string;
}) {
  return (
    <div className="border border-stone-300 bg-white">
      <div className="px-3 py-2 border-b border-stone-200 bg-stone-50 font-mono text-xs font-bold uppercase tracking-wider">
        Members ({memberships.length})
      </div>
      <div className="divide-y divide-stone-100">
        {memberships.map((m) => (
          <div key={m.id} className="px-3 py-1.5 flex items-center justify-between text-xs">
            <span>{m.profiles?.display_name}</span>
            {m.user_id === adminId && (
              <span className="font-mono text-[10px] text-amber-700">admin</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// LEDGER PANEL
// ============================================================================
function LedgerPanel({
  ledger,
  profileById,
}: {
  ledger: CreditLedgerEntry[];
  profileById: Map<string, Profile>;
}) {
  return (
    <div className="border border-stone-300 bg-white">
      <div className="px-3 py-2 border-b border-stone-200 bg-stone-50 font-mono text-xs font-bold uppercase tracking-wider">
        Credit Ledger
      </div>
      <div className="divide-y divide-stone-100 max-h-64 overflow-auto">
        {ledger.length === 0 && (
          <div className="px-3 py-3 font-mono text-[10px] text-stone-400">no deductions yet</div>
        )}
        {ledger.map((l) => {
          const profile = profileById.get(l.user_id);
          return (
            <div
              key={l.id}
              className="px-3 py-1.5 font-mono text-[10px] flex items-center justify-between gap-2"
            >
              <span className="truncate">
                <span className="text-stone-700 font-medium">{profile?.display_name}</span>
                <span className="text-stone-400"> · r{l.round_number}</span>
                <span className="text-stone-500"> · {l.reason}</span>
              </span>
              <span className="text-rose-700 font-bold tabular-nums">{l.delta}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

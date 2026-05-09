// =============================================================================
// Dashboard — server component listing the user's leagues + create/join forms.
// =============================================================================
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createLeagueAction, joinLeagueAction, signOutAction } from './actions';
import type { League, LeagueMembership, Season } from '@/lib/types';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Fetch profile (auto-created by trigger on auth user creation)
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  // RLS scopes leagues to membership automatically
  const { data: memberships = [] } = await supabase
    .from('league_memberships')
    .select('*, leagues(*), seasons:leagues(seasons(*))')
    .eq('user_id', user.id);

  // Flatten + dedupe
  const leagues: { league: League; role: string; season: Season | null }[] =
    (memberships || []).map((m: any) => {
      const seasons: Season[] = m.leagues?.seasons || [];
      const season = seasons.find((s) => s.status !== 'completed') || seasons[0] || null;
      return { league: m.leagues, role: m.role, season };
    }).filter((x) => x.league);

  return (
    <div className="min-h-screen bg-stone-50">
      <Header displayName={profile?.display_name ?? user.email ?? '?'} />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-stone-500">
              /dashboard
            </div>
            <h1 className="text-2xl font-bold mt-1">Your leagues</h1>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <CreateLeagueForm />
          <JoinLeagueForm />
        </div>

        {leagues.length === 0 ? (
          <div className="border border-dashed border-stone-300 bg-white p-12 text-center">
            <div className="font-mono text-xs text-stone-500 uppercase tracking-wider mb-2">
              empty_state
            </div>
            <p className="text-stone-600">
              You aren't in any leagues yet. Create one or join with an invite code.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {leagues.map(({ league, role, season }) => (
              <Link
                key={league.id}
                href={`/league/${league.id}`}
                className="border border-stone-300 bg-white p-4 hover:border-stone-900"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-bold">{league.name}</div>
                  {role === 'admin' && (
                    <span className="px-2 py-0.5 bg-amber-100 border border-amber-300 font-mono text-[10px] uppercase">
                      admin
                    </span>
                  )}
                </div>
                <div className="font-mono text-[10px] text-stone-500 uppercase">
                  source_of_truth: {league.source_of_truth}
                </div>
                <div className="flex items-center gap-3 mt-3 font-mono text-[10px] text-stone-600">
                  <span className="px-1.5 py-0.5 border border-stone-300 bg-stone-50 uppercase">
                    {season?.status ?? 'no_season'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function Header({ displayName }: { displayName: string }) {
  return (
    <header className="border-b-2 border-stone-900 bg-white">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-stone-900 text-white flex items-center justify-center font-mono text-xs font-bold">
            P
          </div>
          <div>
            <div className="font-mono text-xs font-bold tracking-wider">PEPL</div>
            <div className="font-mono text-[10px] text-stone-500 -mt-0.5">
              private_event_prediction_league
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-stone-700">{displayName}</span>
          <form action={signOutAction}>
            <button
              type="submit"
              className="px-2 py-1 border border-stone-900 hover:bg-stone-900 hover:text-white font-mono text-xs uppercase"
            >
              sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

function CreateLeagueForm() {
  return (
    <form
      action={createLeagueAction}
      className="border border-stone-900 bg-white p-4"
    >
      <div className="font-mono text-[10px] uppercase tracking-wider text-stone-500 mb-3">
        /create_league
      </div>
      <div className="space-y-2">
        <Field name="name" label="league.name" placeholder="e.g. Sunday Football Crew" required />
        <Field
          name="source_of_truth"
          label="league.source_of_truth"
          placeholder="e.g. ESPN game results"
          required
        />
        <Field
          name="description"
          label="league.description (optional)"
          placeholder=""
        />
      </div>
      <button
        type="submit"
        className="mt-3 px-3 py-2 bg-stone-900 text-white font-mono text-xs uppercase"
      >
        Create
      </button>
    </form>
  );
}

function JoinLeagueForm() {
  return (
    <form action={joinLeagueAction} className="border border-stone-300 bg-white p-4">
      <div className="font-mono text-[10px] uppercase tracking-wider text-stone-500 mb-3">
        /join_league
      </div>
      <Field name="code" label="invite_code" placeholder="e.g. AB12CD" required />
      <button
        type="submit"
        className="mt-3 px-3 py-2 border border-stone-900 font-mono text-xs uppercase"
      >
        Join
      </button>
    </form>
  );
}

function Field({
  name,
  label,
  placeholder,
  required,
}: {
  name: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="font-mono text-[10px] uppercase tracking-wider text-stone-500 block mb-1">
        {label}
      </label>
      <input
        name={name}
        placeholder={placeholder}
        required={required}
        className="w-full border border-stone-300 px-2 py-1.5 font-mono text-xs outline-none focus:border-stone-900"
      />
    </div>
  );
}

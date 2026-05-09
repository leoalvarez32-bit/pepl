# PEPL — Release Notes v0.2.0

**Release date:** May 9, 2026
**Type:** Bug-fix release (no breaking changes)
**Previous:** [v0.1.0](./RELEASE_NOTES.md)

This release ships fixes for the three bugs found in the [v0.1.0 QA pass](./BUG_REPORT.md). All fixes are backward-compatible — no data migration needed for the prototype, and only an additive SQL migration for the production scaffold.

---

## What changed

### 🐛 Bug #1 — "Not a member" dead-end → one-click join (Major UX fix)

**Before:** Switching to a non-member user while inside a league view showed a dead-end screen with only a `← BACK` button. New members had to navigate back, switch personas, copy the invite code, switch back, paste the code — six clicks to do what should be one.

**After:** The "Not a member" screen now shows the league name and a single **`Join {league_name}`** button. Since the system already knows which league the user is trying to enter, no code-pasting is required. One click, member added, redirected into the league.

```
Before:                          After:
┌────────────────────┐          ┌────────────────────┐
│ ⚠ Not a member    │          │ ⚠ Not a member of │
│                    │          │   Sunday Crew      │
│ You don't belong   │          │                    │
│ to this league.    │          │ Bri isn't part of  │
│                    │          │ this league yet.   │
│   [ ← back ]       │          │                    │
└────────────────────┘          │ [Join Sunday Crew] │
                                │ ← back to dashboard│
                                └────────────────────┘
```

### 🐛 Bug #2 — Admin/player conflict-of-interest confirmation (Major integrity fix)

**Before:** When an admin clicked `Resolve: Yes` or `Resolve: No`, the action fired immediately. The same person could pick an outcome AND set the "correct" answer, with no UI surface preventing or even acknowledging the conflict.

**After:** Resolve buttons now open a confirmation panel that surfaces:

- The admin's own pick on this event (if any), with an explicit *"matches outcome"* / *"differs from outcome"* indicator
- The league's `source_of_truth` string
- A reminder that they're acting as both player and judge
- An explicit `Confirm: resolve yes/no` button vs. `cancel`

This is a **soft accountability nudge**, not a hard lock. The admin can still resolve however they want, but they have to consciously confirm against the source of truth, with their own pick visible. This prevents unconscious self-favoring resolution and creates a transparent record.

### 🐛 Bug #3 — Accuracy excludes forfeitures (Metric correctness fix)

**Before:** The leaderboard's accuracy column was computed as `correct / (correct + wrong)` where `wrong` lumped together actual wrong picks and missed picks. A player who skipped 5 events and got 1 wrong of 1 attempt showed the same 0% accuracy as a player who picked 6 wrong out of 6 attempts.

**After:** Accuracy is now computed as `correct / (correct + wrong)` excluding forfeits. A new `💀` column shows the forfeit count separately. Both metrics now have clear meaning:

- **Accuracy** = how well you pick when you pick
- **Forfeits** = how often you didn't show up
- **Credits** (unchanged) = the actual scoreboard, penalizes both equally

Forfeits still cost the same `−5 credits` per missed pick. They're just no longer double-counted in the accuracy denominator.

| Player example | Before v0.2.0 | After v0.2.0 |
|---|---|---|
| 1 correct out of 3 attempts + 5 forfeits | 13% accuracy | 33% accuracy + 5 forfeits |

---

## Deployment instructions

### For the prototype (`index.html` on GitHub Pages)

The fastest possible upgrade path:

1. Download `index.html` from this release (the v0.2.0 standalone HTML)
2. In your repo at `https://github.com/leoalvarez32-bit/pepl`, click your existing `index.html` → pencil icon (Edit)
3. Delete all the existing content, paste the v0.2.0 content
4. Commit message: `Upgrade prototype to v0.2.0 (bug fixes)`
5. Commit directly to main
6. Wait 60 seconds, refresh `https://leoalvarez32-bit.github.io/pepl/`
7. Footer should show `pepl.proto / v0.2.0 / ...`

**localStorage compatibility:** existing v0.1.0 state in users' browsers will continue to work. The new `forfeit_picks_count` field defaults to 0 for participants that don't have it. Old credit ledger entries are preserved as-is.

### For the production scaffold

If you've deployed the Next.js + Supabase scaffold:

#### 1. Apply the SQL migration

In Supabase Dashboard → SQL Editor, run [`0005_v020_fixes.sql`](./0005_v020_fixes.sql). This:

- Adds `forfeit_picks_count` column to `season_participants` (defaults to 0)
- Replaces `finalize_round()` with the v0.2.0 version that tracks forfeits separately

The migration is idempotent and additive — existing data is preserved.

#### 2. Update TypeScript types

In `src/lib/types.ts`, add to the `SeasonParticipant` interface:

```typescript
export interface SeasonParticipant {
  id: string;
  season_id: string;
  user_id: string;
  credits_remaining: number;
  wrong_picks_count: number;
  forfeit_picks_count: number;  // NEW in v0.2.0
  correct_picks_count: number;
  is_eliminated: boolean;
  eliminated_at: string | null;
  created_at: string;
}
```

#### 3. Patch `src/app/league/[id]/page.tsx`

Three changes — all small.

**Change A — Bug #1 inline join.** The `NotAMemberPanel` needs to be a client component because it has interactive state. Create `src/app/league/[id]/_components/NotAMemberPanel.tsx`:

```typescript
'use client';
import { joinLeagueAction } from '../../dashboard/actions';

function inviteCodeOf(id: string) {
  return id.replace(/-/g, '').slice(0, 6).toUpperCase();
}

export function NotAMemberPanel({
  leagueId,
  leagueName,
  currentUserName,
}: {
  leagueId: string;
  leagueName: string;
  currentUserName: string;
}) {
  return (
    <div className="border border-rose-300 bg-rose-50 p-6 max-w-md mx-auto text-center">
      <div className="font-bold mb-1">Not a member of {leagueName}</div>
      <p className="text-sm text-stone-600 mb-4">
        {currentUserName} isn't part of this league yet. Join now to start making predictions.
      </p>
      <form action={joinLeagueAction}>
        <input type="hidden" name="code" value={inviteCodeOf(leagueId)} />
        <button
          type="submit"
          className="w-full px-3 py-2 bg-stone-900 text-white font-mono text-xs uppercase tracking-wider mb-2"
        >
          Join {leagueName}
        </button>
      </form>
      <a
        href="/dashboard"
        className="block w-full px-3 py-1 font-mono text-[10px] text-stone-500 hover:text-stone-900"
      >
        ← back to dashboard
      </a>
    </div>
  );
}
```

Then in `page.tsx`, replace the inline "not a member" block with:

```typescript
import { NotAMemberPanel } from './_components/NotAMemberPanel';
// ...
if (!myMembership) {
  return (
    <NotAMemberPanel
      leagueId={league.id}
      leagueName={league.name}
      currentUserName={profile?.display_name ?? user.email ?? 'You'}
    />
  );
}
```

**Change B — Bug #2 resolve confirmation.** Create `src/app/league/[id]/_components/ResolveConfirmPanel.tsx`:

```typescript
'use client';
import { useState } from 'react';
import { resolveEventAction } from '../actions';

export function ResolveButtons({
  eventId,
  eventTitle,
  leagueId,
  sourceOfTruth,
  myPick,
  isAdmin,
  isResolved,
  isRoundFinalized,
}: {
  eventId: string;
  eventTitle: string;
  leagueId: string;
  sourceOfTruth: string;
  myPick: 'yes' | 'no' | null;
  isAdmin: boolean;
  isResolved: boolean;
  isRoundFinalized: boolean;
}) {
  const [confirm, setConfirm] = useState<'yes' | 'no' | null>(null);

  if (!isAdmin || isResolved || isRoundFinalized) return null;

  if (confirm) {
    const matches = myPick === confirm;
    return (
      <div className="border border-amber-300 bg-amber-50 p-3 mt-2">
        <div className="font-bold text-sm mb-2">
          ⚠ Resolve "{eventTitle}" as {confirm.toUpperCase()}?
        </div>
        <div className="font-mono text-[10px] text-stone-700 space-y-1 mb-3">
          <div>
            your_pick:{' '}
            <span className="font-bold">{myPick ? myPick.toUpperCase() : 'NO PICK'}</span>
            {myPick && (
              <span className={`ml-1 ${matches ? 'text-emerald-700' : 'text-rose-700'}`}>
                ({matches ? 'matches outcome' : 'differs from outcome'})
              </span>
            )}
          </div>
          <div>source_of_truth: <span className="text-stone-900">{sourceOfTruth}</span></div>
          <div className="text-stone-500 italic mt-2">
            You're acting as both player and judge. The outcome you set should match the
            source of truth, not your pick.
          </div>
        </div>
        <div className="flex gap-2">
          <form action={resolveEventAction}>
            <input type="hidden" name="event_id" value={eventId} />
            <input type="hidden" name="league_id" value={leagueId} />
            <input type="hidden" name="outcome" value={confirm} />
            <button
              type="submit"
              className={`px-3 py-1 font-mono text-[10px] uppercase ${
                confirm === 'yes' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
              }`}
            >
              Confirm: resolve {confirm}
            </button>
          </form>
          <button
            onClick={() => setConfirm(null)}
            className="px-3 py-1 font-mono text-[10px] text-stone-600"
          >
            cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-1">
      <button
        onClick={() => setConfirm('yes')}
        className="px-2 py-1 border border-emerald-600 text-emerald-700 hover:bg-emerald-600 hover:text-white font-mono text-[10px] uppercase"
      >
        Resolve: Yes
      </button>
      <button
        onClick={() => setConfirm('no')}
        className="px-2 py-1 border border-rose-600 text-rose-700 hover:bg-rose-600 hover:text-white font-mono text-[10px] uppercase"
      >
        Resolve: No
      </button>
    </div>
  );
}
```

Then in `page.tsx`'s `EventRow`, replace the inline resolve buttons with:

```typescript
import { ResolveButtons } from './_components/ResolveConfirmPanel';
// ... inside EventRow's admin section:
<ResolveButtons
  eventId={event.id}
  eventTitle={event.title}
  leagueId={league.id}
  sourceOfTruth={league.source_of_truth}
  myPick={myPick?.choice ?? null}
  isAdmin={isAdmin}
  isResolved={resolved}
  isRoundFinalized={isRoundFinalized}
/>
```

**Change C — Bug #3 leaderboard.** In the `Leaderboard` function inside `page.tsx`, change the accuracy calculation:

```typescript
// BEFORE
const total = sp.correct_picks_count + sp.wrong_picks_count;
const accuracy = total > 0 ? sp.correct_picks_count / total : 0;

// AFTER (forfeits no longer in denominator)
const attempted = sp.correct_picks_count + sp.wrong_picks_count;
const accuracy = attempted > 0 ? sp.correct_picks_count / attempted : 0;
const forfeits = sp.forfeit_picks_count ?? 0;
```

And add a new column to the leaderboard table (header + cell, between `wrong` and `accuracy`):

```typescript
<th className="text-right" title="Forfeits (no pick)">💀</th>
// ...
<td className="text-right py-1.5 font-mono tabular-nums text-stone-500">{r.forfeits}</td>
```

#### 4. Redeploy

```bash
git add .
git commit -m "v0.2.0: bug fixes from initial QA pass"
git push
```

Vercel will auto-redeploy on push.

---

## Verification checklist

After deploying v0.2.0, verify the fixes work:

### Bug #1 ✓
1. As admin, create a league
2. Add second user via `+ ADD USER`
3. Switch dropdown to second user (while still in league view)
4. **Expected:** "Not a member of `<league name>`" with `Join <league name>` button
5. Click the Join button → second user is now a member, sees the league fully

### Bug #2 ✓
1. As admin in an active season, create a round + event
2. Submit a pick on the event (e.g., YES)
3. Lock the event (`Lock now`)
4. Click `Resolve: No`
5. **Expected:** confirmation panel appears showing:
   - your_pick: YES (differs from outcome)
   - source_of_truth: ESPN (or whatever you set)
   - "You're acting as both player and judge..." reminder
   - Confirm and cancel buttons
6. Click `Confirm: resolve no` → event resolves as expected

### Bug #3 ✓
1. Run a multi-round season where one player skips events
2. After finalizing rounds, check the leaderboard
3. **Expected:**
   - New `💀` column shows forfeit count for each player
   - Accuracy reflects only attempted events (correct / (correct + wrong))
   - A player who skipped 5 of 6 events but got their 1 attempt right shows 100% accuracy + 5 forfeits

---

## Known issues still open

These were noted in the v0.1.0 bug report but deferred:

- **Round-level lock time** is in the schema but not enforced (only per-event locks work). Adding a trigger or `picks_validate` check would close this.
- **Profile SELECT policy** is permissive (any authenticated user can read any display_name). For tighter privacy, add a co-member check helper.
- **Picks visible to all members at all times** — currently controlled by UI logic, not RLS. Genuine pick secrecy until lock would require time-based RLS predicates.

These are not blocking for the prototype's intended use case (small invite-only groups with high social trust) but should be revisited before any public-facing release.

---

## File manifest for this release

| File | What it is |
|---|---|
| `index.html` | Updated standalone prototype (~67 KB, unchanged structure, fixes applied) |
| `PEPL.jsx` | Updated React source for the prototype |
| `0005_v020_fixes.sql` | Production scaffold migration (forfeit column + finalize_round update) |
| `RELEASE_NOTES_v0.2.0.md` | This file |

---

*PEPL v0.2.0 · Bug fixes from initial QA · Built May 2026*

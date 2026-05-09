# PEPL — Private Event Prediction League

A private, invite-only prediction platform. Small groups make Yes/No predictions on admin-defined events; the system tracks predictions, deducts credits for wrong/missed picks, and crowns a winner.

This is the **production scaffold** (Phase 2). It implements PRD §1–§20 MVP scope using Next.js 14 + Supabase + Postgres with row-level security.

For the **interactive prototype** with simulated multi-user (Phase 1), see `PEPL.jsx`.

---

## Stack

- **Next.js 14** (App Router, Server Actions, Server Components)
- **TypeScript** (strict)
- **Supabase** — Postgres + Auth + RLS
- **Tailwind CSS** — utilitarian styling
- **Vercel** for deployment

## What's in here

```
pepl-app/
├── README.md                          ← you are here
├── package.json
├── next.config.mjs
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── .env.example
├── supabase/
│   └── migrations/
│       ├── 0001_schema.sql            ← 9 tables + validation triggers
│       ├── 0002_rls.sql               ← row-level security policies (PRD §11)
│       ├── 0003_finalize_round.sql    ← atomic transactional scoring (PRD §7.9 + §12.1)
│       └── 0004_app_functions.sql     ← create_league / join_league / etc.
└── src/
    ├── middleware.ts                  ← session refresh + auth gating
    ├── lib/
    │   ├── types.ts                   ← TypeScript types matching schema
    │   └── supabase/
    │       ├── client.ts              ← browser client
    │       ├── server.ts              ← server-component client
    │       └── middleware.ts          ← session helper
    └── app/
        ├── layout.tsx
        ├── page.tsx                   ← redirects via middleware
        ├── globals.css
        ├── login/page.tsx             ← BOTH magic-link and email/password
        ├── auth/callback/route.ts     ← code exchange handler
        ├── dashboard/
        │   ├── page.tsx               ← user's leagues
        │   └── actions.ts             ← createLeague, joinLeague, signOut
        └── league/[id]/
            ├── page.tsx               ← league view, leaderboard, rounds
            └── actions.ts             ← startSeason, createRound, createEvent,
                                         submitPick, resolveEvent, finalizeRound
```

---

## Setup

### 1. Create a Supabase project

Go to <https://supabase.com/dashboard> → new project. Pick a region close to your users.

### 2. Run the migrations

In the Supabase dashboard → SQL Editor, run each migration **in order**:

```
0001_schema.sql           -- creates tables, indexes, validation triggers
0002_rls.sql              -- enables RLS and creates all policies
0003_finalize_round.sql   -- the atomic scoring function + resolve_event
0004_app_functions.sql    -- create_league, join_league_by_code, etc.
```

Or, if you have the Supabase CLI linked locally:

```bash
supabase db push
```

### 3. Configure auth

Supabase Dashboard → Authentication → Providers:

- **Email**: enable both "Email/Password" AND "Magic Link"
- **Site URL**: `http://localhost:3000` for dev (change to your Vercel URL for prod)
- **Redirect URLs**: add `http://localhost:3000/auth/callback`

### 4. Set environment variables

```bash
cp .env.example .env.local
```

Fill in:
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase Dashboard → Settings → API
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — same page

### 5. Install + run

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. You'll be redirected to `/login`.

### 6. Deploy

```bash
vercel --prod
```

Add the same env vars in the Vercel dashboard. Update Supabase Auth's **Site URL** and **Redirect URLs** to your production domain.

---

## Architecture decisions

### Why the SECURITY DEFINER functions?

Several actions touch multiple tables (creating a league = league + season + membership + participant). Doing these as separate inserts from the app means partial-failure recovery and RLS gymnastics. Instead:

- `create_league()` — atomic 4-table insert
- `join_league_by_code()` — atomic 2-table insert
- `start_season()` — admin-checked 2-table update
- `finalize_round()` — the big one (PRD §7.9): scores all participants, inserts ledger rows, updates rounds/seasons/leagues, all in one transaction
- `resolve_event()` — small wrapper for clean audit trail
- `lock_event_now()` — demo helper for forcing locks

Each is `SECURITY DEFINER` and grants `EXECUTE` only to `authenticated`. The functions internally re-check that `auth.uid()` matches the required permission (e.g., league admin).

### Why RLS at all?

PRD §15.3: "Use row-level security or server-side validation. Do not rely only on UI hiding." RLS is defence-in-depth. Even if a server action bug leaks an action call, the database refuses unauthorized writes/reads.

### Why the events trigger?

PRD §7.6: "Event cannot be edited once at least one pick exists." Encoded as a `BEFORE UPDATE` trigger on `events` that compares OLD vs NEW and rejects content changes if any pick references it. Resolution updates pass through (different fields).

### Tie-breaker

PRD §5.8 specifies credits → accuracy. Beyond that (rare), I added alphabetical by display_name as a deterministic fallback. Documented in `Leaderboard` component.

---

## Test flow (mirrors PRD §18 Exit Criteria)

After setup, verify the system end-to-end:

1. ☐ Sign up at `/login` (Sign Up tab) with a display name
2. ☐ Create a league with name + source of truth → redirects to `/league/{id}`
3. ☐ Open in incognito, sign up as a second user
4. ☐ Second user joins via the 6-char invite code from user 1's league view
5. ☐ Back as admin: click `Start Season` → status becomes `in_progress`
6. ☐ Click `+ new round` → enter title
7. ☐ Inside the round, click `+ event` → add 2-3 events with short lock times
8. ☐ Switch to member 2, submit picks
9. ☐ Back as admin: `Lock now` (or wait for natural lock), then `Resolve: Yes/No` for each
10. ☐ Click `Finalize` → leaderboard updates, ledger gets entries
11. ☐ Verify wrong/missed picks deducted -5 credits each
12. ☐ Verify a member at 0 credits shows as eliminated
13. ☐ Try to `Finalize` again on the same round → rejected
14. ☐ Repeat rounds 2–6 → season auto-completes after round 6, winner shown

---

## What's NOT in this scaffold (intentional, per PRD §4.2)

- Notifications (email/push)
- Mobile app
- Public leagues / event marketplace
- Payments / wallets / odds
- Multi-admin governance / dispute voting
- Custom scoring rules
- Carry-over credits between seasons
- Automated event feeds (NFL API, Oscars API)
- Multi-season support — the schema supports it, the UI assumes 1 season per league

## What you'll want to add next (post-MVP)

In rough priority order:

1. **Email notifications** — "a round was finalized," "events you haven't picked yet," "you've been eliminated." Supabase Edge Functions + Resend works well.
2. **Multi-season support in UI** — admin "Start new season" button after one completes.
3. **Mobile-friendly responsive layout** — current scaffold is desktop-first.
4. **Real-time leaderboard** — Supabase Realtime channel on `season_participants` updates.
5. **Audit log UI** — surface the `credit_ledger` per-user, not just last-10.
6. **Admin: edit event before any picks** — PRD §7.6 allows this; UI doesn't expose it yet.
7. **Auto-generated invite codes table** — for branded/shorter codes (current 6-hex-char approach is collision-resistant for small scale only).
8. **Automated event feeds** — NFL/Oscars APIs to pre-fill round events.
9. **Confidence scoring / dynamic odds** — the next-tier feature for retention.

---

## Test the SQL functions directly

Smoke-test the most critical function in the Supabase SQL editor:

```sql
-- As the admin user (after signing in to your app)
select public.create_league('Test League', 'ESPN', 'just a test');
-- returns: <league_uuid>

-- Check that all 4 rows were created
select * from public.leagues where name = 'Test League';
select * from public.seasons where league_id = '<league_uuid>';
select * from public.league_memberships where league_id = '<league_uuid>';
select * from public.season_participants where season_id = '<season_uuid>';

-- Try finalizing an empty round (should fail)
select public.finalize_round('<some_round_uuid>');
-- ERROR: Cannot finalize a round with no events

-- Try finalizing as non-admin (should fail)
-- (switch to a different authenticated session first)
select public.finalize_round('<some_round_uuid>');
-- ERROR: Only the league admin can finalize rounds
```

---

## Known gaps in this scaffold

A few things I called out in the prototype that carry over here:

- **Round-level lock time** is in the schema (`rounds.round_lock_at`) but not enforced. Per-event lock is enforced via trigger. If you want round-level "everything locks at this time," add another trigger or a CHECK in `picks_validate`.
- **`profiles` SELECT policy is permissive** — any authenticated user can read any display_name. Tightening this would require an `is_co_member()` check, which is more complex. Acceptable for the small-group use case.
- **Picks are visible to all league members at all times** — UI can hide unresolved picks if you want pick-secrecy until lock. The prototype does this; this scaffold leaves picks visible (simpler).

---

## License

MIT — do whatever you want with it. Send a thumbs-up if it ships.

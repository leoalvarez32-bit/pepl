# PEPL — Release Notes v0.1.0 (MVP)

**Release date:** April 29, 2026
**Codename:** `pepl-mvp / phase-1`
**Status:** Initial release · prototype + production scaffold

---

## TL;DR

PEPL is now usable end-to-end. You can create a private prediction league, invite friends, run a six-round season of Yes/No predictions, and have the system score everyone automatically. The MVP ships with two builds: a **clickable prototype** you can demo immediately, and a **production scaffold** ready to deploy to Supabase + Vercel when you're ready for real users.

This document walks you through every flow in the app, from sign-up to season completion.

---

## What shipped in this release

**Core flows**
- Account creation (email/password and magic link)
- League creation, invite codes, and joining
- Six-round seasons with admin-defined Yes/No events
- Pick submission with lock-time enforcement
- Admin event resolution
- Atomic round finalization with auto-scoring
- Leaderboard, credit ledger, elimination, and winner announcement

**Two builds**
| Build | What it is | When to use it |
|---|---|---|
| **Prototype** (`PEPL.jsx`) | Single-file React app, persistent local storage, simulated multi-user via a header dropdown. | Demos, design feedback, internal QA, walking a stakeholder through the flows in 3 minutes. |
| **Scaffold** (`pepl-app/`) | Next.js 14 + Supabase production codebase. Real auth, real database, RLS-protected. | Standing up a real instance for actual users. |

The user-facing flows are identical between the two. Everything below works in either.

---

## Getting started — the 3-minute demo

If you've just opened the prototype for the first time, here's the fastest path to seeing it work:

1. **Create your first user.** You'll see a "Create your first user" panel. Enter a name like *Alex* and continue. This becomes your active user.
2. **Click `Create League`.** Give it a name (*Sunday Football Crew*) and a source-of-truth string (*ESPN game results*). The source of truth is just a note — it's used to settle disputes if a result is contested.
3. **Add a second user.** Click `+ ADD USER` in the header and create *Bri*. The dropdown next to it lets you switch between them at any time.
4. **Switch to Bri.** Use the dropdown. Click `Join League`, paste the 6-character invite code from Alex's league view, and Bri is now in.
5. **Switch back to Alex.** As admin, click `Start Season`, then `+ New Round`. Title it *NFL Week 1*. Add 2–3 events with short prompts like *Will the Chiefs win?*.
6. **Switch to Bri** and submit picks on each event.
7. **Switch back to Alex.** For each event: click `Lock Now` to close picking, then `Resolve: Yes` or `Resolve: No`. Once all events are resolved, click `Finalize`.
8. **Watch the leaderboard update.** Wrong picks deduct 5 credits each. The credit ledger on the right shows every deduction.

That's the full loop. Everything else is variations on this.

---

## Full walkthrough

### As an admin

You're an admin if you created the league or were assigned admin status. The admin badge shows next to your name everywhere it matters.

**1. Create a league.** From the dashboard, click `Create League` and fill three fields:
- **Name** — what your group calls it. Visible to all members.
- **Source of truth** — the authoritative reference your group will use to settle outcomes (e.g., *ESPN game results*, *official AMPAS announcement*, *Wikipedia*). This isn't enforced by the system; it's social glue. Pick something specific.
- **Description** *(optional)* — a one-liner about what the league is for.

Once you click Create, the league exists in `draft` status with one season (Season 1) attached.

**2. Share the invite code.** Open your league page. The 6-character invite code is shown in the header — click it to copy. Send it to your group however you normally share things.

**3. Wait for members to join.** You can start the season any time, but members who join after the season starts will get fresh starting credits and join mid-game. Best practice: let everyone join *before* you start.

**4. Start the season.** Click `Start Season`. This locks in all current participants and shifts the season status to `in_progress`. From this point, members can submit picks (once you create rounds and events).

**5. Create a round.** Click `+ New Round`. Give it a descriptive title (*NFL Week 1*, *Oscars Main Awards*, *Q4 Earnings Day*). The round starts in `open` status.

**6. Add events to the round.** Inside the round card, click `+ Event`. Each event needs:
- **Title** — the matchup or question (*Chiefs vs Bills*).
- **Prompt** — the actual yes/no question (*Will the Chiefs win?*). Phrase it so Yes/No is unambiguous. Avoid *"Who will win?"* — there's no Yes/No answer to that.
- **Lock time** — minutes from now until picks close. The default is 60. Use a longer window for events further out.

**7. Wait for picks, then resolve events.** When the real-world event happens and you can see the outcome, click `Resolve: Yes` or `Resolve: No` on each event. Locked events that are resolved show their outcome to everyone.

> **Tip:** the `Lock Now` button is a demo shortcut that closes picks immediately, regardless of the lock time you set. Useful when you want to walk through a flow without waiting.

**8. Finalize the round.** Once *every* event in the round is resolved, the `Finalize` button becomes active. Clicking it runs the scoring engine: every wrong pick costs 5 credits, every missed pick costs 5 credits, and credits are clamped at zero. The credit ledger gets a row for every deduction so the math is auditable. After finalization, the round is locked — no editing, no re-finalizing.

**9. Repeat for rounds 2–6.** Same flow each time. After the sixth round is finalized, the season auto-completes and the leaderboard crowns a winner (highest credits, ties broken by accuracy).

### As a member

If you joined a league with an invite code, you're a member. Your job is to make picks before the lock time and watch the leaderboard.

**1. Join a league.** From the dashboard, click `Join League`, paste the 6-character invite code, and confirm. You're now a participant in the active season with full starting credits.

**2. Wait for events.** When the admin creates events, they appear in the round on the league page. Each event shows the prompt, the lock time, and Yes/No buttons.

**3. Submit your pick.** Click Yes or No. You can change your pick freely until the event locks — the system stores only your most recent answer. Once locked, your pick is final.

> **Heads up:** if you don't pick at all by the lock time, you forfeit. A no-pick counts the same as a wrong pick — minus 5 credits at finalization.

**4. Watch the leaderboard.** After the admin finalizes a round, your standing updates. The right-hand panel shows everyone's credits, correct/wrong counts, and accuracy. Eliminated players (zero credits) appear dimmed.

**5. Survive.** Last player standing — or highest credits at the end of round 6 — wins.

---

## Game rules cheat sheet

These are fixed for MVP and apply to every league.

| Rule | Value |
|---|---|
| Starting credits per player | **100** |
| Cost of a wrong pick | **−5 credits** |
| Cost of a missed pick (no submission) | **−5 credits** |
| Cost of a correct pick | **0** (no reward, no penalty) |
| Rounds per season | **6** |
| Elimination threshold | **0 credits** |
| Tie-breaker on the leaderboard | Credits → accuracy → display name (alphabetical) |
| Maximum credit deduction per event | 5 (you can't lose more than 5 on a single event) |
| Can a wrong pick be undone? | No. Finalization is one-way. |
| Can an event be edited after a member picks? | No. Title, prompt, and lock time are frozen once any pick exists. |

---

## Roles and what each can do

|  | Admin | Member |
|---|:-:|:-:|
| Create a league | ✓ | — |
| View league + leaderboard | ✓ | ✓ |
| Submit Yes/No picks | ✓ | ✓ |
| Create rounds | ✓ | — |
| Create events | ✓ | — |
| Force-lock an event before its lock time | ✓ | — |
| Resolve event outcomes | ✓ | — |
| Finalize rounds (apply scoring) | ✓ | — |
| Start a new season | ✓ | — |

The league creator is automatically the admin. There's no way to transfer admin status in this MVP — pick wisely.

---

## Known limitations

These are intentional MVP scope cuts. Each one is on the post-MVP roadmap.

**Not in this release:**
- **No notifications.** The app won't email or push you when a round finalizes or when picks are about to lock. You need to check in manually.
- **No mobile app.** The web app works on phones but is desktop-first. A mobile-optimized layout is on the roadmap.
- **No automated event feeds.** Admins enter every event manually. There's no NFL/Oscars/etc. integration yet.
- **No public leagues.** Every league is invite-only by design. No directory, no discovery, no joining strangers.
- **No payments, odds, or wagering.** This is a credits-based game. There's no money flow or betting interface.
- **No multi-admin governance.** One admin per league. No co-admins, no admin transfer, no dispute voting.
- **No custom scoring rules.** The 100-credits / −5-per-wrong / 6-rounds setup is fixed.
- **No carry-over between seasons.** Each season starts fresh.
- **One season per league in the UI.** The data model supports more, but the UI assumes one.
- **Picks are visible to all members at all times.** If you want pick secrecy until the lock, that's a UI change for v0.2.

**Other things to know:**
- The 6-character invite code is derived from the league's internal ID. It's collision-resistant for groups under a few thousand leagues but not branded or memorable. Custom codes are a v0.2 candidate.
- The "round-level lock time" field exists in the data model but isn't enforced in v0.1. Picks lock per-event only.
- If you delete a user account, all their picks and ledger entries cascade-delete with them. There's no soft-delete or anonymization yet.

---

## Tips and shortcuts

**For demoing the prototype**
- The `Lock Now` button on any event closes picks immediately — useful for walking a stakeholder through a full round in two minutes instead of waiting on lock times.
- The header `RESET` button wipes all leagues, users, and history. Hold this for fresh demos.
- State persists across browser refreshes. Closing and reopening the artifact is safe.

**For running a real league**
- Set lock times generously. People miss picks. A 24-hour window is friendlier than a 1-hour one.
- Phrase event prompts as questions ending in a question mark. *"Will the Chiefs win?"* — not *"Chiefs win"*. The yes/no answer should be unambiguous from the prompt alone.
- Pin the source-of-truth string somewhere visible (group chat, league description). When two members disagree on a result, you'll thank yourself.
- Resolve events promptly after they happen. Members can't pick on later events while you have unresolved ones piling up — well, they can, but stale rounds are no fun.
- Don't finalize a round until you're sure of every outcome. Finalization is irreversible. If a sportsbook reverses a call, you can't fix the round.

**For league members**
- Submit picks early, even if you change your mind later. The system stores only your latest answer up to lock time. Picking early protects you from forgetting.
- Check the leaderboard after every finalization. Watching your credits dwindle is half the fun.

---

## What's coming next

In rough priority order, here's the post-MVP roadmap:

1. **Email notifications** — round finalized, you have unpicked events, you've been eliminated.
2. **Mobile-responsive layout** — the league view's right rail collapses to a tab on small screens.
3. **Multi-season UI** — admin can start Season 2 after Season 1 completes.
4. **Real-time leaderboard** — credits update live without refresh.
5. **Pick secrecy until lock** *(opt-in per league)* — picks hidden from co-members until the event locks.
6. **Custom invite codes** — admin can pick a 6–10 character code instead of the auto-generated one.
7. **Admin: edit event before any picks** — currently must delete and recreate.
8. **Audit log per user** — full credit history, not just the last 10 entries.
9. **Automated event feeds** — NFL, Oscars, Premier League, etc. Pre-fill round events from real schedules.
10. **Multi-admin / dispute voting** — for groups that don't want one person calling all the shots.

If something on this list matters more to you than its current ranking, that's useful feedback — let us know.

---

## Feedback

This is v0.1. The whole point of the MVP is to find out what's wrong with it.

- **Bugs:** if something breaks, note what you clicked, what you expected, and what happened.
- **Confusing UX:** if a screen or label made you pause, tell us. Pauses compound across users.
- **Missing features that block you:** if there's a thing you absolutely need to run your league and it's not in the "What's coming next" list, that's the most valuable thing you can tell us.

Send feedback to whoever pointed you at this build. We read everything.

---

*PEPL v0.1.0 · MVP Phase 1 · Built April 2026*

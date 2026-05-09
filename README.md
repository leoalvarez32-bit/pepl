# PEPL — Private Event Prediction League

A private, invite-only prediction platform. Small groups make Yes/No predictions on admin-defined events; the system tracks predictions, deducts credits for wrong/missed picks, and crowns a winner.

## 🎮 Try the prototype

**Live demo:** https://leoalvarez32-bit.github.io/pepl/

State persists in your browser via `localStorage`. Use the `RESET` button in the header to wipe and start over.

## 📁 What's in this repo

| Path | What it is |
|---|---|
| `index.html` | The standalone prototype (single file, ~63 KB, no build step) |
| `PEPL.jsx` | React source for the prototype, for reference |
| `RELEASE_NOTES_v0.2.0.md` | End-user docs: setup, walkthroughs, game rules |
| `app/` | Production scaffold — Next.js 14 + Supabase. Deploys to Vercel separately. |
| `app/supabase/migrations/` | The 4 SQL migrations (schema, RLS, scoring function, app helpers) |
## 📚 Release history

   - [v0.2.0](./RELEASE_NOTES_v0.2.0.md) — Bug fixes from initial QA *(latest)*
   - [v0.1.0](./RELEASE_NOTES_v0.1.0.md) — Initial MVP release

## 🚀 Quick demo flow

1. Open the live URL
2. Add user "Alex" → Create League → fill in fields
3. Add user "Bri" via header dropdown → switch users → join with the invite code
4. Switch to Alex → Start Season → New Round → Add events
5. Switch to Bri → submit picks
6. Switch back to Alex → Lock Now → Resolve → Finalize
7. Watch the leaderboard update

Full walkthrough in [`RELEASE_NOTES_v0.2.0.md`](./RELEASE_NOTES_v0.2.0.md).

## 🛠️ Production deployment

The `app/` folder is the production scaffold. See [`app/README.md`](./app/README.md) for Supabase setup and Vercel deploy instructions.

## License

MIT

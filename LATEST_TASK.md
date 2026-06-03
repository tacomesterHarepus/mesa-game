# Latest Task

## Summary

Fixed dev-mode hand display bug: the dev player-switcher showed empty hands for AI players who joined with their own `user_id` (different from the host's). Root cause: the `hands` RLS policy (`player_id IN (SELECT id FROM players WHERE user_id = auth.uid())`) blocked the host from reading hands of players with a different `user_id`. All hand queries returned `[]`, and `if ([])` is truthy in JS, so `setHand([])` fired, leaving the hand empty and never updated.

Fix: migration 023 adds `is_dev_game boolean NOT NULL DEFAULT false` to `games` and a new additive `hands` SELECT policy (`dev host reads all hands`) that fires only when `is_dev_game = true`. start-game v13 sets `is_dev_game = true` when the request `Origin` is localhost/127.0.0.1 — the same gate used by `override_player_id` in all other functions. Prod games are unaffected (Vercel origin leaves `is_dev_game = false`).

## Files changed

- `supabase/migrations/023_dev_game_hand_access.sql` — new migration: `is_dev_game` column + `"dev host reads all hands"` policy
- `supabase/functions/start-game/index.ts` — origin check + `is_dev_game: isDevGame` in games.update

## Deployed

- Migration 023: applied to prod via MCP
- start-game: v13, deployed via MCP
- Verified live: origin gate present in function body, both hands policies exist, `is_dev_game` column confirmed `boolean NOT NULL DEFAULT false`

## Test status

- `next build`: clean (pre-existing lint warnings only)
- E2E suite: not run (env issue)

## Known limitation

Supabase Realtime re-evaluates RLS at `postgres_changes` event delivery. The new `"dev host reads all hands"` policy should also gate Realtime INSERT events — but this is unverified. If initial hand load is fixed but live card draws don't appear in the dev window, that is the known Realtime-RLS gap. Do not add polling without approval; report and stop.

## Suggested next

1. **Manual verification:** Start a new dev game via Fill Lobby (must be a fresh start so start-game v13 runs and sets `is_dev_game = true`). Switch the dev switcher to an AI player who also has a real separate browser open. Confirm the hand shows correctly and card draws update live.
2. If Realtime INSERT events still don't reach dev window, report. Do not add polling without approval.
3. Otherwise: this closes the dev-mode hand-display bug. Next from BACKLOG.

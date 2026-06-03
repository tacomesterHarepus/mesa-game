# Latest Task

## Summary

Implemented card-reveal:201 fix: Option 2 (stable/volatile field split in GameBoard reconnect-refresh) plus a phase-keepalive poll. Also committed the generation counter (Fix 2, which was in the working tree from a prior session). Build clean.

**What shipped:**
- **Stable/volatile split (Step 2):** The reconnect-refresh on SUBSCRIBED no longer overwrites volatile subscription-owned fields. Stable game fields applied: `host_user_id`, `created_at`, `turn_order_ids`, `core_progress`, `escape_timer`. Stable player fields applied: `display_name`, `role`, `cpu`, `ram`, `turn_order`. All other fields (phase, current_turn_player_id, role_revealed, has_revealed_card, has_discarded_this_turn, skip_next_turn, revealed_card_key, and all other volatile game fields) are now subscription-only.
- **Phase-keepalive (Step 3):** 2s `setInterval` fetching only `games.phase + current_turn_player_id`. On each tick, applies if different from current state. Recovers phase-transition events dropped in Supabase's documented 1–3s post-SUBSCRIBED dead zone. Clears on unmount. This is the same safety net the lobby got in Fix 1.
- **Generation counter (Fix 2, riding along):** `subEventGenRef` incremented by every subscription event; reconnect-refresh captures counter at SUBSCRIBED and skips the stable-field apply if any event fired during the async window. Defence-in-depth against the interleaved race.

**Field audit:** Full volatile/stable classification documented in DIAGNOSIS_2026-06-03-reconnect-refresh-race.md §card-reveal:201.

## Files changed

- `components/game/GameBoard.tsx` — Stable/volatile split in reconnect-refresh guard block (lines ~296–331); phase-keepalive useEffect added (lines ~130–169); `Phase` type imported; generation counter implementation (from prior session)
- `DIAGNOSIS_2026-06-03-reconnect-refresh-race.md` — New section: card-reveal:201 at-mount stale-snapshot mechanism; architecture decision; Option 1/2 trade-offs

## Test status

- `next build`: clean
- Isolated card-reveal:201: **could not verify** — pre-existing environment issue: `fillLobby` helper hangs at Supabase anonymous auth via Playwright on all Windows-side dev servers in this session (confirmed same failure with changes stashed, i.e. not caused by our code). User must run from Windows terminal.
- card-reveal:132: same environment issue — could not verify whether pre-existing DevQueueInspector overlay failure persists or resolves.

## Suggested next

1. **User: run full suite from Windows terminal** (`npx playwright test` or `npm run test:e2e`). Compare against BASELINE_2026-04-28.md. card-reveal:201 should pass. card-reveal:132 is expected to still fail (pre-existing DevQueueInspector overlay issue, unrelated to this fix). If full suite passes gate (no new failures), proceed to Phase 4.
2. **Phase 4 scope:** add hand to reconnect-refresh; remove hand from the remaining 3s poll; remove the entire poll setInterval useEffect.

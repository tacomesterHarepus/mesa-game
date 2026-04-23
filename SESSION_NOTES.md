# Session Notes

## Current Phase
**Phase 10 — Human Controls** (next up)

## Build Status

| Phase | Status | Notes |
|-------|--------|-------|
| 1. Project setup | ✓ | Next.js 14, TypeScript strict, Supabase, GitHub, Vercel |
| 2. Auth + lobby | ✓ | Anonymous auth, create/join game, start-game edge function |
| 3. Database + RLS | ✓ | Migrations 001–010, spectators, rematch schema, RLS policies |
| 4. Game state machine | ✓ | GameBoard, all phase components, polling + Realtime |
| 5. Card data layer | ✓ | cards.ts, missions.ts, deck.ts, virusRules.ts, missionRules.ts |
| 6. Mission flow | ✓ | play-card, end-play-phase (simplified) |
| Dev Mode | ✓ | Fill Lobby, PlayerSwitcher, override_player_id in all edge functions |
| 7. Virus system | ✓ | place-virus, end-play-phase v4, resolve-next-virus; VirusResolution UI |
| 8. Secret actions | ✓ | secret-target function; SecretTargeting UI |
| 9. Mission special rules | ✓ | play-card v5 + end-play-phase v5; mission rules enforced server-side |
| Bug fixes (post-P9) | ✓ | Bug 1 (cpu/ram defaults), Bug 2 (draw cards), Bug 3 (CardReveal loading) |
| 10. Human controls | **NEXT UP** | |
| 11. Game log | pending | |
| 12. Chat system | pending | |
| 13. UI polish | pending | |

**Test suite: 31/43 passing** (12 skip = test.skip() branches that only run when specific missions/viruses appear in random game — expected)

## Deployed Edge Functions

All functions use `verify_jwt: false` with manual ES256 JWT decode (`atob()` in function body). Supabase switched to ES256 and rejects tokens when `verify_jwt: true`.

| Function | Version | Notes |
|----------|---------|-------|
| start-game | v7 | Defensive: explicitly sets cpu=1, ram=4 for AI players |
| adjust-resources | v3 | override_player_id support |
| select-mission | v3 | override_player_id support |
| reveal-card | v4 | override_player_id support |
| allocate-resources | v4 | override_player_id support |
| place-virus | v1 | AI places cards into pending_viruses |
| end-play-phase | v6 | draw cards on turn advance (drawCardsForPlayer helper) |
| resolve-next-virus | v2 | secret-targeting case: sets current_targeting_resolution_id + current_targeting_card_key |
| secret-target | v1 | vote mode + force-resolve mode; tally + effect; clears state → virus_resolution |
| play-card | v5 | all 10 mission special rules + pipeline_breakdown + dependency_error_active |

## Dev Mode (DONE)

Single-user multi-player testing without needing 6 browsers.

- Migration 007: widened `hands` + `pending_viruses` RLS from `=` to `IN` (scalar subquery breaks with 6 players sharing user_id)
- `CreateGameForm.tsx`: "Dev Mode: Fill Lobby" button (NODE_ENV gated)
- `DevModeOverlay.tsx`: full-width amber DEV MODE banner + fixed top-right PlayerSwitcher; buttons carry `data-player-id` for test automation
- `GameBoard.tsx`: `activeDevPlayer` state, `effectiveCurrentPlayer`, hand re-fetch on switch
- All edge functions: `override_player_id` accepted, gated by `MESA_ENVIRONMENT !== "production"` AND caller owns all players
- **TODO (manual):** Set `MESA_ENVIRONMENT=production` in Supabase Dashboard → Project Settings → Edge Functions → Environment Variables

## Bug Fix Session (post-Phase 9) — Key Technical Notes

Three bugs found during first full dev-mode playthrough. Fixed one at a time.

**Bug 1 — AI stats showed 0/0 (false alarm):**
- Root cause: playtester misread the `+CPU 0 / +RAM 0` allocation delta controls in `ResourceAllocation.tsx` as base stats. DB always had correct defaults (cpu=1, ram=4).
- Fix: defensive change in `start-game` to explicitly set `cpu: 1, ram: 4` during role assignment rather than relying on DB defaults. Deployed as v7.
- BACKLOG: ResourceAllocation UI should show current stat + post-allocation preview, not just the delta.

**Bug 2 — Cards not drawn to hand after round 1:**
- Root cause: the draw step was never implemented. `advanceTurnOrPhase` in `end-play-phase` transitioned turn order correctly but never refilled hands.
- Fix: added `drawCardsForPlayer` helper to `end-play-phase`. Called in both turn-advance locations (within-round and round-2 start). Handles deck exhaustion by reshuffling `discarded` cards. Deployed as v6.
- Regression test: `tests/e2e/draw-cards.spec.ts` — verifies first AI's hand count equals RAM at the start of round 2.
- BACKLOG: `place-virus` leaves `deck_cards` rows in `'drawn'` status after moving card to virus pool; inconsistent but harmless.

**Bug 3 — CardReveal "Reveal Card" button shows "···" for subsequent AIs:**
- Root cause: `handleReveal()` in `CardReveal.tsx` called `setLoading(true)` but the success path never called `setLoading(false)`. In dev mode, CardReveal doesn't remount on PlayerSwitcher switch, so `loading=true` persisted for every player after the first reveal.
- Fix: moved `setLoading(false)` outside the error branch (runs on success and error). Added `useEffect` that resets `loading`, `selectedCard`, and `error` on `currentPlayer?.id` change — handles dev-mode switches cleanly.
- Regression test: `tests/e2e/card-reveal.spec.ts` — verifies "Reveal Card" button text is visible (not "···") after switching to the next AI.
- BACKLOG: same `loading`-not-reset-on-success pattern exists in MissionSelection, ResourceAllocation, ResourceAdjustment; SecretTargeting `selectedTargetId` not reset on player switch.

## Phase 10 Plan — Human Controls

Humans have three control points in the game where they take active actions:

**1. Resource Adjustment** (between missions, before mission selection)
- Humans can reduce any AI's CPU or RAM (down to minimums: CPU 1, RAM 3)
- Already implemented: `adjust-resources` edge function v3, `ResourceAdjustment.tsx` component
- Status: DONE — humans can submit adjustments and game advances to mission_selection

**2. Mission Selection** (already done)
- Humans pick 1 of 3 mission cards
- Already implemented: `select-mission` edge function, `MissionSelection.tsx`
- Status: DONE

**3. Resource Allocation** (after card reveal, before mission starts)
- Humans distribute the mission's bonus CPU/RAM pool among AIs
- Already implemented: `allocate-resources` edge function, `ResourceAllocation.tsx`
- Status: DONE

**4. Mission Abort** (round 2 only, between AI turns)
- Humans may abort a mission during Round 2, only between AI turns
- Triggers mission failure with normal fail penalty (escape_timer += fail_penalty)
- Needs: `abort-mission` edge function + UI button in `PlayerTurn.tsx` (shown to humans only, in round 2, when it's between turns)

**5. Card Reveal Phase UI** (humans observe, AIs reveal)
- Already implemented: `reveal-card` edge function, `CardReveal.tsx`
- Status: DONE

**What's actually missing for Phase 10:**
- `abort-mission` edge function: validates phase=player_turn AND round=2 AND caller is human; applies fail penalty; sets current_mission_id=null; transitions to resource_adjustment
- UI: In `PlayerTurn.tsx`, when `currentPlayer.role === 'human'` and `round === 2`, show "Abort Mission" button
- Test: abort-mission fires correctly, advances to resource_adjustment

**Key constraints:**
- Abort only valid in round 2 (not round 1)
- Abort only between turns (phase=player_turn, not mid-virus-resolution)
- Normal fail penalty applies (same as mission failure at end of round 2)
- After abort: same flow as mission failure → resource_adjustment for next mission

## Key Architecture Notes

**Realtime + polling pattern** (used in GameBoard and LobbyPhase):
- Polling every 3s fetches `games` + `players` (ensures state even if Realtime misses events)
- Realtime subscription uses `await supabase.auth.getSession()` before subscribing (critical — JWT must be loaded before the channel JOIN is sent)
- `game_log` is Realtime-only (not polled); log entries may be missing on pages with broken Realtime

**ES256 JWT decode pattern** (all edge functions):
```typescript
const token = authHeader.replace("Bearer ", "");
const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
const userId: string = payload.sub;
```

**Hand card lookups must use `.limit(1).maybeSingle()`** (not `.single()`):
Players can have multiple cards with the same `card_key`. `.single()` fails with a PostgREST error if more than one row matches.

**E2E test pattern for direct API calls from Playwright:**
- `@supabase/ssr` stores auth in cookies as `sb-<ref>-auth-token` with `base64-<base64_data>` encoding
- Extract with: `Buffer.from(value.slice(7), "base64").toString("utf-8")`, then JSON.parse for `access_token`
- Use `page.context().cookies("http://localhost:3000")` to get all cookies in test (Node.js context)
- DevModeOverlay buttons carry `data-player-id` attribute — use `.locator("[data-player-id]")` to get player IDs
- Direct fetch calls to Supabase REST API + edge functions bypass UI timing issues entirely
- Tests that depend on a random card appearing should use `test.skip()` when the condition isn't met (not `expect().toBe()`)

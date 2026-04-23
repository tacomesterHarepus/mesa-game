# Session Notes

## Current Phase
**Phase 8 — Secret Actions** (next up)

## Build Status

| Phase | Status | Notes |
|-------|--------|-------|
| 1. Project setup | ✓ | Next.js 14, TypeScript strict, Supabase, GitHub, Vercel |
| 2. Auth + lobby | ✓ | Anonymous auth, create/join game, start-game edge function |
| 3. Database + RLS | ✓ | Migrations 001–007, spectators, rematch schema, RLS policies |
| 4. Game state machine | ✓ | GameBoard, all phase components, polling + Realtime |
| 5. Card data layer | ✓ | cards.ts, missions.ts, deck.ts, virusRules.ts, missionRules.ts |
| 6. Mission flow | ✓ | play-card, end-play-phase (simplified — no virus resolution yet) |
| Dev Mode | ✓ | Fill Lobby, PlayerSwitcher, override_player_id in all 6 edge functions |
| 7. Virus system | ✓ | place-virus, end-play-phase v4, resolve-next-virus; VirusResolution UI; 23/23 tests |
| 8. Secret actions | **NEXT UP** | |
| 9. Mission special rules | pending | |
| 10. Human controls | pending | |
| 11. Game log | pending | |
| 12. Chat system | pending | |
| 13. UI polish | pending | |

**Test suite: 23/23 passing** (5 lobby + 7 dev-mode + 8 mission-flow + 3 virus-system)

## Deployed Edge Functions

All functions use `verify_jwt: false` with manual ES256 JWT decode (`atob()` in function body). Supabase switched to ES256 and rejects tokens when `verify_jwt: true`.

| Function | Version | Notes |
|----------|---------|-------|
| start-game | v6 | |
| adjust-resources | v3 | override_player_id support |
| select-mission | v3 | override_player_id support |
| reveal-card | v4 | override_player_id support |
| allocate-resources | v4 | override_player_id support |
| play-card | v4 | turn_play_count tracking |
| place-virus | v1 | AI places cards into pending_viruses |
| end-play-phase | v4 | full virus pipeline: shuffle → queue → virus_resolution phase |
| resolve-next-virus | v1 | applies one virus effect, win checks, Cascading Failure chaining, pool refill |

## Dev Mode (DONE)

Single-user multi-player testing without needing 6 browsers.

- Migration 007: widened `hands` + `pending_viruses` RLS from `=` to `IN` (scalar subquery breaks with 6 players sharing user_id)
- `CreateGameForm.tsx`: "Dev Mode: Fill Lobby" button (NODE_ENV gated)
- `DevModeOverlay.tsx`: full-width amber DEV MODE banner + fixed top-right PlayerSwitcher; buttons carry `data-player-id` for test automation
- `GameBoard.tsx`: `activeDevPlayer` state, `effectiveCurrentPlayer`, hand re-fetch on switch
- All edge functions: `override_player_id` accepted, gated by `MESA_ENVIRONMENT !== "production"` AND caller owns all players
- **TODO (manual):** Set `MESA_ENVIRONMENT=production` in Supabase Dashboard → Project Settings → Edge Functions → Environment Variables

## Phase 7 Completed — Key Technical Notes

**Virus generation formula** (per AI turn in `end-play-phase`):
- `base = cpu >= 2 ? 1 : 0`
- `bonus = cardsPlayed >= 3 ? 1 : 0`
- Total = min(2, base + bonus)

**`end-play-phase` v4 flow:**
1. Fetch pending_viruses for current player
2. Shuffle them into virus_pool (random position insertion)
3. Compute virus count via formula above
4. If count > 0: draw top N cards from pool into virus_resolution_queue, set phase = virus_resolution
5. If count = 0: call `advanceTurnOrPhase` directly

**`resolve-next-virus` flow:**
1. Get next unresolved row from virus_resolution_queue
2. Mark it resolved
3. Apply effect via `applyVirusEffect`:
   - `cascading_failure`: insert 2 more cards from pool into queue
   - `system_overload`: escape_timer + 1
   - `model_corruption / data_drift / validation_failure`: mission -1 contribution
   - `pipeline_breakdown / dependency_error`: set special_state flag
   - Secret-targeting cards: set phase = secret_targeting, return (pause resolution)
4. Check win conditions (escape_timer ≥ 8 after every card)
5. If queue empty: refill pool to 4 from deck, then `advanceTurnOrPhase`

**E2E test pattern for direct API calls from Playwright:**
- `@supabase/ssr` stores auth in cookies as `sb-<ref>-auth-token` with `base64-<base64_data>` encoding
- Extract with: `Buffer.from(value.slice(7), "base64").toString("utf-8")`, then JSON.parse for `access_token`
- Use `page.context().cookies("http://localhost:3000")` to get all cookies in test (Node.js context)
- DevModeOverlay buttons carry `data-player-id` attribute — use `.locator("[data-player-id]")` to get player IDs
- Direct fetch calls to Supabase REST API + edge functions bypass UI timing issues entirely

## Phase 8 Plan — Secret Actions

Cards that require secret targeting (targeting phase):
- `process_crash`: Misaligned AIs target → skip next turn
- `memory_leak`: target → loses 1 RAM
- `resource_surge`: target → gains 1 CPU
- `cpu_drain`: target → loses 1 CPU
- `memory_allocation`: target → gains 1 RAM

**What's needed:**
1. **`secret-target` edge function** — Misaligned AI submits a vote for a target player
   - Inserts into `secret_target_votes` (game_id, resolution_id, voter_player_id, target_player_id)
   - After all misaligned AIs vote OR deadline passes: tallies votes, random tiebreak, applies effect, returns to virus_resolution
2. **`SecretTargeting.tsx` component** — UI shown only to misaligned AIs during targeting phase
   - Dropdown/list to select a target AI (not human)
   - Shows 1-minute countdown from `game.targeting_deadline`
   - Submit vote button
3. **Targeting deadline** — `games.targeting_deadline` set in `resolve-next-virus` when secret-targeting card is hit
4. **Tally + effect application** — either in `secret-target` edge function (on last vote) or in a separate `end-targeting` edge function (on deadline)

**Key edge cases:**
- Only one misaligned AI in game → auto-resolves immediately
- Target cannot be a human
- Effect respects CPU/RAM min/max limits (1-4, 3-7)
- Effect persists across missions if target doesn't act before mission ends

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

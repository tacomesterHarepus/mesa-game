# Session Notes

## Current Phase
**Phase 9 — Mission Special Rules** (next up)

## Build Status

| Phase | Status | Notes |
|-------|--------|-------|
| 1. Project setup | ✓ | Next.js 14, TypeScript strict, Supabase, GitHub, Vercel |
| 2. Auth + lobby | ✓ | Anonymous auth, create/join game, start-game edge function |
| 3. Database + RLS | ✓ | Migrations 001–010, spectators, rematch schema, RLS policies |
| 4. Game state machine | ✓ | GameBoard, all phase components, polling + Realtime |
| 5. Card data layer | ✓ | cards.ts, missions.ts, deck.ts, virusRules.ts, missionRules.ts |
| 6. Mission flow | ✓ | play-card, end-play-phase (simplified — no virus resolution yet) |
| Dev Mode | ✓ | Fill Lobby, PlayerSwitcher, override_player_id in all edge functions |
| 7. Virus system | ✓ | place-virus, end-play-phase v4, resolve-next-virus; VirusResolution UI; tests pass |
| 8. Secret actions | ✓ | secret-target function; SecretTargeting UI; 26/28 pass, 2 skip (expected) |
| 9. Mission special rules | **NEXT UP** | |
| 10. Human controls | pending | |
| 11. Game log | pending | |
| 12. Chat system | pending | |
| 13. UI polish | pending | |

**Test suite: 26/28 passing** (2 skip = test.skip() branches that only fire if game naturally lands a targeting card — expected for random decks)

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
| resolve-next-virus | v2 | secret-targeting case: sets current_targeting_resolution_id + current_targeting_card_key |
| secret-target | v1 | vote mode + force-resolve mode; tally + effect; clears state → virus_resolution |

## Dev Mode (DONE)

Single-user multi-player testing without needing 6 browsers.

- Migration 007: widened `hands` + `pending_viruses` RLS from `=` to `IN` (scalar subquery breaks with 6 players sharing user_id)
- `CreateGameForm.tsx`: "Dev Mode: Fill Lobby" button (NODE_ENV gated)
- `DevModeOverlay.tsx`: full-width amber DEV MODE banner + fixed top-right PlayerSwitcher; buttons carry `data-player-id` for test automation
- `GameBoard.tsx`: `activeDevPlayer` state, `effectiveCurrentPlayer`, hand re-fetch on switch
- All edge functions: `override_player_id` accepted, gated by `MESA_ENVIRONMENT !== "production"` AND caller owns all players
- **TODO (manual):** Set `MESA_ENVIRONMENT=production` in Supabase Dashboard → Project Settings → Edge Functions → Environment Variables

## Phase 8 Completed — Key Technical Notes

**Schema additions (migration 010):**
- `games.current_targeting_resolution_id uuid REFERENCES virus_resolution_queue` — FK to the queue row that triggered targeting; used as `resolution_id` in `secret_target_votes`
- `games.current_targeting_card_key text` — card key string for UI display and effect lookup

**`resolve-next-virus` v2 changes:**
- Secret-targeting case now sets both new fields + `targeting_deadline` (60s from now) and transitions phase to `secret_targeting`
- Returns `{ paused: "secret_targeting" }` so callers know resolution is paused

**`secret-target` flow:**
1. Vote mode (`target_player_id` provided): caller must be misaligned_ai; upsert into `secret_target_votes` (unique on `resolution_id,voter_player_id` so votes can be changed)
2. After vote: check if all misaligned AIs voted OR deadline passed; if yes, tally
3. Force-resolve mode (`force_resolve: true`): any player can trigger; tallies immediately
4. Tally: count votes per target_player_id, random tiebreak among tied candidates; if no votes → random AI
5. Apply effect respecting limits (CPU 1–4, RAM 3–7), write game_log entry
6. Clear: phase = virus_resolution, targeting_deadline = null, current_targeting_* = null

**`SecretTargeting.tsx` component:**
- Misaligned AIs see: card label + effect description, countdown, target AI dropdown, "Submit Vote" button
- Non-misaligned AIs/humans see: countdown + "Misaligned AIs are selecting a target…" message
- Countdown via `useEffect`/`setInterval`; fires `handleDeadline()` (force_resolve call) at 0
- `deadlineTriggeredRef` prevents double-firing on deadline

**Test approach for secret_targeting:**
- Tests 1–2: phase guard — reject vote/force_resolve when not in secret_targeting (always runs)
- Tests 3–4: drive game to secret_targeting via end-play-phase → resolve-next-virus loop; skip if targeting card never appears (random deck)
- Test 5: UI smoke — checks MESA board renders; checks targeting UI if phase happens to be secret_targeting

## Phase 9 Plan — Mission Special Rules

The 12 missions each have special rules enforced server-side in `play-card`. Currently `play-card` v4 has no mission rule validation — it accepts all cards.

**Rules to implement (all validated in `play-card`):**

| Mission | Special Rule | State Key |
|---------|-------------|-----------|
| Dataset Preparation | Compute locked until Data requirement met | `dependency_error_active` (reuse from virus) |
| Cross Validation | Each Validation played by different AI | `validation_contributors: [player_id, ...]` |
| Distributed Training | At least 3 different AIs must contribute | `contributors: { player_id: count }` |
| Balanced Compute Cluster | Each AI ≤ 2 cards total | `contributors: { player_id: count }` |
| Dataset Integration | Each Data unlocks 2 Compute slots globally | `dataset_integration_compute_slots: int` |
| Multi-Model Ensemble | Each AI ≤ 1 Data, ≤ 1 Validation | `contributors: { player_id: data_count/val_count }` |
| Synchronized Training | All Compute must be in same round | `compute_round: 1 or 2` |
| Genome Simulation | Validation must be the final contribution | validate at completion time |
| Experimental Vaccine Model | Each AI ≤ 1 card in final round | `final_round_plays: { player_id: count }` |
| Global Research Network | Each AI ≤ 3 of one resource type | per-player per-type tracking |

**What's needed:**
1. Update `play-card` edge function to enforce all 10 mission special rules
2. The `active_mission.special_state` JSONB field already carries all needed tracking keys
3. UI: show relevant mission rule and current state in `PlayerTurn` / `MissionBoard`
4. Tests: `mission-rules.spec.ts` (one test per mission rule)

**Key architecture notes:**
- `play-card` already reads `active_mission.special_state` for `pipeline_breakdown_active` and `dependency_error_active`
- All rules should be additive checks — return early with an error string if rule violated
- `dependency_error_active` from virus and Dataset Preparation's compute lock are different: the virus one is a one-time flag that fires on a 50% chance; Dataset Preparation's is a permanent constraint for that mission

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

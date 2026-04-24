# Session Notes

## Current Phase
**Phase 10 — Human Controls** (next up)

Recent completed work:
- **Phase 7.5** — Virus placement UI + bug fixes. All items done. See `HISTORY.md` for full details.
- **Bug A (commit 24be693)** — `lib/supabase/invokeWithRetry.ts` retries edge-function cold-start failures; applied to all 8 callers.
- **Bug B (commit 998c700)** — Hand sorted by `id` in all 3 update paths in `GameBoard.tsx`; `tests/e2e/hand-stability.spec.ts` added.

Diagnosis files: `DIAGNOSIS_2026-04-24.md` (Phase 7.5 root causes), `DIAGNOSIS_2026-04-25.md` (Bug A cold-start, Bug B hand ordering).

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
| 7. Virus system | ✓ | place-virus, pending_viruses, virus pool, resolve-next-virus, VirusResolution UI |
| 8. Secret actions | ✓ | secret-target function; SecretTargeting UI |
| 9. Mission special rules | ✓ | play-card v5 + end-play-phase v5; mission rules enforced server-side |
| Bug fixes (post-P9) | ✓ | Bug 1 (cpu/ram), Bug 2 (draw cards), Bug 3 (CardReveal loading) |
| 7.5. Virus placement + fixes | ✓ | Items A–F done; virus placement UI + backend wired; E2E tests added |
| 10. Human controls | **NEXT** | abort-mission edge function + UI button |
| 11. Game log | pending | |
| 12. Chat system | pending | |
| 13. UI polish | pending | |

**Test suite: 34/48 passing, 11 skip, 1 fail, 2 did-not-run** (1 persistent fail = virus-system cold-start timeout; skips = random card conditions; 2 did-not-run = virus-system tests after cold-start failure)

---

## Phase 10 Plan — Human Controls

Most human control points are already implemented (resource adjustment, mission selection, card reveal, resource allocation). The one missing piece:

**`abort-mission` edge function:**
- Validates: `phase = player_turn` AND `round = 2` AND caller is human
- Applies fail penalty: `escape_timer += mission.fail_penalty`; sets `current_mission_id = null`
- Transitions to `resource_adjustment`

**UI in `PlayerTurn.tsx`:**
- When `currentPlayer.role === 'human'` and `round === 2`, show "Abort Mission" button
- Not shown in round 1; not shown during virus resolution

**Test:** abort-mission fires correctly, advances to resource_adjustment

**Key constraints:**
- Abort only valid in round 2, only between turns (phase=player_turn)
- Normal fail penalty applies (same as end-of-round-2 failure)
- After abort: same flow as mission failure → resource_adjustment

---

## Deployed Edge Functions

All use `verify_jwt: false` with manual ES256 JWT decode (`atob()` in function body).

| Function | Version | Notes |
|----------|---------|-------|
| start-game | v7 | Sets cpu=1, ram=4 explicitly during role assignment |
| adjust-resources | v3 | override_player_id support |
| select-mission | v3 | override_player_id support |
| reveal-card | v4 | override_player_id support |
| allocate-resources | v5 | Draws cards for first player after transition |
| place-virus | v1 | Moves card from hands → pending_viruses |
| end-play-phase | v7 | Imports drawCardsForPlayer from _shared/ |
| resolve-next-virus | v3 | Imports advanceTurnOrPhase from _shared/ |
| secret-target | v1 | Vote mode + force-resolve mode |
| play-card | v5 | All 10 mission special rules |

## Dev Mode

`override_player_id` accepted by all edge functions, gated by `MESA_ENVIRONMENT !== "production"` AND caller owns all players in the game.

**TODO (manual):** Set `MESA_ENVIRONMENT=production` in Supabase Dashboard → Project Settings → Edge Functions → Environment Variables.

## Key Architecture Notes

**Realtime + polling (GameBoard, LobbyPhase):**
- 3s poll fetches `games`, `players`, `active_mission`, and current player's hand — fallback for missed Realtime events
- Realtime: `await supabase.auth.getSession()` before subscribing (JWT must be loaded before channel JOIN)
- `game_log` Realtime-only (not polled)
- Hand sorted by `id` in all update paths — stable display order despite no `position` column on `hands`

**ES256 JWT decode (all edge functions):**
```typescript
const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
const userId: string = payload.sub;
```

**Hand lookups:** `.limit(1).maybeSingle()` — multiple rows per `card_key` are possible; `.single()` errors.

**Cold-start retry:** `lib/supabase/invokeWithRetry.ts` wraps all `functions.invoke` calls; retries on `FunctionsFetchError` or "Failed to send" up to 2×.

**E2E test patterns:**
- Auth token: cookie `sb-<ref>-auth-token` → strip `base64-` prefix → decode → `access_token`
- DevModeOverlay: `.locator("[data-player-id]")` gives player IDs for automation
- Direct REST/function calls bypass UI timing; random-card gates use `test.skip()`

---

*Completed phase implementation details are in `HISTORY.md`.*

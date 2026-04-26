# Session Notes

## Current Phase
**Phase 12 — Chat system** (next up)

Recent completed work:
- **Phase 7.5** — Virus placement UI + bug fixes. All items done. See `HISTORY.md` for full details.
- **Bug A v1 (commit 24be693)** — `invokeWithRetry` retries TCP-level cold-start failures (`FunctionsFetchError`).
- **Bug A v2 (commit 7a5d762)** — Extended to also retry relay-level cold-start failures (`FunctionsHttpError` 5xx); 4xx responses now surface actual server error message instead of generic wrapper. `tests/e2e/error-handling.spec.ts` added.
- **Bug B (commit 998c700)** — Hand sorted by `id` in all 3 update paths in `GameBoard.tsx`; `tests/e2e/hand-stability.spec.ts` added.
- **Phase 10.5 (commits 80c85b8–1c51e00)** — Seat order + turn rotation. Migration 011, start-game v8, advanceTurnOrPhase rotation, GameBoard sort, DevModeOverlay red ring, turn-order.spec.ts. All deployed. ⚠️ Abandon any dev games created before this deploy.
- **Post-10.5 bugs (commits c760b46, 8edfe02, d2089a2)** — Three Mission 2+ bugs fixed. Bug 3 (c760b46): GameBoard poll now fetches game first then queries active_mission by `current_mission_id` to avoid PGRST116 on mission 2+; CLAUDE.md updated with active_mission history-table clarification. Bug 2 (8edfe02): `select-mission` now refills all AI hands to RAM before transitioning to card_reveal; select-mission deployed as v4. Bug 1 (d2089a2): MissionSelection UI now shows allocation pool and fail timer penalty per card. Regression tests in `tests/e2e/multi-mission.spec.ts`. ⚠️ mission-rules.spec.ts has a pre-existing flaky timeout (test 28, `advanceToPlayerTurnForMission` 15s limit) — passes on isolated re-run, not a regression.

Diagnosis files: `DIAGNOSIS_2026-04-24.md` (Phase 7.5 root causes), `DIAGNOSIS_2026-04-25.md` (Bug A cold-start, Bug B hand ordering; appendix: Bug A revisit — FunctionsHttpError 5xx path; Phase 10.5 investigation), `DIAGNOSIS_2026-04-26.md` (three post-Phase-10.5 playtest bugs — all pre-existing, all Mission 2+; **appendix: missing discard step — full investigation + implementation plan**).

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
| 10.5. Seat order + turn rotation | ✓ | Migration 011, start-game v8, rotation logic, sorted roster, red ring, E2E test |
| Post-10.5 bugs | ✓ | Bug 3 c760b46, Bug 2 8edfe02, Bug 1 d2089a2. Regression tests in multi-mission.spec.ts. select-mission deployed as v4. |
| Discard step | ✓ | Migration 012, discard-cards v1, play-card v6 strict mode, PlayerTurn discard UI. 6 commits be74806–df76279. |
| Discard bug fix | ✓ | UI server-sync bidirectional (PlayerTurn.tsx); end-play-phase pool-empty path calls advanceTurnOrPhase. DIAGNOSIS_2026-04-26.md appendix 2. end-play-phase deployed v10. |
| 10. Human controls | ✓ | abort-mission v1 deployed; Abort Mission button in PlayerTurn; 3 E2E tests in abort-mission.spec.ts. |
| 11. Game log | **DONE** | Migration 013 (metadata jsonb), gameLogTypes.ts, 7-commit instrumentation. All edge functions emit typed metadata. E2E test game-log.spec.ts covers 16 guaranteed + 1 conditional event types + CPU≥2 ordering test. **mission_transition gap closed (Approach A):** migration 014 adds `pending_mission_outcome` to games; end-play-phase v13 writes it on virus path; resolve-next-virus v8 reads and passes it to advanceTurnOrPhase; cleared atomically in same update. **Session B UI rework:** 5 commits 7e06a3b–2c584f3 — LogEntry type widened (metadata: Record<string,unknown>), bold styling on mission_complete/failed/aborted/game_over, card_played running totals (n/m) via mission key scan, scroll preservation (40px threshold), E2E game-log-ui.spec.ts (3 tests). |
| 12. Chat system | pending | |
| 13. UI polish | pending | |

**Test suite: ~69/79 passing (est.), 13 skip, 0 genuine fail** (+3 game-log-ui UI tests. mission-rules.spec.ts has a pre-existing flaky timeout on test 28 in full-suite runs — passes in isolation. game-log.spec.ts cold-start flake on test 1 clears on re-run.)

---

## Deployed Edge Functions

All use `verify_jwt: false` with manual ES256 JWT decode (`atob()` in function body).

| Function | Version | Notes |
|----------|---------|-------|
| start-game | v8 | Removes double shuffle; turn_order null for humans; turnOrderIds = seat order |
| adjust-resources | v3 | override_player_id support |
| select-mission | v4 | override_player_id support; refills all AI hands before card_reveal |
| reveal-card | v4 | override_player_id support |
| allocate-resources | v7 | Draws cards + resets has_discarded_this_turn for first player |
| discard-cards | v2 | Phase 11: typed `discard` log with metadata |
| place-virus | v1 | Moves card from hands → pending_viruses |
| end-play-phase | v13 | Approach A: writes pending_mission_outcome to games on virus path when mission resolved |
| resolve-next-virus | v8 | Approach A: reads pending_mission_outcome, passes to advanceTurnOrPhase at queue-empty |
| secret-target | v2 | Phase 11: typed targeting_resolved log |
| play-card | v7 | Phase 11: typed card_played log with mission_progress snapshot |
| abort-mission | v2 | Phase 11: typed mission_aborted log; passes "aborted" to advanceTurnOrPhase |

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

**Cold-start retry:** `lib/supabase/invokeWithRetry.ts` wraps all `functions.invoke` calls. Retries up to 2× on:
- `FunctionsFetchError` / "Failed to send" — TCP failure before any HTTP response
- `FunctionsHttpError` with `status >= 500` — relay timeout returning 502/503/504
For non-retryable `FunctionsHttpError` (4xx), reads `error.context.json().error` and returns the actual server message instead of the generic Supabase wrapper.

**E2E test patterns:**
- Auth token: cookie `sb-<ref>-auth-token` → strip `base64-` prefix → decode → `access_token`
- DevModeOverlay: `.locator("[data-player-id]")` gives player IDs for automation
- Direct REST/function calls bypass UI timing; random-card gates use `test.skip()`

---

*Completed phase implementation details are in `HISTORY.md`.*

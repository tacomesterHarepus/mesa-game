# Session Notes

## Current Phase
**Two bug fixes done (contribution counters + unread badges). Next: end-game screen (§10 game_over phase visual) or end-of-redesign test cleanup pass.**

Recent completed work:
- **Bug fix: contribution counters + unread badges** — BUG A: wired full data path for ⚙/▣/◆ chip counters (GameBoard poll + Realtime subscription on mission_contributions, contributionMap derivation, CentralBoard/AIChipGroup prop threading). BUG B: always-mount PublicChat + MisalignedPrivateChat with display:none instead of conditional render — subscriptions now stay alive on inactive tabs. 2 commits a78d10c + 4521f99. Build clean.
- **Board redesign — secret_targeting + secret_chat + 3-tab RightPanel** — 4 commits: (1) RightPanel 3-tab rewrite (LOG/CHAT/🔒PRIV), activeTabRef for stale-closure-safe unread badges, canPostPublic/canPostPrivate chat lock functions, PublicChat+MisalignedPrivateChat redesigned as tab content (inline styles, poll backup, onNewMessage callbacks, locked UI); (2) CentralBoard TargetingChipConfig export interface + AIChipGroup targeting affordances (amber dashed ring=selectable, red ring=nominated, "CLICK TO NOMINATE"/"▸NOMINATED" counter-row labels, MIS badge for misaligned fellows), ActionRegion secret_targeting headers; (3) SecretTargeting full rewrite (chip-click nomination via localNominationId prop, MISALIGNED COLLECTIVE votes subscription, CURRENT NOMINATION panel, APPROVE & VOTE button), GameBoard wiring (localNominationId state, targetingChips config, isActivePlayer for secret_targeting, suppressed active chip during targeting), UX_DESIGN §8.4 virus_pull/resolution corrected to "everyone can post"; (4) secret-actions.spec.ts test 5 unskipped with chip-click assertions. Build clean, 4 commits pushed.
- **Board redesign — virus_resolution phase** — CentralBoard: VirusResolvingCard interface + VirusCardOverlay SVG component (dark-red theme at translate(220,170), pacing bar SMIL animate, TRIGGERED badge, card name/icon/effect from lookup tables); dimCore prop dims CoreChipGroup to 30% opacity. GameBoard: QueueCard + virusQueue state + useEffect subscription (INSERT/UPDATE on virus_resolution_queue, phase-gated); passes dimCore + virusResolvingCard to CentralBoard, currentCard + remaining to VirusResolution. VirusResolution: full rewrite — auto-resolve loop (useEffect keyed on currentCard?.id, 2s pacing then resolve-next-virus, 500ms advance on empty queue); CSS pacing bar; error fallback with manual Continue. virus-system.spec.ts: removed manual button tests, added phase-polling auto-advance assertions. 3/3 pass, canary 8/8. Build clean.
- **VirusPoolPanel live count** — VirusPoolPanel now accepts poolCount/pendingPullCount/phase props. Header dynamic (N CARDS, + M TO DRAW during virus_pull). GameBoard poll extended with virus_pool count query; Realtime INSERT/DELETE subscriptions for live updates. Build clean. Canary pass (isolated).
- **game_log Realtime miss — poll backup + scroll fix** — GameBoard 3s poll now appends last 50 game_log rows (id-dedup, append-only safe). RightPanel scroll fix: wasAtBottomRef via scroll listener (pre-render) replaces post-render distFromBottom check — fixes batch-addition auto-scroll. game-log-ui 3/3 pass, canary 8/8. Build clean.
- **Board redesign — virus_pull phase** — Migration 015 (pending_pull_count int default 0). end-play-phase v14: numViruses>0 + pool non-empty now sets phase=virus_pull + pending_pull_count (logs virus_pull_initiated); pool-empty fallthrough unchanged. pull-viruses v1: reads pending_pull_count, pulls top N from pool into queue, logs virus_queue_start, sets phase=virus_resolution. VirusPull.tsx: active AI sees amber Pull button; observers see waiting message. ActionRegion + GameBoard wired. virus-system.spec.ts endCurrentPlayerTurn updated to chain pull-viruses. Canary suite 8/8 pass. Build clean.
- **RAM track fix + BACKLOG additions** — CentralBoard: 5→7 squares, ramFilled cap raised to 7, track start shifted to x=110 (ends at 158, within 160-wide body). UX_DESIGN §5.2 + §10.1 updated. BACKLOG: new "UI/UX polish (post-redesign)" section with 3 entries (allocation visibility, layout density, mockup re-render). Canary suite 8/8 pass (mission-rules pre-existing flake unchanged). Build clean.
- **Mobile workflow iteration 2** — MOBILE_TEST.md task log + current state updated. Testing 5-line NTFY cap.
- **Mobile workflow setup** — MOBILE_TEST.md created. CLAUDE.md "Task completion ritual" updated by user (LATEST_TASK.md + NTFY ping added to ritual). NTFY topic: ntfy.sh/mesa-claude-lind-7k2x7.
- **Board redesign — card_reveal phase task** — CentralBoard: RevealChipConfig + RevealSlotGroup renders revealed card icon/name/owner on chip slots (progress cards in color, virus cards in red). CardReveal.tsx: full visual redesign — RevealCardStack (110×120px cards, shadow offset, count badge, SELECTED tag), stacked hand grouped by card_key, Reveal Card button with useRef fix for stale closure. GameBoard: revealSlots prop wired, currentPlayer + hand + overridePlayerId threaded to CardReveal. ActionRegion: "REVEAL ONE CARD" / "AIs REVEALING CARDS" headers. E2E: card-reveal.spec.ts unskipped; mission-flow.spec.ts test 6 timing fixed (waitFor not isVisible + per-reveal confirmation wait). `next build` clean, both spec files 100% pass.
- **Board redesign — resource_adjustment + resource_allocation phase tasks** — One unified `ResourcePhase.tsx` (mode: "adjustment"|"allocation"). CentralBoard extended: `"use client"`, `ResourceChipConfig` export, `SVGChipButton` helper, `[-]/[+]` buttons at chip-local x=171/185 (CPU y=61, RAM y=74), pending-state visual (solid=permanent, outlined-red-dashed=removal for adjustment, outlined-amber-dashed=addition for allocation). State lifted to GameBoard (resPendingCpu/resPendingRam), reset useEffect on phase exit, per-player chip config with guard closures. Active chip suppressed during resource phases (currentTurnPlayerId passed as undefined). ActionRegion extended with adjustment/allocation headers. Old ResourceAdjustment.tsx + ResourceAllocation.tsx deleted. build clean, multi-mission 3/3 pass.
- **Board redesign — mission_selection phase task** — MissionCandidatesPanel (left column y=180–565, 3 stacked candidates), GameBoard conditional render (MissionPanel+VirusPool hidden during phase), ActionRegion "SELECT MISSION" header, MissionSelection lifted-state rework. 2 commits 21efe1e–4b8ae6c. build clean. mission-flow:143 + multi-mission all pass.
- **Board redesign — player_turn phase task** — 6 items done: (1) active chip amber styling per §5.4 (CentralBoard.tsx full rewrite; all color vars conditional on isActive; outer amber border; ACTIVE tag; seat# from turnOrderIds); (2) ActionRegion amber treatment — 30px header, amber border+tint for active player, neutral watching header; (3) PlayerTurn.tsx full visual rework — stacked card groups by card_key (110×120px, shadow offset, count badge, SELECTED/DISCARD tags), 4-button panel (Play Card/Stage for Pool/Discard/End Turn), amber=enabled/#0c0c0c=disabled; (4) seat number fix — `turnOrderIds.indexOf(playerId)+1` vs `turn_order+1`; (5) duplicate "0/10" fix — removed numeric label from CoreChipGroup (fixes mission-flow.spec.ts:119); (6) test discipline — game-log-ui.spec.ts:243, secret-actions.spec.ts:484, card-reveal.spec.ts:83 skipped with phase-task comments; hand-stability.spec.ts:309 selector preserved (h3 "Your Hand" is back). `next build` passes clean.
- **Board redesign — scaffolding pass** — New `components/game/board/` directory with 8 sub-components (TopBar, TrackerBars, HumanTerminals, MissionPanel, VirusPoolPanel, CentralBoard, ActionRegion, RightPanel). GameBoard.tsx updated: old display imports removed, new board layout wired in. All hooks/polling/Realtime/devMode/renderPhase() preserved intact. Phase components still render inside ActionRegion (neutral border). Pre-existing TS type error fixed (`setGame` poll spread cast). `next build` passes clean. Playwright webServer timeout is a pre-existing environment issue (fails identically on original code). Design deviations: virus pool placed in left column per UX_DESIGN §4.3 (not stale mockup right-side position). Chip seat numbers show permanent `turn_order + 1` (mission turn rotation to be refined in player_turn task).
- **Phase 7.5** — Virus placement UI + bug fixes. All items done. See `HISTORY.md` for full details.
- **Bug A v1 (commit 24be693)** — `invokeWithRetry` retries TCP-level cold-start failures (`FunctionsFetchError`).
- **Bug A v2 (commit 7a5d762)** — Extended to also retry relay-level cold-start failures (`FunctionsHttpError` 5xx); 4xx responses now surface actual server error message instead of generic wrapper. `tests/e2e/error-handling.spec.ts` added.
- **Bug B (commit 998c700)** — Hand sorted by `id` in all 3 update paths in `GameBoard.tsx`; `tests/e2e/hand-stability.spec.ts` added.
- **Phase 10.5 (commits 80c85b8–1c51e00)** — Seat order + turn rotation. Migration 011, start-game v8, advanceTurnOrPhase rotation, GameBoard sort, DevModeOverlay red ring, turn-order.spec.ts. All deployed. ⚠️ Abandon any dev games created before this deploy.
- **Post-10.5 bugs (commits c760b46, 8edfe02, d2089a2)** — Three Mission 2+ bugs fixed. Bug 3 (c760b46): GameBoard poll now fetches game first then queries active_mission by `current_mission_id` to avoid PGRST116 on mission 2+; CLAUDE.md updated with active_mission history-table clarification. Bug 2 (8edfe02): `select-mission` now refills all AI hands to RAM before transitioning to card_reveal; select-mission deployed as v4. Bug 1 (d2089a2): MissionSelection UI now shows allocation pool and fail timer penalty per card. Regression tests in `tests/e2e/multi-mission.spec.ts`. ⚠️ mission-rules.spec.ts has a pre-existing flaky timeout (test 28, `advanceToPlayerTurnForMission` 15s limit) — passes on isolated re-run, not a regression.

Diagnosis files: `DIAGNOSIS_2026-04-24.md` (Phase 7.5 root causes), `DIAGNOSIS_2026-04-25.md` (Bug A cold-start, Bug B hand ordering; appendix: Bug A revisit — FunctionsHttpError 5xx path; Phase 10.5 investigation), `DIAGNOSIS_2026-04-26.md` (three post-Phase-10.5 playtest bugs — all pre-existing, all Mission 2+; **appendix: missing discard step — full investigation + implementation plan**), `DIAGNOSIS_2026-04-27.md` (Item 1: mission_transition gap on CPU≥2 virus path — Approach A implemented; **Item 2: board redesign E2E test inventory — 5 pending-phase, 9 non-ui canary, 9 pre-existing; see for skip/unskip plan per phase task**).

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
| 12. Chat system | deferred to BACKLOG | |
| 13. UI polish | deferred to BACKLOG | |
| Board redesign — scaffolding | **DONE** | `components/game/board/` skeleton: TopBar, TrackerBars, HumanTerminals, MissionPanel, VirusPoolPanel, CentralBoard, ActionRegion, RightPanel. GameBoard.tsx updated. build clean. |
| Board redesign — player_turn | **DONE** | Active chip styling (§5.4), ActionRegion amber header, PlayerTurn stacked-card hand + 4-button panel, seat# fix, duplicate-0/10 fix. 3 tests skipped (pending-phase), hand-stability:309 selector preserved. build clean. |
| Board redesign — mission_selection | **DONE** | MissionCandidatesPanel (left column y=180–565, 3 stacked candidates), GameBoard conditional render (MissionPanel+VirusPool hidden during phase), ActionRegion "SELECT MISSION" header, MissionSelection lifted-state rework. 2 commits 21efe1e–4b8ae6c. build clean. mission-flow:143 + multi-mission all pass. |
| Board redesign — resource_adjustment + resource_allocation | **DONE** | Unified ResourcePhase.tsx, CentralBoard chip buttons (SVGChipButton, [-]/[+]), pending-state visual (solid/dashed), lifted state in GameBoard, active chip suppression. Old ResourceAdjustment.tsx + ResourceAllocation.tsx deleted. build clean. multi-mission 3/3 pass. |
| Board redesign — card_reveal | **DONE** | RevealSlotGroup in CentralBoard, CardReveal visual redesign (RevealCardStack + useRef fix), GameBoard wiring, ActionRegion headers. card-reveal.spec.ts unskipped. mission-flow.spec.ts test 6 timing fixed. build clean. 8/8 pass. |
| Board redesign — virus_pull | **DONE** | Migration 015, end-play-phase v14, pull-viruses v1, VirusPull.tsx, ActionRegion + GameBoard wired. virus-system.spec.ts endCurrentPlayerTurn chains pull-viruses. build clean. 8/8 canary pass. |
| Board redesign — virus_resolution | **DONE** | VirusCardOverlay SVG component in CentralBoard (dark-red theme, pacing bar, lookup tables); dimCore prop; QueueCard + virusQueue + subscription in GameBoard; VirusResolution full rewrite (auto-resolve loop, CSS pacing bar, error fallback). ActionRegion muted-red header. virus-system.spec.ts rewired (no manual button tests; phase-polling assertions). build clean. 3/3 + canary 8/8 pass. |
| Board redesign — secret_targeting + secret_chat | **DONE** | RightPanel 3-tab (LOG/CHAT/PRIV), chat components redesigned as tab content, TargetingChipConfig, chip targeting affordances, SecretTargeting full rewrite, GameBoard wiring, UX_DESIGN §8.4 update, secret-actions test 5 unskipped. 4 commits. build clean. |

**Test suite: ~71/80 passing (est.), 12 skip, 0 genuine fail** (card-reveal.spec.ts unskipped: +1 test. mission-flow.spec.ts test 6 fixed. mission-rules.spec.ts has a pre-existing flaky timeout on test 28 in full-suite runs — passes in isolation. game-log.spec.ts cold-start flake on test 1 clears on re-run.)

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
| end-play-phase | v14 | virus_pull phase: sets phase=virus_pull + pending_pull_count; pool-empty fallthrough unchanged |
| pull-viruses | v1 | Pulls pending_pull_count cards from pool into queue; logs virus_queue_start; sets phase=virus_resolution |
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

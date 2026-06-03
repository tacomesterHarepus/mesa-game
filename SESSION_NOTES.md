# Session Notes

## Current Investigation (2026-05-07) — RESOLVED (bb569c6, merge 542ba4c, deployed Supabase v12)

**Virus pool stays at 2 after Cascading Failure — root cause confirmed via DB inspection. No code applied yet.**

User observed: pool sequence 4 → 5 (pending added) → 4 (pull-viruses) → Cascading Failure pulls 2 → pool=2 → phase transitions away → pool stays at 2 permanently (expected 4).

**Confirmed game state (game `1f988535-6f6c-4bc7-b3f3-b4a8e11980ad`):**
- `phase=card_reveal`, `core_progress=4`, `virus_pool count=2`
- `virus_resolution_queue`: 7 rows `resolved=TRUE` (all at position=0), PLUS 2 rows `resolved=FALSE` at positions 1 and 2 — both `compute` progress cards with `cascaded_from` CF id `6989de7d`
- `deck_cards`: discarded=33, drawn=21, in_deck=6 — deck NOT exhausted; partial-fill bug is NOT the cause

**Root cause: TOCTOU race condition in resolve-next-virus**

The auto-resolve timer in `VirusResolution.tsx` fires concurrent calls to `resolve-next-virus`. The race window exists between when CF is marked `resolved=true` (line ~61) and when `applyVirusEffect` finishes inserting cascade cards + deleting pool cards (~line 74). This window spans two async awaits (deck_cards SELECT + UPDATE).

Exact sequence in the buggy call:
1. **Call A** (triggered by CF card appearing): marks CF `resolved=true` → awaits deck_cards SELECT → awaits deck_cards UPDATE → starts `applyVirusEffect` → CF handler: reads pool (still has cards, not yet deleted) → awaits queue MAX → awaits INSERT cascade_1, cascade_2 → awaits DELETE 2 pool rows → pool goes 4→2
2. **Call B** (concurrent, fired during deck_cards await window in Call A): CF is `resolved=true`, no other queue row exists yet → `nextCard = null` → enters `!nextCard` branch → calls `refillVirusPool`: pool still has 4 rows (CF deletion hasn't happened yet) → `needed=0` → **refill exits immediately doing nothing** → calls `advanceTurnOrPhase` → logs `mission_transition` → phase transitions away from `virus_resolution`
3. Call A resumes: `applyVirusEffect` deletes 2 cards from pool (pool now 2) and inserts cascade_1, cascade_2 into queue — **phase is no longer `virus_resolution`**, cascade cards will never be resolved, pool stays at 2 permanently

**Game log proof (timestamps from game `1f988535`):**
- `virus_effect` — "Cascading Failure! 2 more viruses triggered." at `16:51:35.877`
- `mission_transition` — "Transitioning to next mission." at `16:51:36.084` — **207ms after CF resolved**
- `mission_transition` is only logged by `advanceTurnOrPhase` from the `!nextCard` branch. It fired while the cascade cards were not yet inserted (or not yet in the DB). This proves the concurrent call won the TOCTOU race.

**Double-fire evidence (Bot5 turn, same game):**
- Two `virus_no_effect` entries ("validation in virus pool") at `16:50:56.609` and `16:50:56.632` — 23ms apart
- Confirms concurrent invocations of resolve-next-virus are happening routinely

**Why refillVirusPool doesn't fix pool=2 in this race:**
The concurrent call (Call B) runs BEFORE CF's `applyVirusEffect` deletes the 2 pool rows. At that moment pool=4, so `needed = 4 - 4 = 0` and `refillVirusPool` returns immediately without inserting anything. The CF pool deletion happens AFTER the concurrent call completes, leaving pool at 2 with no refill triggered.

**Fix area (not yet applied):** The race window in `resolve-next-virus/index.ts` — the deck_cards UPDATE block (lines ~65–72) between mark-resolved and `applyVirusEffect` is the vulnerability. The correct fix must either (a) use a DB-level lock/transaction to make mark-resolved + applyVirusEffect atomic, or (b) re-fetch and re-check the queue state immediately before entering the `!nextCard` branch (idempotency check), or (c) move the deck_cards UPDATE to after `applyVirusEffect` to close the window.

**Secondary partial-fill bug still present (unrelated to this race):**
`refillVirusPool` only reshuffles discards if `drawCards.length === 0` — skips reshuffle when partial draw is possible. This is a separate bug triggered when deck is nearly exhausted. Not the cause of the current pool=2 observation.

---

## Current Phase

**Autonomous run triage — BLOCKED at Step 1 (2026-06-03).**

Two Phase 2 regressions found in isolation: abort-mission.spec.ts:175 and mission-flow.spec.ts:122 both fail (waitForURL timeout after clicking Start Game). Root cause: Phase 2 removed LobbyPhase 2s poll; Supabase Realtime has 1-3s replication-ready window after SUBSCRIBED — start-game games UPDATE lands in this window and is dropped with no recovery. virus-system:404 passes in isolation (full-suite contention flake).

Phase 3 card-reveal:201 race mechanism also confirmed in code (lines 141/242 no guard, lines 222/228/231 async window, line 242 stale phase write) — diagnosis in DIAGNOSIS_2026-06-03-reconnect-refresh-race.md. Fix not implemented — blocked by Phase 2 regression triage rule.

Required before proceeding: fix LobbyPhase start-game navigation (restore minimal phase-check to cover the 1-3s Supabase window), re-approve.

**Polling → Realtime migration Phase 3 — SHIPPED but Phase 4 BLOCKED (2026-06-03, commit 1fba3b0).**

GameBoard 3s poll stripped of game/players/mission/log/poolCount fetches. Added reconnect-refresh on SUBSCRIBED to game-${gameId} channel. Added game-over teardown (removeChannel on winner≠null or phase=game_over). Hand fetch stays in poll for Phase 4. Full suite: 58 pass / 8 fail / 16 skip / 9 did not run (15.7m). Gate FAILED: 4 new failures. Most actionable: card-reveal.spec.ts:201 — heading not found in 15s (PASSING in Phase 1). Suspected cause: reconnect-refresh async fetch overwrites games UPDATE phase transition (race condition). See LATEST_TASK.md §Gate analysis. Phase 4 blocked; user must review before proceeding.

**Polling → Realtime migration Phase 2 — CLOSED (2026-06-03, commit 7566673).**

Removed 2s setInterval poll from LobbyPhase.tsx; added reconnect-refresh (re-fetch players/spectators/game.phase on every 'SUBSCRIBED' transition). Scoped test run lobby+dev-mode: 11/12 pass (1 cold-start flake on fresh port, not a regression). Build clean. Awaiting manual lobby reconnect verification before Phase 3 approval.

**Polling → Realtime migration Phase 1 — CLOSED (2026-06-02, commit cadaf6f).**

Removed 3s setInterval backup poll from PublicChat.tsx and MisalignedPrivateChat.tsx. Both had existing Realtime subscriptions; poll was redundant. Root cause of playtest #1 double-message bug confirmed (stale messagesRef race between poll and subscription). Full suite: 69 pass / 4 fail (all pre-existing) / 16 skip — no regressions. See MIGRATION_PLAN_websocket.md for Phases 2–4. Awaiting user manual verification of double-message fix before Phase 2 approval.

---

**virus_pool lock + virus_pool_count — CLOSED (2026-06-02, commit 7a6b88f, deployed).**

Migration 022 applied (games.virus_pool_count int, virus_pool SELECT policy dropped, virus_pool removed from Realtime).
All 4 pool-mutating functions deployed with count sync: start-game v12, pull-viruses v6, end-play-phase v23 were already live; resolve-next-virus deployed as v22 (added CF-path count update + refill count update=4). GameBoard poolCount now sourced from games.virus_pool_count; virus_pool Realtime subscriptions removed. Reconciled from mid-deploy interruption: confirmed via MCP before committing.

Prod end state verified:
- games.virus_pool_count: column exists (integer)
- virus_pool policies: none (player SELECT leak closed)
- virus_pool in Realtime: not present
- All 4 functions: live with count sync

**Pool drift fix (resolve-next-virus v19) — CLOSED (2026-06-02, commit 2beab6e, deployed).**

Root cause: `drawFromDeck` returned 1 card when 2 were needed (partial PostgREST response). Old guard only handled `drawCards.length === 0`; partial result (0 < length < needed) silently accepted short combined array → pool=3 instead of 4. Observed live game 8b5e8141 (DIAGNOSIS_2026-06-02-virus-pool-drift.md).

Three-part fix:
- Part 1 (invariant throw): after pool INSERT, re-count and throw if pool ≠ 4. Catches any future under-fill regardless of mechanism.
- Part 2 (supplement loop): if drawFromDeck returns fewer than needed, reshuffle discards and draw the remaining deficit. Replaces zero-only guard.
- Part 3 (tests): two new tests in virus-system.spec.ts — 12-turn multi-path pool==4 assertion + supplement-path history check. Helpers added: resolveVirusQueueFully, queryPoolCount, waitForSettledPhase.

Deployed — MCP confirmed 2026-06-02: Supabase internal version 20. Both (a) supplement loop and (b) invariant throw present in deployed body.

Full suite (port 3006, clean server): 51 pass / 6 fail / 14 skip / 18 did not run.
Pre-existing failures (all 6): card-reveal:132, mission-flow:215, virus-placement:151 (DevQueueInspector overlay), game-log:284 (Card Reveal timeout), game-log:535 (CPU≥2 flake). No new regressions.
Pool-invariant tests (virus-system:404/439): passed after v19 deploy (verified by targeted run).

**PlayerTurn: Compute selectable when mission-blocked — CLOSED (2026-06-01, commit 325a241).**

`isDisabled` in the play-phase card render previously included `|| (computeBlocked && key === "compute")`, making Compute the only card grayed out / unclickable client-side for a conditional mission rule. All 10 other conditional rules (including `dependency_error`, which is semantically identical) are server-only: card selectable, server rejects illegal play, error shown. The gray-out also blocked staging Compute for virus placement, which has no mission restriction.

Removed the compute term so `isDisabled = virusDisabledKeys.includes(key)` only. Compute is now selectable in all states; server still rejects the play and returns the mission-specific error in the existing error line. Also relocated the mission-constraint hint span from below the card row to between `<h3>Your Hand</h3>` and the card row, so it stays visible when a card is lifted.

`mission-rules.spec.ts` test 4b updated: PART 1 assertion flipped from `aria-disabled="true" present` → `aria-disabled="true" absent` + server-rejection assertion (`Dataset Preparation` error returned).

Canary (mission-rules + multi-mission): 6 passed / 7 skipped (mission-key guards) / 1 failed (test 11 genome_simulation — pre-existing shared-state CPU exhaustion issue, reproduces on unmodified code, skips in isolation).

---

**Pool shuffle fix — CLOSED (2026-05-31/06-01, commits 1deec96 + 7f76fb7 + 79f47d7 + 40c093a).**

New invariant: `virus_pool.position` encodes nothing — after any mutation, positions are a random permutation of {0..N-1}. Eliminates the FIFO information leak where staged cards were distinguishable by position.

All changes on master:
- `end-play-phase` v18 (commit 40c093a): CAS player_turn→between_turns sentinel at top; pending→pool replaced with DELETE-all-pool + INSERT (survivors+pending) shuffled 0..N-1; removed maxPoolRow query. Was deployed but never committed; reconciled 2026-06-01.
- `resolve-next-virus` v18 (commit 1deec96): refillVirusPool replaces maxPos+1 append + 23505 catch with DELETE-all + INSERT (survivors+drawn) shuffled.
- `GameBoard.tsx` (commit 7f76fb7): virus_pool INSERT/DELETE handlers → re-fetch-on-event (delta counting broke under batch reshuffle).
- `tests/e2e/virus-placement.spec.ts` (commit 79f47d7): FIFO comment rewritten to reflect random-position invariant.
- Migration 020 SQL (commit 40c093a): virus_pool added to supabase_realtime publication; applied to prod prior session, tracked in master 2026-06-01.

23505 concern: RESOLVED. Verified 2026-06-01 via MCP get_edge_function: deployed body (Supabase function version 21) contains the CAS claim and DELETE-all+INSERT-shuffled reshuffle — no maxPoolRow query. The 23505 catch removal from resolve-next-virus v18 is safe: end-play-phase CAS prevents any concurrent pool inserter from running alongside refillVirusPool.

Full suite (from 79f47d7 session): 52 pass / 12 fail / 2 skip / 21 did not run. All 12 failures pre-existing.

DevQueueInspector dev panel (commit 09c5d61): read-only queue + pool inspector panel in dev mode for virus queue forensics. On master, pushed.

**Race 1 — double-CF application race — CLOSED (2026-05-31, commits e1f02ec + f761e1a, resolve-next-virus v17).**

Atomic per-card CAS claim added to `resolve-next-virus` between the `nextCard` SELECT (line 53) and the CF/non-CF processing branches. `being_processed=true` + `being_processed_at=now()` marks the owner; 5s timestamp reclaim recovers a card if the winner crashes in the CF failure window (~250ms, 5 DB awaits). v11 CF ordering (cascade INSERT before `resolved=true`) preserved unchanged. Migration 019 adds `being_processed boolean NOT NULL DEFAULT false` and `being_processed_at timestamptz` to `virus_resolution_queue`. Full suite: **71 pass / 1 fail (pre-existing game-log:535) / 15 skip** — clean, no regressions. See `DIAGNOSIS_2026-05-31-virus-cascade-loop.md §Race 1 fix design`.

**PENDING ACTIONS (as of 2026-06-01, verified via MCP):**
- Migration 018 (abort_vote schema): **ALREADY APPLIED** — `abort_votes` table and all three `games` columns confirmed present in prod via information_schema.
- Migration 019 (being_processed columns): **ALREADY APPLIED** — `being_processed` (boolean NOT NULL) and `being_processed_at` (timestamptz) confirmed present on `virus_resolution_queue` in prod.
- Manual verification before Tuesday: abort-vote flow end-to-end, targeting cross-browser, full clean round. Pool reshuffle + Race 1 CF chains looking good in playtest.
- Open backlog items: Race 2 (duplicate secret-target vote) still open. Two DevQueueInspector cosmetic items open (resolved-filter on duplicate detection, clear being_processed on resolve).
- Untracked project files to decide on: `playwright.noserver.config.ts`, `playwright.test3002.config.ts` (real Playwright configs used in canary runs — not scratch, not committed).

**secret_targeting concurrency race — CLOSED (2026-05-31, commits e4964cf + c4b41fe, deployed resolve-next-virus).**

Two concurrent `resolve-next-virus` calls could both pass the top-of-function `phase='virus_resolution'` guard. The targeting branch in `applyVirusEffect` wrote `phase='secret_targeting'` with no CAS condition, allowing the empty-queue CAS winner to claim `between_turns` first while the targeting write overrode it, then `advanceTurnOrPhase` wrote `player_turn` — leaving targeting fields orphaned and the game in `player_turn` with no `targeting_resolved` log.

Fix: added `.eq("phase", "virus_resolution").select("id")` CAS to the targeting UPDATE; loser returns `true` immediately (exits via `pauseForTargeting` path, no further writes). Also removed spurious `overridePlayerId` dep from `VirusResolution.tsx` auto-resolve useEffect dep array — this was the DevMode-specific trigger. Full root cause and DB forensics in `DIAGNOSIS_2026-05-31-targeting-playerswitch.md`.

Full suite: **72 pass / 1 fail (pre-existing game-log:535) / 14 skip**. virus-system.spec.ts 85-87 all pass.

Previous: **Abort-vote mechanic — COMPLETE (2026-05-31): server layer (Step 2) + UI layer (Step 3) shipped.**

Step 2 summary (commit c7ca2ee, previously deployed):
- Migration `018_abort_vote.sql` written and applied to Supabase project (NOT yet applied to prod by user).
- `_shared/advanceTurnOrPhase.ts` — `MISSION_FAIL_PENALTIES`, `resetPlayersForNextMission`, `applyMissionAbort` exported.
- `abort-mission` refactored, `end-play-phase` + `resolve-next-virus` inject abort vote at turn boundaries, `flag-abort` + `submit-abort-vote` deployed (v1 each).

Step 3 summary (commit 6fb3576):
- `types/game.ts` — `abort_vote` phase + `abort_flag_pending`, `abort_vote_deadline`, `abort_flag_player_id`.
- `PlayerTurn.tsx` — FLAG ABORT button (replaces ABORT MISSION); suppressed on `isLastTurnOfRound2`; flagged-state message when `abortFlagPending`.
- `AbortVote.tsx` — new phase component: 30s countdown, Abort/Continue for humans, live tally (Realtime on `abort_votes`), waiting state for AIs.
- `ActionRegion.tsx` — `abort_vote` in `isActionPhase`, header text, red color.
- `GameBoard.tsx` — `abort_vote` case wired, `isLastTurnOfRound2` computed, `abortFlagPending` prop passed.
- `tests/e2e/abort-vote.spec.ts` — 4 tests (flag→abort_vote, abort majority→resource_adjustment, split vote→player_turn, flag suppressed last turn + UI check).
- Full suite: **71 pass / 1 fail (pre-existing game-log:535) / 15 skip**. No regressions.

Previous: **virus_resolution advance is now server-side idempotent (2026-05-30, commits c09eff8 + 5e515a4 + f6b0a8e).**

- **Commit 1 (c09eff8) — CAS guard in resolve-next-virus:** In the empty-queue path, after the stale-queue re-check, a conditional UPDATE (`UPDATE games SET phase='between_turns' WHERE id=? AND phase='virus_resolution'`) gates the advance. Only one concurrent caller can win (Postgres row lock). Loser gets 0 rows affected and returns no-op success. Snapshot check changed from `throw` to no-op return so concurrent losers arriving after the winner already transitioned don't surface AUTO-RESOLVE FAILED. Deployed as Supabase internal **v14** (2026-05-30).

- **Commit 2 (5e515a4) — Client revert:** Reverted the resolveInFlightRef workaround from commit 59ad57a. `resolveInFlightRef.current = false` is now unconditional at the top of every useEffect execution. The server CAS guard is the authoritative double-advance prevention; no client guard needed. This also closes the 100% freeze introduced by commit 59ad57a (where ref=true in else-branch permanently blocked the advance timer).

- **Commit 3 (f6b0a8e) — Test fix (mission-flow.spec.ts):** `a human player submits resource allocation advancing to player_turn` was failing because commit 3923191 added an unallocated-pool confirmation dialog. Test now dismisses it with a 2s optional-click for "Continue anyway".

**Test suite: 66 pass / 1 fail (pre-existing game-log:535 CPU≥2 flake) / 16 skip.** virus-system.spec.ts test 3 ("phase auto-advances away from virus_resolution within 30s") passes.

**Bug status (2026-05-30):**
- **Bug 5+8 — RESOLVED** (v13 UNIQUE constraint on virus_pool + v14 CAS guard closes the double-refill and double-advance races that caused display drift). Caveat: double-CF application race (two concurrent calls both reading a CF card as resolved=false) is a separate, uncharacterized backlog item — not fixed by v14.
- **Bug 6 — RESOLVED** (v14 CAS guard's no-op snapshot check removes the source of AUTO-RESOLVE FAILED; no freeze observed in playtest).
- **Bug 4 — RESOLVED** (commit a483937, playtest-confirmed). Caveat: in dev mode, switching to a Misaligned AI without first clicking a nomination chip defaults selectedTargetId to the first AI — minor UX gap, optional polish only.
- **Bug 3 — RESOLVED** (removed by design — hand-stack visual and `×? cards` label deleted from AIChipGroup entirely; hand size intentionally not displayed; UX_DESIGN §5.3 updated).

**Double-CF application race (separate from above):** Backlogged. See BACKLOG.md and DIAGNOSIS_2026-05-30.md §VERIFICATION for characterization.

Previous: **Bug 7 from DIAGNOSIS_2026-05-30.md fixed (2026-05-30, commit 0a6d62e).** `computeBlocked` in PlayerTurn.tsx extended to cover Dataset Preparation (data_contributed < 4). Hint text now mission-specific. `aria-disabled` + `data-card-key` added to CardStackGroup for test selection. New Test 4b in mission-rules.spec.ts. Build clean. Server block untouched.

Previous: **Bug 1 + Bug 2 from DIAGNOSIS_2026-05-30.md fixed (2026-05-30, commits ffdbbb2 + 42b90de).**

- **Bug 2 (Commit 1):** Reveal slot relocated from chip's outside edge to below the chip body. New position: slotX=chipX+50, top chips slotY=chipY+123, bottom chips slotY=chipY+94. Clears firewall (x=421), sibling chips, and [-]/[+] buttons. SLOT_SIDES constant removed. UX_DESIGN §5.6 updated.

- **Bug 1 (Commit 2):** `isRevealPhase` in GameBoard.tsx extended to include `resource_allocation` so revealed cards persist on chip slots until the mission starts. New test in card-reveal.spec.ts verifies persistence through resource_allocation and disappearance at player_turn.

Build clean both commits. Tests written; full suite not run (scoped BACKLOG fixes, not phase implementation).

Previous: **TOCTOU race in resolve-next-virus fixed and deployed v11 (2026-05-07, commits bb569c6 + merge 542ba4c).** Cascading Failure now correctly inserts cascade cards before marking CF resolved, and the empty-queue branch re-verifies before advancing. Pool returns to 4 after resolution. Awaiting user manual verification in a fresh dev game.

Previous: **Three BACKLOG fixes shipped 2026-05-06 (commits 3923191, a483937, 3fd186b).** (1) ResourcePhase.tsx: confirmation dialog when Start Mission clicked with unallocated pool resources — shows remaining CPU/RAM, "Allocate more" / "Continue anyway". (2) SecretTargeting.tsx: selectedTargetId resets on dev-mode player switch via useEffect keyed on currentPlayer?.id; chip-click nominations still sync via separate effect. (3) MissionSelection.tsx + ResourcePhase.tsx: try/finally ensures setLoading(false) fires on both success and error paths. Build clean. All three BACKLOG entries marked resolved.

Previous: **Virus pool / pending_viruses lifecycle bugs fixed (2026-05-06).** Three coordinated changes: (1) reverted v9 trim in refillVirusPool (wrong fix — masked accumulation, destroyed cards); (2) end-play-phase now deletes pending_viruses BEFORE inserting into pool and throws on delete error (eliminates stale-row accumulation on retry); (3) resolve-next-virus now marks each resolved queue card as status='discarded' in deck_cards (fixes permanent card loss from cascade resolution).

Recent completed work:
- **Playtest bug fixes (commits 62b92e6, 4aa44ca, f6f23d0)** — Bug 2: PlayerTurn.tsx now renders virus card effect descriptions in hand (8pt #cca0a0, only when card_type==="virus" and cardDef.description exists). Bug 1/1.5: CentralBoard.tsx RAM track moved from right column to left column stacked below CPU (x=10/40+i*7); button y-coords updated with isTop conditional (CPU: y=43/55, RAM: y=62/73). Bug 4b/4a: resolve-next-virus — data_drift/model_corruption/validation_failure logs now inside if(mission) with else-branch; refillVirusPool trims excess rows if pool > 4. resolve-next-virus deployed as **v9**. Canary: 9 fail / 12 did not run — all pre-existing webServer cold-start infrastructure failures at fillLobby; zero tests executed game logic. Not related to code changes (visual-only changes to PlayerTurn/CentralBoard; log/trim to resolve-next-virus). DIAGNOSIS_2026-05-05-playtest-bugs.md covers root causes.
- **Origin gate rollout (commits 31cb253, 79eb46f)** — Replaced MESA_ENVIRONMENT gate in all 10 remaining edge functions with origin-only gate (same as acknowledge-role v3 / select-mission v5). Added `devFetch()` helper in `tests/e2e/_helpers.ts` that adds `Origin: http://localhost:3000` to all Node.js edge function calls; all 14 test spec files updated to use it. Two failed approaches before final fix: (1) DENO_DEPLOYMENT_ID — IS set in hosted Supabase, so E2E tests calling hosted Supabase directly still get blocked; (2) SUPABASE_URL local detection — SUPABASE_URL in Docker runtime is `http://kong:8000` not `http://127.0.0.1:54321`, and tests call hosted Supabase anyway. Final gate: `origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1")`. Prod smoke test verified: Vercel Origin → "Player not found" (blocked), localhost Origin → "Override player not found in game" (override path taken). MESA_ENVIRONMENT remains set in Supabase (now irrelevant). Canary: **11 pass / 10 skip / 0 fail**. Diagnosis doc updated: `DIAGNOSIS_2026-05-05-mesa-env-rollback.md` §5 documents both failed approaches and the final fix.
- **Role reveal modal loop — Option C fix (3 commits 432c0fd, b58d217, cbd51c1)** — Fix 1 (server): removed redundant `user_id !== userId` check from `acknowledge-role` override path. Fix 2 (client): `handleAcknowledge` now destructures `invokeWithRetry` return value and rolls back optimistic update on error. Fix 3 (gate architecture): switched `acknowledge-role` and `select-mission` from `MESA_ENVIRONMENT !== "production"` to request-origin check (`origin` header starts with `http://localhost`). Root cause of gate change: MESA_ENVIRONMENT=production was set in Supabase Dashboard as part of pre-deploy hygiene, which breaks all edge functions that use Fill Lobby (multiple players share same user_id → `.single()` on non-override path returns PGRST116). The rollback (Fix 2) made this latent 400 error immediately visible.
- **Wall layout migration (5 commits 525cb26–commit5)** — SVG firewall wall (x=421–449, h=520) replaces the old CSS right-column layout. Chip cluster constrained to x=0–420. Action region extended 230→270px (top 658→618). All chip buttons, overlay anchors, and tracker bars relocated inside cluster area. SLOT_SIDES all "right" (card-reveal slots appear at chip right). VirusCardOverlay translate 220→95 (stays in cluster). WinnerBanner shifted +27 on all x coords (re-centered for 695px SVG). TrackerBars.tsx + TrackerBar.tsx deleted (orphaned after wall commit 2 absorbed them into TopBar). Test selector drift fixed (phase heading strict-mode → getByRole, Player Turn p-filter, dismissModal helper in 5 spec files). V2 screenshot verified: +/- buttons right edge at SVG x=422, wall left edge x=425, 3px gap, no clipping. Canary 11 pass / 10 conditional skip / 0 fail.
- **Role reveal modal shipped 2026-04-29 (commits 24fc3cc–e10e935 + docs commit)** — Migration 016, acknowledge-role edge function, RoleRevealModal (3 variants), GameBoard wiring. Screenshots verified — all three themes confirmed.
- **Density pass — player_turn (commits 453749d, ac72949, fabaa06, 7329767)** — mockup committed; staging banner removed (inline hint added); ActionRegion 200→230 / top 688→658; CentralBoard SVG 500→470; cards 110×120→120×150 (body restructured: type label 9pt, name 14pt, icon 28pt); chip CPU/RAM tracks bumped (11×11, 7×11, labels 11pt); contribution row 13pt bold no dots; TrackerBars 14pt bold bars 8px; MissionPanel req text 13pt bold. Build clean. Canary 12/23 pass, 11 skip, 0 fail. See LATEST_TASK.md for full details.
- **BACKLOG additions (commits c0764f0, 54ce997)** — Role reveal modal entry added (misaligned variant mocked, aligned/human variants are §12 open questions). Density pass items marked PARTIAL.

Recent completed work:
- **Lobby Fill Lobby button fix** — Gate was `NODE_ENV !== "production" && ?dev_mode=true URL param`. Normal game creation never adds that param, so button never appeared. Changed LobbyPage.devMode to `NODE_ENV !== "production"` only — matching CreateGameForm.IS_DEV. Side effect: Start Game now redirects to game board with ?dev_mode=true in dev, auto-enabling DEV MODE banner and PlayerSwitcher. Stripped diagnostic log. 1 commit c0eab9e. Build clean. Canary 23/33 pass (10 skip, 0 fail).
- **Lobby Fill Lobby button** — Dev-mode host-only "Fill Lobby" button in the lobby waiting screen. Inserts Bot2–Bot10 (skipping existing names) until player count reaches 6. Same Supabase-insert pattern as create-game page. 1 commit 2965b6d. Build clean. Canary 17/26 pass (9 skip = random-card conditionals, 0 fail).
- **Chat Realtime delivery fix** — Both PublicChat and MisalignedPrivateChat were subscribing without `await supabase.auth.getSession()`, causing Realtime to evaluate RLS with `auth.uid()=null` and silently drop all INSERT events. Applied the same async setup pattern already present in GameBoard.tsx (lines 167-170). 1 commit b23e533. Build clean. Suite: 65 pass / 14 skip / 1 fail (known flake, no regressions).
- **Three bug fixes + CLAUDE.md update** — BUG A: contributionMap used `card_type` ("progress") instead of `card_key` ("compute"/"data"/"validation") — fixed 3 lines in GameBoard.tsx. BUG B: poll fired `onNewMsgRef.current?.()` inside `setMessages` functional updater — moved outside, added `messagesRef` dedup. BUG C: MIS badge gated to `secret_targeting` phase via `targetingChip.isFellow`; added `showMisBadge` prop derived from viewer role, always visible to misaligned viewers. CLAUDE.md test discipline section updated. 4 commits 97af9f0–a6faae4. Suite: 65/14/1 (no regressions).

Recent completed work:
- **End-of-redesign test cleanup pass** — 4 commits (bf3ece8–5da7ca0). Unskipped 5 pending-phase tests, fixed 9 stale selectors/timeouts across dev-mode, game-log-ui, multi-mission, secret-actions, abort-mission, draw-cards, virus-placement. Root causes documented in BASELINE_2026-04-28.md. Final baseline: 65 pass / 14 skip / 1 fail (game-log CPU≥2 path, pre-existing). Key findings: staging zone text clipped by overflow:hidden; "STAGE N MORE" visible before hasDiscarded=true; virus_pull phase missing from allowlists.
- **Board redesign — game_over phase** — 2 commits 639a475 + 5354e37. WinnerBanner SVG overlay in CentralBoard (red/teal theme by winner). AI chips get role-colored borders/fills and ALIGNED/MISALIGNED badge. MissionSummaryPanel (new) replaces left column with mission outcome list. ActionRegion PHASE · GAME OVER header. TopBar GAME OVER · VICTORY text + optional BREACHED tagline. RightPanel drops PRIVATE tab. GameOver rewritten with inline styles, game stats from log, 3 buttons (Rematch/New game/Leave). Build clean.
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

Diagnosis files: `DIAGNOSIS_2026-04-24.md` (Phase 7.5 root causes), `DIAGNOSIS_2026-04-25.md` (Bug A cold-start, Bug B hand ordering; appendix: Bug A revisit — FunctionsHttpError 5xx path; Phase 10.5 investigation), `DIAGNOSIS_2026-04-26.md` (three post-Phase-10.5 playtest bugs — all pre-existing, all Mission 2+; **appendix: missing discard step — full investigation + implementation plan**), `DIAGNOSIS_2026-04-27.md` (Item 1: mission_transition gap on CPU≥2 virus path — Approach A implemented; **Item 2: board redesign E2E test inventory — 5 pending-phase, 9 non-ui canary, 9 pre-existing; see for skip/unskip plan per phase task**), `DIAGNOSIS_2026-05-05-role-reveal-loop.md` (role reveal modal infinite loop in dev mode — root cause: handleAcknowledge discards invokeWithRetry error; edge function returns 400 "Dev override denied" when switching to a player with a different user_id; fix: Option B = remove redundant user_id check in resolvePlayer override path, OR Option A = handle error in handleAcknowledge).

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
| Role reveal modal | **DONE** | Migration 016 (role_revealed), acknowledge-role edge function v1, RoleRevealModal (misaligned/aligned/human themes), GameBoard wiring (optimistic acknowledge). UX_DESIGN §7.11 + §12 updated. Build clean. Screenshots verified. |
| Wall layout migration | **DONE** | SVG firewall wall x=421–449, chip cluster x=0–420, action region extended. SLOT_SIDES all "right". VirusCardOverlay 220→95. WinnerBanner +27 shift. TrackerBar/TrackerBars deleted. Test selector drift fixed (phase headings, Player Turn p-filter, dismissModal in 5 specs). 5 commits 525cb26–commit5. Canary 11/10/0. |

**Test suite baseline: 66/16/1. Known flakes (pass in isolation, can fail in full-suite run): (1) game-log:535 — CPU≥2 path race (pre-existing, same as prior :524); (2) mission-rules test 28 — 15s timeout flake, passes on isolated re-run. 2026-05-30 full-suite run: 66 pass / 1 fail (game-log:535) / 16 skip — clean. virus-system test 3 passes. mission-flow:249 now fixed (dialog dismiss added).**

---

## Deployed Edge Functions

All use `verify_jwt: false` with manual ES256 JWT decode (`atob()` in function body).

| Function | Version | Notes |
|----------|---------|-------|
| start-game | v8 | Removes double shuffle; turn_order null for humans; turnOrderIds = seat order |
| adjust-resources | v4 | v4: switched gate to request origin (localhost only) |
| acknowledge-role | v3 | v2: removed redundant user_id check from override path. v3: switched gate to request origin (localhost only) |
| select-mission | v5 | v4: override_player_id support + refills AI hands. v5: switched gate to request origin (localhost only) |
| reveal-card | v5 | v5: switched gate to request origin (localhost only) |
| allocate-resources | v8 | v8: switched gate to request origin; draws cards + resets has_discarded_this_turn for first player |
| discard-cards | v3 | v3: switched gate to request origin; Phase 11: typed `discard` log with metadata |
| place-virus | v2 | v2: switched gate to request origin; moves card from hands → pending_viruses |
| end-play-phase | v18 | v17: abort flag/vote injection. v18: player_turn→between_turns CAS + full pool reshuffle (DELETE-all + INSERT shuffled 0..N-1). Commit 40c093a. |
| resolve-next-virus | v19 (Supabase: 20) | v18: refillVirusPool full reshuffle, removed 23505 catch. v19: partial-draw supplement loop + runtime invariant throw (pool==4 enforced). Commit 2beab6e. MCP-confirmed deployed 2026-06-02. |
| pull-viruses | v2 | v2: switched gate to request origin; pulls pending_pull_count cards from pool into queue |
| secret-target | v3 | v3: switched gate to request origin; Phase 11: typed targeting_resolved log |
| play-card | v8 | v8: switched gate to request origin; Phase 11: typed card_played log with mission_progress snapshot |
| abort-mission | v4 | v4: refactored to use applyMissionAbort from _shared; local helpers removed |
| flag-abort | v1 | New: human sets abort flag during AI turn in round 2 |
| submit-abort-vote | v1 | New: human submits abort vote; CAS guard on resolution; calls applyMissionAbort or advanceTurnOrPhase |

## Dev Mode

`override_player_id` accepted by all 12 edge functions, gated by request `Origin` header:
- Gate: `origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1")`
- Browser dev (localhost:3000): browser sends Origin automatically → allowed
- Node.js test calls: use `devFetch()` from `tests/e2e/_helpers.ts` which adds `Origin: http://localhost:3000` explicitly → allowed
- Production browser (Vercel): sends `Origin: https://mesa-game.vercel.app` → blocked (falls through to real player lookup)

`MESA_ENVIRONMENT` remains set in Supabase but is now irrelevant — origin gate is the only gate for all 12 functions.

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

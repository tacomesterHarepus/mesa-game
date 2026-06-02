# Latest Task

## Summary
Fixed virus pool drift bug (DIAGNOSIS_2026-06-02): `refillVirusPool` in resolve-next-virus was silently producing pool=3 instead of 4 when `drawFromDeck` returned a partial result (1 card when 2 were needed). The old guard only handled the zero-draw case; any partial return was silently accepted. Three-part fix: (1) runtime invariant throw after pool INSERT — catches any under-fill regardless of mechanism; (2) supplement loop — if first draw is short, reshuffle discards and draw the remaining deficit; (3) two new E2E tests asserting pool==4 after every settled turn across 12 turns, covering 1-virus, 2-virus, and deck-depletion paths. Deployed as resolve-next-virus v19.

## Files changed
- `supabase/functions/resolve-next-virus/index.ts` (commit 2beab6e) — refillVirusPool: replaced zero-only guard with `drawCards.length < needed` supplement loop; added runtime invariant throw (`pool != 4` → throws with diagnostic context).
- `tests/e2e/virus-system.spec.ts` (commit 2beab6e) — new describe block "pool invariant — pool equals 4 after every settled virus resolution" with 2 tests + 3 helper functions (resolveVirusQueueFully, queryPoolCount, waitForSettledPhase).
- `DIAGNOSIS_2026-06-02-virus-pool-drift.md` (commit 2beab6e) — diagnosis closed; verification pass results appended.
- `playwright.port3006.config.ts` (commit 2beab6e) — Playwright config for port 3006 (needed after stale .next cache broke port 3005 during this session).

## Test status
Full suite (port 3006, clean server): **51 pass / 6 fail / 14 skip / 18 did not run** (16.7 min)
All 6 failures pre-existing: card-reveal:132, mission-flow:215, virus-placement:151 (DevQueueInspector overlay blocks UI clicks), game-log:284 (Card Reveal heading timeout), game-log:535 (CPU≥2 flake).
Pool-invariant tests (virus-system:404/439): failed before v19 deploy (correctly caught pool=3), passed after v19 deploy (verified by targeted virus-system.spec.ts run).

## Suggested next
Migrations 018 and 019 already applied to prod (confirmed 2026-06-01 via MCP). Pool drift fix deployed: MCP confirmed Supabase internal version 20, both supplement loop and invariant throw live. Manual verification still open: abort-vote flow end-to-end, targeting cross-browser, full clean round. Any future pool under-fill will surface as a logged 400 from resolve-next-virus (invariant throw). Decide whether to keep or .gitignore the untracked Playwright config files (playwright.noserver.config.ts, playwright.test3002.config.ts, playwright.port3006.config.ts) — used in canary runs but not in source control.

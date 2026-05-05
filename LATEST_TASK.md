# Latest Task

## Summary
Rolled out origin-only gate to all 12 edge functions (replacing MESA_ENVIRONMENT gate in 10 of them) and added a `devFetch()` helper in `tests/e2e/_helpers.ts` so Node.js test calls explicitly send `Origin: http://localhost:3000`. Two failed approaches preceded the final fix: DENO_DEPLOYMENT_ID (IS set in hosted Supabase — same problem as MESA_ENVIRONMENT), and SUPABASE_URL local detection (Docker runtime exposes `http://kong:8000` not `http://127.0.0.1:54321`, and tests call hosted Supabase directly anyway). The correct fix uses the HTTP Origin header as the only gate — it's the one signal that meaningfully differs between dev and production callers regardless of which Supabase runtime is serving requests. Canary: 11/10/0. Prod smoke test verified both directions.

## Files changed
- `supabase/functions/reveal-card/index.ts` — origin gate; `req` threaded into resolvePlayer
- `supabase/functions/play-card/index.ts` — origin gate; `req` threaded into resolvePlayer
- `supabase/functions/end-play-phase/index.ts` — origin gate; `req` threaded into resolvePlayer
- `supabase/functions/abort-mission/index.ts` — origin gate; `req` threaded into resolvePlayer
- `supabase/functions/adjust-resources/index.ts` — origin gate; `req` threaded into resolvePlayer
- `supabase/functions/allocate-resources/index.ts` — origin gate; `req` threaded into resolvePlayer
- `supabase/functions/discard-cards/index.ts` — origin gate; `req` threaded into resolvePlayer
- `supabase/functions/place-virus/index.ts` — origin gate; `req` threaded into resolvePlayer
- `supabase/functions/pull-viruses/index.ts` — origin gate; `req` threaded into resolvePlayer
- `supabase/functions/secret-target/index.ts` — origin gate; `req` threaded into resolvePlayer
- `supabase/functions/acknowledge-role/index.ts` — already on origin gate (v3); no change this task
- `supabase/functions/select-mission/index.ts` — already on origin gate (v5); no change this task
- `tests/e2e/_helpers.ts` — new file: `devFetch()` wraps Node.js fetch to add `Origin: http://localhost:3000`
- `tests/e2e/turn-order.spec.ts` — function calls → devFetch
- `tests/e2e/multi-mission.spec.ts` — function calls → devFetch
- `tests/e2e/abort-mission.spec.ts` — function calls → devFetch
- `tests/e2e/error-handling.spec.ts` — function calls → devFetch
- `tests/e2e/mission-rules.spec.ts` — function calls → devFetch
- `tests/e2e/virus-system.spec.ts` — function calls → devFetch
- `tests/e2e/card-reveal.spec.ts` — function calls → devFetch
- `tests/e2e/secret-actions.spec.ts` — function calls → devFetch
- `tests/e2e/hand-stability.spec.ts` — function calls → devFetch
- `tests/e2e/draw-cards.spec.ts` — function calls → devFetch
- `tests/e2e/discard.spec.ts` — function calls → devFetch
- `tests/e2e/game-log.spec.ts` — function calls → devFetch
- `tests/e2e/game-log-ui.spec.ts` — function calls → devFetch
- `tests/e2e/virus-placement.spec.ts` — function calls → devFetch
- `DIAGNOSIS_2026-05-05-mesa-env-rollback.md` — corrected: documents both failed approaches + final fix in §5

## Test status
- `next build`: clean
- Canary: **11 pass / 10 conditional skip / 0 fail** (matches baseline)
- Prod smoke test: **pass** — `Origin: https://mesa-game.vercel.app` → "Player not found" (non-override path, blocked); `Origin: http://localhost:3000` → "Override player not found in game" (override path taken, allowed)

## Suggested next
User manually verifies role-reveal loop is fixed: fill lobby → start game → use PlayerSwitcher to switch to each AI → confirm role reveal modal dismisses permanently without looping. After that, the aligned/human role reveal modal polish (BACKLOG §12 — currently only misaligned variant is fully designed) is the natural follow-on. See UX_DESIGN.md §12 for open questions on those variants.

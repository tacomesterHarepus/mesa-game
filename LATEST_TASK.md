# Latest Task

## Summary
Git hygiene: reconciled master with prod-deployed code that had never been committed. end-play-phase v18 (CAS sentinel + full pool reshuffle on staging) was deployed to Supabase in the prior session but never committed. Migration 020 SQL (virus_pool added to supabase_realtime publication) was applied to prod but untracked. Both now on master. Also added a CLAUDE.md rule requiring any prod deploy to be committed in the same session, preventing this class of divergence going forward.

## Files changed
- `supabase/functions/end-play-phase/index.ts` (commit 40c093a) — v18: CAS player_turn→between_turns at function top; pending→pool logic replaced with DELETE-all + INSERT (survivors+pending) shuffled 0..N-1; maxPoolRow query removed. Was deployed, never committed.
- `supabase/migrations/020_virus_pool_realtime.sql` (commit 40c093a) — new file: ALTER PUBLICATION supabase_realtime ADD TABLE virus_pool. Was applied to prod, never tracked.
- `CLAUDE.md` (commit 5dc5c39) — new rule in Task completion ritual: any prod deploy must be committed in the same session; never record code as committed without confirming via git status/log.
- `SESSION_NOTES.md` / `LATEST_TASK.md` (this commit) — pool shuffle fix status updated to CLOSED with all four commit hashes; edge function table corrected; PENDING ACTIONS pruned.

## Test status
- `next build` clean (only floor required — git hygiene commit, no code logic changed)
- No suite run needed

## Suggested next
Apply migrations 018 and 019 to prod: 018 brings the abort-vote mechanic fully live; 019 brings the Race 1 per-card CAS claim live. Both are written, tested, and on master. See SESSION_NOTES PENDING ACTIONS. After that: manual verification (abort-vote flow, targeting cross-browser, full clean round). Decide whether to commit `playwright.noserver.config.ts` and `playwright.test3002.config.ts` — these are real project Playwright configs used in canary runs, currently untracked.

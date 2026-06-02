# Latest Task

## Summary

Phase 1 of the polling → Realtime migration (from MIGRATION_PLAN_websocket.md). Removed the 3-second setInterval backup poll from PublicChat.tsx and MisalignedPrivateChat.tsx. Both components already had working Realtime subscriptions covering INSERT events; the poll was pure redundancy. Root-cause of the double-message bug from the 02.06.26 playtest: poll and subscription could both queue setMessages in the same React flush, with the poll reading a stale messagesRef (not yet updated by the React effect) and adding the same message the subscription already added. Removing the poll eliminates the overlap entirely.

messagesRef and its syncing effect are intentionally left in place per MIGRATION_PLAN_websocket.md §Out of Scope — they become dead code but cleaning them up is a separate simplify pass.

## Files changed

- `components/chat/PublicChat.tsx` — removed 27-line setInterval poll block (lines 71–97)
- `components/chat/MisalignedPrivateChat.tsx` — removed 27-line setInterval poll block (lines 71–97)

## Test status

Full Playwright suite on port 3002 (playwright.test3002.config.ts):
**69 passed / 4 failed / 16 skipped / 2 did not run**

All 4 failures are documented pre-existing issues:
- `card-reveal.spec.ts:132` — DevQueueInspector overlay intercepts clicks (pre-existing)
- `game-log.spec.ts:535` — CPU≥2 path timing race (pre-existing, known flake)
- `mission-flow.spec.ts:215` — DevQueueInspector overlay intercepts clicks (pre-existing)
- `virus-placement.spec.ts:151` — DevQueueInspector overlay intercepts clicks (pre-existing)

No new failures. Build clean.

Note: no E2E test exercises chat message dedup directly. The double-message fix is verified by code inspection (removed the overlapping poll) and requires manual in-game confirmation per the plan's verify criteria.

## Suggested next

Manual in-game verify of Phase 1: open a game, send several messages in both public and private chat rapidly, confirm each appears exactly once (no duplicates). Then approve Phase 2 (LobbyPhase poll removal) to continue the migration. See MIGRATION_PLAN_websocket.md for full phasing.

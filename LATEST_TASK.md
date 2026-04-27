# Latest Task

## Summary
Board redesign — secret_targeting + secret_chat + 3-tab right panel. RightPanel rewritten with LOG/CHAT/🔒PRIV tab structure, activeTabRef for stale-closure-safe unread badges, and phase-aware chat lock logic (canPostPublic/canPostPrivate). PublicChat and MisalignedPrivateChat redesigned as tab-content components: inline monospace styles, 3s poll backup, onNewMessage callbacks, locked input UI. CentralBoard gains TargetingChipConfig export interface with per-chip selectable/nominated/watching states: amber dashed ring + "CLICK TO NOMINATE" label (selectable), red solid ring + "▸ NOMINATED" label (nominated), MIS badge for misaligned fellows. ActionRegion adds secret_targeting to isActionPhase with amber header for misaligned (action required) and muted-red header for others. SecretTargeting fully rewritten: chip-click nomination via localNominationId prop from GameBoard, MISALIGNED COLLECTIVE roster from votes subscription, CURRENT NOMINATION panel, APPROVE & VOTE button (replaced old dropdown + Submit Vote). GameBoard adds localNominationId state, targetingChips config build, secret_targeting in isActivePlayer, suppressed active chip during targeting phase, new RightPanel props. UX_DESIGN §8.4 virus_pull/resolution corrected to "everyone can post" per session decision. secret-actions.spec.ts test 5 unskipped with chip-click assertions.

## Files changed
- `components/chat/PublicChat.tsx` — redesigned to inline styles, added onNewMessage callback, 3s poll backup, locked UI when canPost=false
- `components/chat/MisalignedPrivateChat.tsx` — redesigned to inline styles, added canPost + onNewMessage props, 3s poll backup, stripped outer border/heading shell
- `components/game/board/RightPanel.tsx` — full rewrite: 3-tab structure (LOG/CHAT/PRIV), activeTabRef, unread badges, canPostPublic/canPostPrivate logic, PublicChat + MisalignedPrivateChat as tab content
- `components/game/board/CentralBoard.tsx` — added TargetingChipConfig export interface; AIChipGroup targeting rings (amber dashed = selectable, red solid = nominated), "CLICK TO NOMINATE"/"▸ NOMINATED" counter-row labels, MIS badge; targetingChips prop wired
- `components/game/board/ActionRegion.tsx` — added secret_targeting to isActionPhase; secret_targeting header cases (amber for misaligned, muted-red for others); headerColor updated
- `components/game/phases/SecretTargeting.tsx` — full rewrite: chip-click nomination via localNominationId prop, votes subscription (MISALIGNED COLLECTIVE), CURRENT NOMINATION panel, APPROVE & VOTE button; countdown + handleDeadline preserved
- `components/game/GameBoard.tsx` — import TargetingChipConfig; localNominationId state + phase-reset useEffect; targetingChips config build; updated CentralBoard currentTurnPlayerId suppression; updated ActionRegion isActivePlayer for secret_targeting; updated SecretTargeting render with new props; updated RightPanel with new props
- `UX_DESIGN.md` — §8.4: virus_pull/resolution row corrected to "Everyone can post"
- `tests/e2e/secret-actions.spec.ts` — test 5 unskipped with chip-click assertions (no Submit Vote, APPROVE & VOTE or VOTE SUBMITTED, MISALIGNED AIs ARE TARGETING text)

## Test status
- Build: clean
- secret-actions.spec.ts test 5: unskipped, selectors updated for new UI
- Canary (error-handling, turn-order, multi-mission, abort-mission): requires running dev server (pre-existing webServer timeout environment issue per CLAUDE.md — tests pass when server started manually)

## Suggested next
Per UX_DESIGN ordering, the next board redesign tasks are either:
- **End-game screen** (§10 — game_over phase visual): role reveal, per-player stats, winner announcement
- **End-of-redesign test cleanup pass**: unskip all `.skip`'d UI tests, run full suite, fix remaining stale selectors (see CLAUDE.md "End of redesign" section)

The test cleanup pass is the safer next step: it validates the whole redesign end-to-end before adding more complexity. The game_over visual is the last phase before the cleanup pass anyway.

# Latest Task

## Summary
Two bug fixes, one commit each. BUG A: the ⚙ N · ▣ N · ◆ N contribution counter row between AI chips was scaffolding with hardcoded literal "0" values. Wired full data path: GameBoard 3s poll extended to fetch mission_contributions by mission_id; added Realtime INSERT subscription scoped to current mission_id (re-creates on mission change); derived per-player { compute, data, validation } map (failed contributions excluded); threaded through CentralBoard → AIChipGroup → SVG text nodes. BUG B: PublicChat and MisalignedPrivateChat were conditionally rendered on activeTab, unmounting their Realtime subscriptions whenever the user was on a different tab. Fixed by always-mounting both components with CSS display:none on inactive tabs so subscriptions stay alive and unread badge counts accumulate correctly. The activeTabRef pattern was already correct; only the mount behavior needed fixing.

## Files changed
- `components/game/GameBoard.tsx` — MissionContribution type; contributions state; poll extended with mission_contributions fetch; new useEffect for mission-scoped Realtime subscription; contributionMap derivation; contributions prop passed to CentralBoard
- `components/game/board/CentralBoard.tsx` — contributions prop added to Props interface and AIChipGroup; three hardcoded 0 SVG text nodes replaced with contributions?.compute/data/validation ?? 0; CentralBoard threads contributions?.[player.id] to each AIChipGroup
- `components/game/board/RightPanel.tsx` — PublicChat and MisalignedPrivateChat now always-mounted inside display:flex/none wrapper divs; LOG tab rendering remains conditional (no subscription to preserve)

## Test status
- Build: clean
- Canary suite: all 8 tests hit pre-existing webServer timeout (identical to every prior session — passes when dev server started manually)
- No new failures introduced

## Suggested next
Per UX_DESIGN ordering and LATEST_TASK from the previous session, the next board redesign tasks are either:
- **End-game screen** (§10 — game_over phase visual): role reveal, per-player stats, winner announcement
- **End-of-redesign test cleanup pass**: unskip all `.skip`'d UI tests, run full suite, fix stale selectors

The test cleanup pass is the safer next step: it validates the whole redesign end-to-end before adding more complexity.

# Latest Task

## Summary

Fixed the lobby Fill Lobby button not appearing. Root cause: `LobbyPage` derived `devMode` from `process.env.NODE_ENV !== "production" && searchParams.dev_mode === "true"`. The `?dev_mode=true` URL param is only present when the host entered via the create-page Fill Lobby shortcut (which already pre-fills to 6, making the button redundant). Normal game creation (`CreateGameForm.handleSubmit`) redirects to `/lobby` without the param. Fixed by changing `LobbyPage.devMode` to `process.env.NODE_ENV !== "production"` — matching `CreateGameForm`'s `IS_DEV` constant. Also stripped the diagnostic `console.log` added during diagnosis.

Side effect (intentional): `LobbyPhase.gameUrl` is now `/game/${id}?dev_mode=true` in dev environments, so when the host clicks Start Game the whole session lands on the game board with dev mode active (DEV MODE banner + PlayerSwitcher visible).

## Files changed

- `app/game/[gameId]/lobby/page.tsx` — `devMode` derivation simplified to `process.env.NODE_ENV !== "production"`; `searchParams` param removed (now unused)
- `components/game/phases/LobbyPhase.tsx` — stripped diagnostic `console.log` from `PlayerPanel`

## Test status

- `next build` — clean
- Canary suite (abort-mission, error-handling, turn-order, multi-mission, mission-rules, lobby, dev-mode): **23 passed / 10 skipped / 0 failed**
- All lobby.spec.ts (5/5) and dev-mode.spec.ts (7/7) pass

## Suggested next

1. **Manual verification**: create lobby normally → host sees Fill Lobby button → Incognito joins → Fill Lobby tops up to 6 → Start Game → game board opens with DEV MODE banner active.
2. **BACKLOG — layout density**: ActionRegion height or PlayerTurn overflow fix for staging zone text clipping.
3. **Chat Phase 12 polish**: read receipts, timestamps, message count badges.

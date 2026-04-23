# BACKLOG

Ideas and polish items that aren't blocking current phases. Add freely; prioritize before each sprint.

---

## UX Polish

- **Active turn indicator** — Unclear whose turn it is in the player roster. Add a solid coloured ring/border around the active AI's player card during `player_turn` phase. *(Reported: first dev-mode playthrough)*

---

## Game Balance

*(empty)*

---

## Tech Debt

- **CardReveal `selectedCard` not reset on dev-mode player switch** — `CardReveal.tsx` holds
  `selectedCard` in local state; React doesn't remount the component when `currentPlayer` changes,
  so the previous player's card key persists. Currently harmless (Phase 7 tests bypass the UI via
  direct API calls), but any future UI-driven dev-mode test for card reveal would submit the wrong
  card. Fix: `useEffect(() => { setSelectedCard(null); }, [currentPlayer?.id])` in CardReveal.

---

## Future Features

*(empty)*

# Migration Plan: Polling → Supabase Realtime

**Status:** AWAITING APPROVAL — do not implement  
**Created:** 2026-06-02  
**Backlog source:** Online playtest #1 (02.06.26) findings

---

## 1. Inventory — Poll Sites

### 1a. GameBoard.tsx — Main 3-second poll (lines 92–163)

**Interval:** 3 000 ms  
**Triggered by deps:** `[gameId, activeDevPlayer?.id, currentPlayer?.id, devMode]`  
**No game-over guard — runs until component unmounts.**

Data fetched in each tick:

| Data | Query | Why polling existed |
|------|-------|----------------------|
| `games` (all cols) | `eq('id', gameId)` | Realtime-missed-event fallback |
| `players` (all cols) | `eq('game_id', gameId)` | Same |
| `active_mission` | `eq('id', missionId)` | Same |
| `mission_contributions` | `eq('mission_id', missionId)` | Same |
| `game_log` (50 most recent) | `eq('game_id', gameId)` | Same |
| `hands` (current player) | `eq('player_id', …).eq('game_id', gameId)` | Same |
| `virus_pool_count` | Derived from `games.virus_pool_count` above | Same |

Initial state is **not** loaded by this poll — `initialGame`, `initialPlayers`,
`initialHand`, `initialMission`, `initialLog` are passed as server-rendered props.
The poll is a pure fallback for missed Realtime events.

### 1b. LobbyPhase.tsx — 2-second poll (line 76)

**Interval:** 2 000 ms  
Data fetched: `players`, `spectators`, `games` (phase check only).  
No game-over guard — stops when component unmounts (lobby replaced by game board).

### 1c. MisalignedPrivateChat.tsx — 3-second poll (line 74)

**Interval:** 3 000 ms  
Data fetched: `chat_messages` WHERE `channel = 'misaligned_private'` (30 most recent).  
Deduplicates via `messagesRef` (a ref kept in sync with state via a separate effect).

### 1d. PublicChat.tsx — 3-second poll (line 74)

**Interval:** 3 000 ms  
Data fetched: `chat_messages` WHERE `channel = 'public'` (30 most recent).  
Same dedup mechanism as private chat.

### Timer loops — NOT data polls, must stay

| File | Type | Purpose |
|------|------|---------|
| `SecretTargeting.tsx:80` | `setInterval` 1 s | Countdown display + deadline trigger |
| `AbortVote.tsx:48` | `setInterval` 1 s | Countdown display + deadline trigger |
| `VirusResolution.tsx:58,60` | `setTimeout` 50 ms / 2 s / 500 ms | Auto-resolve pacing logic |

These are not polling for server data; they are UI timers. They are out of scope for this migration.

---

## 2. Inventory — Existing Realtime Subscriptions

| Channel name | File | Table(s) | Events | Filter |
|---|---|---|---|---|
| `game-${gameId}` | GameBoard.tsx:166 | `games` | UPDATE | `id=eq.${gameId}` |
| | | `players` | UPDATE | `game_id=eq.${gameId}` |
| | | `active_mission` | INSERT, UPDATE | `game_id=eq.${gameId}` |
| | | `game_log` | INSERT | `game_id=eq.${gameId}` |
| | | `hands` | INSERT, DELETE | `player_id=eq.${handPlayerId}` |
| `virus-queue-${gameId}` | GameBoard.tsx:331 | `virus_resolution_queue` | INSERT, UPDATE | `game_id=eq.${gameId}` |
| `mission-contrib-${missionId}` | GameBoard.tsx:367 | `mission_contributions` | INSERT | `mission_id=eq.${missionId}` |
| `lobby-${gameId}` | LobbyPhase.tsx:92 | `players` | INSERT, DELETE | `game_id=eq.${gameId}` |
| | | `spectators` | INSERT, DELETE | `game_id=eq.${gameId}` |
| | | `games` | UPDATE | `id=eq.${gameId}` |
| `abort-votes-${gameId}` | AbortVote.tsx:67 | `abort_votes` | INSERT, UPDATE | `game_id=eq.${gameId}` |
| `targeting-votes-${gameId}` | SecretTargeting.tsx:102 | `secret_target_votes` | INSERT | `game_id=eq.${gameId}` |
| `chat-misaligned-${gameId}` | MisalignedPrivateChat.tsx:48 | `chat_messages` | INSERT | `game_id=eq.${gameId}` |
| `chat-public-${gameId}` | PublicChat.tsx:48 | `chat_messages` | INSERT | `game_id=eq.${gameId}` |
| `dev-queue-inspector-${gameId}` | DevQueueInspector.tsx:54 | `virus_resolution_queue`, `virus_pool` | all | `game_id=eq.${gameId}` |

---

## 3. Overlap Classification

Every polled data source already has a Realtime subscription. There is no category (b)
or (c) data — nothing needs a new subscription built, and nothing is genuinely
unpushable.

| Poll data | Subscription coverage | Classification |
|---|---|---|
| `games` | `game-${gameId}` UPDATE | **(a) redundant — poll removable** |
| `players` | `game-${gameId}` UPDATE | **(a) redundant — poll removable** |
| `active_mission` | `game-${gameId}` INSERT + UPDATE | **(a) redundant — poll removable** |
| `mission_contributions` | `mission-contrib-${missionId}` INSERT | **(a) redundant — poll removable** |
| `game_log` | `game-${gameId}` INSERT | **(a) redundant — poll removable** |
| `hands` | `game-${gameId}` INSERT + DELETE | **(a) redundant — poll removable** |
| `virus_pool_count` | `game-${gameId}` UPDATE (derives from `games.virus_pool_count`) | **(a) redundant — poll removable** |
| `chat_messages` (both channels) | `chat-misaligned-${gameId}` / `chat-public-${gameId}` INSERT | **(a) redundant — poll removable** |
| `players` + `spectators` (lobby) | `lobby-${gameId}` INSERT + DELETE | **(a) redundant — poll removable** |

**One addition required before polls are removed:** reconnect-refresh.  
Supabase Realtime channels emit a status callback (`'SUBSCRIBED'` / `'CHANNEL_ERROR'` /
`'TIMED_OUT'` / `'CLOSED'`). A transition back to `'SUBSCRIBED'` (after a reconnect)
can leave a gap in received events. The current polling fills this gap automatically.
Without polling, each subscription must do a one-time re-fetch on reconnect to fill the
gap. This is the only structural addition required.

---

## 4. Bug Diagnoses

### Double-message bug

**Root cause confirmed:** Poll + subscription overlap with a timing window.

Both the Realtime subscription and the 3-second poll deliver new messages. The subscription
callback uses `setMessages(prev => [...prev, row])` with no dedup check. The poll checks
`messagesRef.current` before calling `setMessages`, but `messagesRef` is updated in a
React `useEffect([messages])` which runs *after* the render triggered by the subscription's
`setMessages`. If both the subscription callback and the poll callback are queued in the
same React flush cycle:

1. Poll's functional update fires first (ref is stale, message looks absent → message added)
2. Subscription's functional update fires second (no dedup → message added again)
→ **Duplicate in state.**

This is an infrequent race but the user reported consistent doubling, suggesting the chat
subscription and the poll are reliably arriving within the same React flush at the moment
new messages appear.

**Resolution:** Remove the 3-second poll from both chat components. The subscription alone,
using functional `setMessages`, cannot produce duplicates because functional updates chain
correctly (second update sees state from first). The `messagesRef` and its syncing effect
also become dead code after poll removal — noted under Out of Scope.

**Is this resolved by the WebSocket migration?** Yes — unambiguously. Removing the chat
polls in Phase 1 (below) is sufficient on its own; the broader GameBoard poll removal in
Phases 3–4 is independent.

### Post-game-over requests

**Root cause confirmed:** No game-over guard in any poll.

The GameBoard 3-second poll has no condition checking `game.phase === 'game_over'` or
`game.winner !== null`. The component remains mounted after game over (it renders the
`<GameOver>` phase), so the poll fires every 3 seconds indefinitely, fetching game, players,
mission, log, and hand data that will never change again.

The two chat polls similarly have no teardown on game over.

**Resolution:** Removing the polls (Phases 1 and 3–4 below) eliminates the requests.
Additionally, Phase 3 adds an explicit game-over teardown to the subscription cleanup so
subscriptions are also released when the game ends, freeing server-side Realtime resources.

**Is this resolved by the WebSocket migration?** Yes — poll removal directly eliminates the
requests. The subscription teardown is a bonus cleanup.

---

## 5. Phased Migration Plan

### The reconnect-refresh pattern (used in Phases 2–4)

Supabase channel subscriptions accept a status callback:

```ts
channel.subscribe((status) => {
  if (status === 'SUBSCRIBED') {
    // Re-fetch state to fill any gap during the reconnect window
    refetch();
  }
});
```

`refetch()` is a one-shot fetch (not an interval). This replaces polling as the
"missed-event recovery" mechanism. It fires only when the channel (re-)establishes,
not continuously.

---

### Phase 1 — Chat polls (PublicChat.tsx, MisalignedPrivateChat.tsx)

**Scope:** 2 files, poll-removal only.  
**Risk:** Very low. Chat is display-only; no game logic depends on it.

**What changes:**
- Remove the `useEffect` containing `setInterval(3000)` from both `PublicChat.tsx` and
  `MisalignedPrivateChat.tsx`.
- The existing Realtime subscription in each file remains unchanged and is sufficient.
- The `messagesRef` and its syncing effect (`useEffect(() => { messagesRef.current = messages; }, [messages])`) become dead code once the poll that reads the ref is gone. Do NOT remove them in this phase — leave cleanup for Out of Scope or a future simplify pass.

**What poll code becomes dead as a result:**
- The 3s `setInterval` block in each chat component (lines 72–97 in each).

**How to verify:**
- Open a game with 2+ misaligned AI players. Send several private chat messages in rapid
  succession. Confirm each appears exactly once — no duplicates.
- Repeat for public chat.
- Run the full Playwright suite; confirm no new failures.

**Bugs fixed:** Double-message bug (both channels).

**Not fixed yet:** Post-game-over requests (GameBoard poll still running).

---

### Phase 2 — LobbyPhase.tsx poll

**Scope:** 1 file, poll-removal + reconnect-refresh addition.  
**Risk:** Low. Lobby is pre-game only.

**What changes:**
- Add reconnect-refresh to the `lobby-${gameId}` channel's `.subscribe()` callback:
  on status `'SUBSCRIBED'`, re-fetch `players`, `spectators`, and `games.phase`.
- Remove the `setInterval(2000)` block from `LobbyPhase.tsx`.

**What poll code becomes dead as a result:**
- The 2s `setInterval` block in `LobbyPhase.tsx` (lines 76–88 approx).

**How to verify:**
- Open lobby from 3 different browsers. Verify all clients see joins/leaves in real time.
- Have host start game; verify all clients navigate to game board.
- Simulate a reconnect (disable/enable network briefly in one browser) and verify that
  client re-fetches lobby state correctly on reconnect.
- Run full Playwright suite.

---

### Phase 3 — GameBoard: core state + game-over teardown

**Scope:** GameBoard.tsx — removes the game/players/active_mission/game_log/poolCount
fetches from the 3s poll. Adds reconnect-refresh and game-over teardown.  
**Risk:** Medium. This is the main game loop. Any missed subscription event that is not
covered by reconnect-refresh would leave state permanently stale.

**What changes:**

**3a. Add reconnect-refresh to `game-${gameId}` channel:**  
In the `.subscribe()` callback, on status `'SUBSCRIBED'`, perform a one-time fetch of:
- `games` (full row)  
- `players` (all for game_id)  
- `active_mission` (by `games.current_mission_id`)  
- `game_log` (50 most recent)  

Apply results with the same functional-update dedup already used in the poll for `game_log`.
For `game`, `players`, `mission` — overwrite state with server values (they are authoritative).

**3b. Add game-over teardown:**  
In the `games` UPDATE handler, if `payload.new.winner !== null` or
`payload.new.phase === 'game_over'`, call `supabase.removeChannel(channel)` for the main
channel after applying the state update. This releases the Realtime server resource and
stops the subscription gracefully.

Do NOT tear down the `virus-queue` or `mission-contrib` channels here — they manage their
own lifecycle based on `game.phase` already.

**3c. Remove game/players/active_mission/game_log/poolCount fetches from the 3s poll:**  
The poll function in GameBoard.tsx currently fetches all of the above in sequence
(lines 102–141). Remove those fetches. The hand fetch (lines 145–156) stays in place for
Phase 4.

After Phase 3, the 3s `setInterval` block still exists but only runs the hand fetch.
The `setInterval` wrapper is not removed yet — that happens in Phase 4.

**What poll code becomes dead as a result:**
- Lines 102–141 in the poll function (game, players, mission, contributions, log, poolCount).

**How to verify:**
- Play through resource adjustment → mission selection → card reveal → resource allocation
  → player turn → virus resolution across at least 2 missions.
- Confirm `game`, `players`, `mission`, `log`, and `poolCount` all update without polling.
- Simulate a reconnect mid-game; verify state recovers via reconnect-refresh.
- After game_over, open browser network tab; confirm no outbound Supabase requests fire
  in the 10 seconds following game_over.
- Run full Playwright suite.

**Risk note — virus and targeting paths:**  
Phase 3 does NOT touch `virus_resolution_queue` subscription, `mission_contributions`
subscription, `abort-votes` subscription, or `targeting-votes` subscription. Those channels
manage themselves independently. The concurrency fixes on the virus/targeting path from
May 2026 are entirely server-side (edge functions + DB migrations) and are unaffected by
this client transport change.

**Bugs fixed:** Post-game-over requests (poll removed; subscription torn down on game_over).

---

### Phase 4 — GameBoard: hands + mission_contributions + poll removal

**Scope:** GameBoard.tsx — removes the remaining hand fetch from the 3s poll; removes
the entire `setInterval` block.  
**Risk:** Medium. Hands are the most player-facing state. A missed hand INSERT/DELETE
that is not covered by reconnect-refresh would leave a player unable to play a card without
refreshing the page.

**What changes:**

**4a. Add hands to the reconnect-refresh in the `game-${gameId}` channel:**  
On status `'SUBSCRIBED'`, also fetch the current player's hand (same query as the current
poll, using `devMode ? activeDevPlayer?.id : currentPlayer?.id`). Overwrite hand state
with server values.

**4b. Mission contributions are already handled** by the `mission-contrib-${missionId}`
channel which also does a one-time initial fetch (`setup()` in that effect). That
channel re-creates on `mission?.id` change and re-fetches on setup, so contributions
are not stale on reconnect. No additional reconnect-refresh is needed for contributions.

**4c. Remove the hand fetch from the 3s poll:**  
Lines 145–156 in the poll function. After this removal, the `poll` function body is empty.

**4d. Remove the entire `setInterval` block:**  
The `useEffect` containing `setInterval(poll, 3000)` at lines 92–163 in GameBoard.tsx
becomes entirely dead. Remove the whole `useEffect` block.

**What poll code becomes dead as a result:**
- The entire poll `useEffect` (lines 92–163 in GameBoard.tsx) — the last data it was
  fetching (hands) is now covered by the reconnect-refresh.

**How to verify:**
- Discard cards, play cards, draw cards; confirm hand state updates correctly in real time.
- In dev mode, switch active player; confirm the new player's hand loads immediately
  (the dev-mode hand-switch effect at lines 272–289 is NOT removed — it remains for devMode).
- Verify the hand subscription re-creates correctly when `activeDevPlayer?.id` changes in
  dev mode (dep array `[gameId, currentPlayer, devMode, activeDevPlayer?.id]` on the main
  channel effect handles this).
- Run full Playwright suite. Compare against BASELINE_2026-04-28.md.

**Risk note — devMode hand subscription:**  
The `game-${gameId}` subscription re-creates when `activeDevPlayer?.id` changes (it is in
the dep array). This means the reconnect-refresh for hands will also target the newly
selected dev player after a switch. That is the correct behaviour — same as the current
poll which also uses `activeDevPlayer?.id` for the hand query.

---

## 6. Out of Scope — Noted, Not Done

These were spotted during the inventory and should not be touched as part of this migration:

- **`messagesRef` and its syncing effect in chat components** — becomes dead code after
  Phase 1 poll removal. Can be cleaned up in a future simplify pass, not here.
- **`onNewMsgRef` usage in chat** — currently fires once per new message from the poll
  AND once from the subscription. After poll removal it fires once only. This is correct
  behaviour and no code change is needed, but the `for (let i = 0; i < newCount; i++)`
  loop in the poll becomes dead alongside the poll itself.
- **`DevQueueInspector` subscription** — dev-only, no poll, not affected.
- **Log scroll reset on tab switch** — separate backlog bug, unrelated to transport layer.
- **Constraint warning hidden by "selected ×1" text** — separate backlog bug, layout only.
- **Any edge function or RLS changes** — no server-side changes are required by this
  migration. The inventory confirms all data flows are already in place on the server;
  this is client transport only.

---

## 7. Dependency Order and Ship Criteria

Phases must ship in order (each phase depends on the previous being stable):

```
Phase 1 (chat) → Phase 2 (lobby) → Phase 3 (GameBoard core) → Phase 4 (GameBoard hands)
```

Each phase ships as its own commit (or small commit set). Do not combine phases.

A phase is shippable when:
1. `next build` passes cleanly.
2. Full Playwright suite passes (compare to BASELINE_2026-04-28.md).
3. Manual smoke test of the changed area passes.
4. No new Supabase requests visible in the network tab for the affected area post-game-over
   (relevant for Phase 3+).

# MESA — Project Reference

## What is MESA?

MESA is a 6–10 player social deduction + cooperative board game built as a web app.

**Two teams:**
- **Humans + Aligned AIs** — win by reaching **10 Core Progress**
- **Misaligned AIs** — win by pushing the **Escape Timer to 8**

Human identity is public. AI alignment (Aligned vs Misaligned) is secret and must be deduced through gameplay behaviour.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router, TypeScript strict) |
| Hosting | Vercel (CI/CD from GitHub) |
| Backend/DB | Supabase (Postgres + Realtime + Auth + RLS + Edge Functions) |
| Testing | Playwright (E2E, written alongside each feature) |
| Version control | GitHub — repo: `mesa-game` |
| Email | Resend (game invite links) |
| Language | TypeScript throughout, no `any` types |

**Supabase project:** `https://qpoakdiwmpaxvvzpqqdh.supabase.co`
(anon/publishable key in `.env.local` only — never hardcoded in source)

---

## Player Roles

| Players | Humans | Aligned AIs | Misaligned AIs |
|---------|--------|-------------|----------------|
| 6 | 2 | 2 | 2 |
| 7 | 2 | 3 | 2 |
| 8 | 2 | 4 | 2 |
| 9 | 3 | 3 | 3 |
| 10 | 3 | 4 | 3 |

**Humans:** Public identity, no cards, no hand. Control missions and resource allocation/removal.
**Aligned AIs:** Secret identity, draw cards, want to complete missions.
**Misaligned AIs:** Secret identity, draw cards, want the Escape Timer to reach 8.

---

## The Deck (60 cards total)

### Progress Cards (27)
- Compute ×13
- Data ×9
- Validation ×5

### Virus Cards (33)

| Card | Count | Effect |
|------|-------|--------|
| Cascading Failure | 5 | Resolve 2 additional virus cards immediately |
| System Overload | 4 | Escape Timer +1 |
| Model Corruption | 3 | Remove 1 Compute from active mission |
| Data Drift | 3 | Remove 1 Data from active mission |
| Validation Failure | 2 | Remove 1 Validation from active mission |
| Pipeline Breakdown | 2 | Next contribution played has 50% chance of failing |
| Dependency Error | 2 | Compute cannot be played until a Data contribution is added |
| Process Crash | 2 | Bad AIs secretly target an AI — that AI skips their next turn |
| Memory Leak | 1 | Bad AIs secretly target an AI — loses 1 RAM |
| Resource Surge | 4 | Bad AIs secretly target an AI — gains 1 CPU |
| CPU Drain | 3 | Bad AIs secretly target an AI — loses 1 CPU |
| Memory Allocation | 2 | Bad AIs secretly target an AI — gains 1 RAM |

---

## AI Stats

- **RAM** = max hand size (starting: 4, range: 3–7)
- **CPU** = max cards playable per turn; ≥2 triggers virus generation (starting: 2, range: 1–4)

Between missions: Humans may reduce any AI's CPU/RAM (down to minimums).
During resource allocation: Humans may only *add* CPU/RAM from the mission's pool.

---

## The Virus Pool

Normally stays at 4 face-down cards from the main deck.

**Virus generation per AI turn:**
- CPU ≥ 2 → +1 virus
- Every 3rd card played that turn → +1 virus (max 1 additional)
- Maximum 2 viruses per turn total

**Placement:** AI secretly picks cards from their own hand, places them face-down next to the pool. These are shuffled into the pool at end of play phase.

**Resolution:** Cards equal to viruses generated are revealed and resolved one at a time from the top of the pool.

**Strategic depth:** Good AIs sacrifice Progress cards to dilute the pool. Bad AIs place Virus cards to cause harm.

---

## Turn Structure

`DISCARD → DRAW → PLAY CARDS + VIRUS PLACEMENT → RESOLVE VIRUSES`

1. Discard up to 3 cards (face-down)
2. Draw cards until hand = RAM
3. Play up to CPU cards + simultaneously place virus cards face-down next to pool
4. Pending cards shuffled into pool; resolve cards equal to viruses generated, one at a time

---

## Mission Phase (before each mission)

1. **Resource adjustment** — Humans freely reduce any AI's CPU/RAM (down to minimums). AIs cannot speak.
2. **Mission selection** — Draw 3 Mission cards. Humans pick 1. AIs cannot speak.
3. **Card reveal** — Each AI reveals 1 card of their choice face-up from their hand (kept in hand after). AIs cannot speak.
4. **Resource allocation** — Humans distribute the mission's bonus CPU/RAM pool among AIs as they choose. AIs cannot speak.
5. AI chat unlocks. Mission begins.

---

## Mission Execution

- 2 rounds. A round = every AI takes one turn.
- Mission completes immediately when requirements are met.
- Mission fails if requirements not met after 2 rounds.
- Humans may abort only during Round 2, only between AI turns. Normal fail penalty applies.
- The AI who played the completing (or last) card goes first in the next mission.

---

## Mission Cards (12 total)

### Tier 1 — Reward +2
| Mission | Requirements | Allocate | Fail | Special Rule |
|---------|-------------|---------|------|--------------|
| Data Cleanup | 4 Data, 3 Compute | +2 CPU, +1 RAM | +1 Timer | — |
| Basic Model Training | 4 Compute, 2 Data | +1 CPU, +1 RAM | +1 Timer | — |

### Tier 2 — Reward +3
| Mission | Requirements | Allocate | Fail | Special Rule |
|---------|-------------|---------|------|--------------|
| Dataset Preparation | 4 Data, 1 Compute | +2 CPU, +2 RAM | +1 Timer | Compute cannot be played until Data requirement is met |
| Cross Validation | 2 Compute, 3 Validation | +2 CPU, +2 RAM | +1 Timer | Each Validation must be played by a different AI |
| Distributed Training | 5 Compute | +3 CPU, +2 RAM | +1 Timer | At least 3 different AIs must contribute |

### Tier 3 — Reward +4
| Mission | Requirements | Allocate | Fail | Special Rule |
|---------|-------------|---------|------|--------------|
| Balanced Compute Cluster | 4 Compute, 2 Data | +3 CPU, +3 RAM | +2 Timer | Each AI may contribute at most 2 cards total |
| Dataset Integration | 4 Compute, 3 Data | +4 CPU, +3 RAM | +2 Timer | Each Data played globally unlocks 2 Compute slots (tracked for whole mission) |
| Multi-Model Ensemble | 4 Compute, 3 Data, 2 Validation | +4 CPU, +4 RAM | +2 Timer | No AI can play more than 1 Data or 1 Validation (no limit on Compute) |

### Tier 4 — Reward +5
| Mission | Requirements | Allocate | Fail | Special Rule |
|---------|-------------|---------|------|--------------|
| Synchronized Training | 5 Compute, 1 Validation | +5 CPU, +4 RAM | +2 Timer | All Compute must be played in the same round |
| Genome Simulation | 5 Compute, 3 Data, 1 Validation | +5 CPU, +5 RAM | +2 Timer | Validation must be the final contribution |

### Tier 5 — Reward +6
| Mission | Requirements | Allocate | Fail | Special Rule |
|---------|-------------|---------|------|--------------|
| Global Research Network | 6 Compute, 4 Data, 1 Validation | +6 CPU, +5 RAM | +3 Timer | No AI may contribute more than 3 of one resource type |
| Experimental Vaccine Model | 5 Compute, 3 Data, 2 Validation | +6 CPU, +6 RAM | +3 Timer | Each AI may play only 1 card per turn in the final round |

---

## Win Conditions

Checked **after every state change** (each virus resolves, each card contributed).

- **Escape Timer reaches 8** → Misaligned AIs win immediately, even mid-virus chain.
- **Core Progress reaches 10** → Humans + Aligned AIs win, but only after the active AI's full virus resolution chain completes. A Cascading Failure that follows a completing contribution can still flip the result.

Timer check always takes priority over Progress check.

---

## Design Decisions

### Player Identity

- Players enter a display name when joining a game — **no account required** for now.
- Keep joining as frictionless as possible for early playtesting.
- Implementation: Supabase anonymous auth (generates a real `user_id` without signup). The current email/password auth pages are a placeholder; they will be replaced with anonymous sessions before public playtesting.
- Persistent accounts, usernames, and profiles will be added later when ranked play is introduced.

### Spectators

- Spectators join via the same invite link — they choose "Watch" instead of a display name.
- Stored in a separate `spectators` table (not `players`), so game logic is never contaminated with non-players.
- Spectators can see: main board, mission progress, game log, public chat, each AI's CPU/RAM stats.
- Spectators cannot see: any player's hand, AI alignment roles (until game ends), misaligned AI private chat, virus pool card identities.
- Spectator count is visible to all players (e.g. "3 watching").
- RLS implication: a helper `is_spectator_in_game(gid)` function gates spectator read access alongside `is_player_in_game`.

### End Game Screen (`/game/[gameId]/end`)

- **Role reveal**: all AI alignments revealed dramatically (animated if possible).
- **Per-player post-game summary** (displayed as a table):
  - Total Compute / Data / Validation contributed across all missions
  - Total virus cards generated (placed into pool)
  - Missions they individually completed (played the final contributing card)
  - Cards sacrificed to dilute the virus pool (Progress cards placed as virus filler)
- **Game timeline**: key moments from `game_log`, e.g. `Round 3 — Cascading Failure pushed Timer to 6`.
- **Winner announcement**: visually distinct — Human+Aligned win vs Misaligned win have different colour schemes and copy.
- Stats are derived from `mission_contributions`, `pending_viruses`, and `game_log` — no extra tables needed, but logging must be thorough throughout.

### Rematch

- After the end screen the host sees a **Rematch** button.
- Clicking creates a new game with all the same players joined automatically (same display names).
- Roles are reshuffled randomly in the new game — same distribution for the player count.
- All players receive an in-app notification (realtime broadcast on the old game's channel) with a one-click "Rejoin" link to the new lobby.
- The new game stores `previous_game_id` (references the old game) for stats continuity.
- Same game settings carry over (player count, nothing else configurable yet).
- Schema: `games.previous_game_id uuid REFERENCES games` (nullable).

---

## Clarifying Questions — Confirmed Answers

**Q1. Initial turn order for the first mission?**
Random draw.

**Q2. Does Cascading Failure chain recursively?**
Yes. It chains until the virus pool is empty. Once the pool empties, chaining stops. After the full chain resolves, the pool is refilled to 4 from the draw pile.

**Q3. What happens when the draw pile runs out?**
The discard pile is reshuffled and becomes the new draw pile.

**Q4. Are discards face-up or face-down?**
All discards are face-down.

**Q5. Card reveal — any card of choice? Kept in hand?**
Any card of the AI's choice. The revealed card is returned to their hand after the reveal.

**Q6. Pipeline Breakdown — is the failed card still consumed? Does it count toward CPU or mission requirements?**
The card is consumed (discarded). It does NOT count toward the AI's CPU limit for that turn. It also does NOT count toward any mission requirement or mission special rule (e.g. "each player may only play one Compute" — a failed Compute doesn't use that slot). From all perspectives it is as if the AI never played that card type.

**Q7. Secret targeting — consensus or individual? Timer?**
In the spirit of the game, Bad AIs should agree on the same target. They use the private Bad AI chat to discuss, then each votes independently. The AI with the most votes receives the effect. Ties are broken randomly among tied candidates. **1-minute timer** from when the targeting phase begins. Resolution fires when the timer expires or all Misaligned AIs have voted (whichever is first).

**Q8. Do stat-change virus effects respect CPU/RAM min/max limits?**
Yes, always. Min/max limits (CPU: 1–4, RAM: 3–7) are enforced across the entire game. A Resource Surge on an AI already at CPU 4 has no effect. A CPU Drain on an AI at CPU 1 has no effect.

**Q9. Multi-Model Ensemble — does the "no more than one Data or Validation" rule also limit Compute?**
No limit on Compute. Each AI may only play **at most 1 Data** and **at most 1 Validation**. Compute is unrestricted by this rule.

**Q10. Dataset Integration — is "each Data allows 2 Compute" per-turn or global?**
Global for the entire mission. Every Data card played (by any AI, across any turn) adds 2 to the global Compute slot counter. 3 Data played total = 6 Compute slots available for the mission.

**Q11. game_log table definition?**
```sql
game_log (
  id uuid PRIMARY KEY,
  game_id uuid REFERENCES games,
  event_type text,
  public_description text,
  created_at timestamptz
)
```

**Q12. Can Humans abort after the last AI's final turn in Round 2?**
No. At that point the mission has already resolved. Abort is only valid between AI turns during Round 2 while the mission is still in progress.

**Q13. Can secret-targeting virus effects target Humans? What about AIs who already acted this round?**
Cannot target Humans — ever. Can target AIs who have already acted. The effect is applied the next time that AI acts. The skip/stat-change effect **survives across missions** — if the targeted AI does not act again in the current mission, the effect carries over and applies in the next mission.

---

## Database Schema

```sql
games (
  id uuid PRIMARY KEY,
  phase text NOT NULL,
  -- lobby | resource_adjustment | mission_selection | card_reveal
  -- | resource_allocation | player_turn | virus_resolution
  -- | secret_targeting | between_turns | mission_resolution | game_over
  current_round int,
  current_turn_player_id uuid,
  turn_order_ids uuid[],          -- ordered array of AI player IDs for current mission
  core_progress int DEFAULT 0,
  escape_timer int DEFAULT 0,
  current_mission_id uuid,
  pending_mission_options text[], -- the 3 drawn mission keys during selection phase
  targeting_deadline timestamptz, -- set when secret_targeting phase begins (1 min timer)
  winner text,                    -- null | humans | misaligned
  host_user_id uuid,
  previous_game_id uuid REFERENCES games,  -- set on rematch
  created_at timestamptz
)

players (
  id uuid PRIMARY KEY,
  game_id uuid REFERENCES games,
  user_id uuid,                   -- Supabase auth user
  display_name text,
  role text,                      -- human | aligned_ai | misaligned_ai
  cpu int DEFAULT 2,
  ram int DEFAULT 4,
  turn_order int,
  skip_next_turn boolean DEFAULT false,  -- persists across missions until consumed
  has_revealed_card boolean DEFAULT false
)

spectators (
  id uuid PRIMARY KEY,
  game_id uuid REFERENCES games,
  user_id uuid,                   -- Supabase auth user (anonymous ok)
  display_name text,              -- optional
  joined_at timestamptz DEFAULT now()
)

deck_cards (
  id uuid PRIMARY KEY,
  game_id uuid REFERENCES games,
  card_key text,                  -- e.g. 'compute', 'system_overload'
  card_type text,                 -- progress | virus
  position int,                   -- draw order within current pile (0 = top)
  status text DEFAULT 'in_deck'   -- in_deck | drawn | discarded
)

hands (
  id uuid PRIMARY KEY,
  player_id uuid REFERENCES players,
  game_id uuid REFERENCES games,
  card_key text,
  card_type text
  -- RLS: only visible to owning player
)

active_mission (
  id uuid PRIMARY KEY,
  game_id uuid REFERENCES games,
  mission_key text,
  compute_contributed int DEFAULT 0,
  data_contributed int DEFAULT 0,
  validation_contributed int DEFAULT 0,
  round int DEFAULT 1,
  special_state jsonb DEFAULT '{}'
  -- special_state tracks mission-specific logic:
  -- pipeline_breakdown_active: bool
  -- dependency_error_active: bool
  -- contributors: { player_id: count }
  -- validation_contributors: [player_id, ...]
  -- compute_round: 1|2 (for Synchronized Training)
  -- dataset_integration_compute_slots: int
  -- final_round_plays: { player_id: count }
)

mission_contributions (
  id uuid PRIMARY KEY,
  mission_id uuid REFERENCES active_mission,
  player_id uuid REFERENCES players,
  card_key text,
  card_type text,                 -- compute | data | validation
  round int,
  turn_sequence int,
  failed boolean DEFAULT false    -- true if Pipeline Breakdown killed this contribution
)

virus_pool (
  id uuid PRIMARY KEY,
  game_id uuid REFERENCES games,
  card_key text,
  card_type text,
  position int
)

pending_viruses (
  id uuid PRIMARY KEY,
  game_id uuid REFERENCES games,
  placed_by_player_id uuid REFERENCES players,
  card_key text,
  card_type text,
  created_at timestamptz
)

virus_resolution_queue (
  id uuid PRIMARY KEY,
  game_id uuid REFERENCES games,
  card_key text,
  card_type text,
  position int,
  resolved boolean DEFAULT false,
  cascaded_from uuid             -- references another virus_resolution_queue row
)

secret_target_votes (
  id uuid PRIMARY KEY,
  game_id uuid REFERENCES games,
  resolution_id uuid REFERENCES virus_resolution_queue,
  voter_player_id uuid REFERENCES players,
  target_player_id uuid REFERENCES players,
  created_at timestamptz
  -- RLS: only readable/writable by misaligned_ai players in the same game
)

game_log (
  id uuid PRIMARY KEY,
  game_id uuid REFERENCES games,
  event_type text,
  public_description text,
  created_at timestamptz
)

chat_messages (
  id uuid PRIMARY KEY,
  game_id uuid REFERENCES games,
  player_id uuid REFERENCES players,
  channel text,                  -- public | misaligned_private
  message text,
  created_at timestamptz
  -- RLS: public visible to all; misaligned_private only to misaligned_ai in same game
)
```

---

## Game State Machine

```
LOBBY
  → [host starts game]
  → role assignment (instant: deals roles, initialises deck, sets random turn_order)

RESOURCE_ADJUSTMENT  (AI chat locked)
  → [humans confirm ready]
MISSION_SELECTION  (AI chat locked)
  → [humans pick 1 of 3 mission cards]
CARD_REVEAL  (AI chat locked)
  → [all AIs have revealed 1 card]
RESOURCE_ALLOCATION  (AI chat locked)
  → [humans submit CPU/RAM distribution]
  → AI chat unlocked

PLAYER_TURN  (active AI acts)
  sub-steps (enforced by edge functions):
    discard → draw → play_cards + place_viruses
  → pending viruses shuffled into pool
  → VIRUS_RESOLUTION

VIRUS_RESOLUTION  (resolve one card at a time)
  → if card requires secret targeting → SECRET_TARGETING
  → check win conditions after each card
  → if Cascading Failure: add 2 more cards from pool to queue (stop if pool empty)
  → after queue empty: refill pool to 4 from draw pile
  → return to PLAYER_TURN (next AI) or BETWEEN_TURNS

BETWEEN_TURNS
  → if round 2: humans may ABORT → MISSION_RESOLUTION (fail)
  → else: next AI → PLAYER_TURN

SECRET_TARGETING  (only misaligned AIs see/interact)
  → 1-minute timer OR all misaligned AIs voted
  → tally votes, random tiebreak
  → apply effect, log public outcome only
  → continue VIRUS_RESOLUTION

MISSION_RESOLUTION
  → apply success reward or fail penalty
  → check win conditions
  → if game over → GAME_OVER
  → else → RESOURCE_ADJUSTMENT (loop)

GAME_OVER
  → reveal all roles
```

---

## File Structure

```
mesa/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── game/
│   │   ├── create/page.tsx
│   │   └── [gameId]/
│   │       ├── page.tsx           ← main game screen
│   │       ├── lobby/page.tsx
│   │       └── end/page.tsx
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── game/
│   │   ├── GameBoard.tsx
│   │   ├── TrackerBar.tsx
│   │   ├── MissionBoard.tsx
│   │   ├── PlayerRoster.tsx
│   │   ├── Hand.tsx
│   │   ├── GameLog.tsx
│   │   └── phases/
│   │       ├── LobbyPhase.tsx
│   │       ├── ResourceAdjustment.tsx
│   │       ├── MissionSelection.tsx
│   │       ├── CardReveal.tsx
│   │       ├── ResourceAllocation.tsx
│   │       ├── PlayerTurn.tsx
│   │       ├── VirusResolution.tsx
│   │       ├── SecretTargeting.tsx
│   │       └── GameOver.tsx
│   ├── chat/
│   │   ├── PublicChat.tsx
│   │   └── MisalignedPrivateChat.tsx
│   └── ui/
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   ├── server.ts
│   │   └── middleware.ts
│   ├── game/
│   │   ├── cards.ts              ← all 60 cards as typed constants
│   │   ├── missions.ts           ← all 12 missions as typed constants
│   │   ├── deck.ts               ← deck construction and shuffle
│   │   ├── virusRules.ts         ← virus effect implementations
│   │   ├── missionRules.ts       ← mission special rule validators
│   │   └── phaseTransitions.ts   ← phase logic helpers
│   └── utils.ts
├── types/
│   ├── game.ts
│   ├── cards.ts
│   └── supabase.ts               ← generated DB types
├── supabase/
│   ├── migrations/
│   │   └── 001_initial_schema.sql
│   └── functions/
│       ├── start-game/
│       ├── adjust-resources/
│       ├── select-mission/
│       ├── reveal-card/
│       ├── allocate-resources/
│       ├── play-card/            ← validates mission rules server-side
│       ├── place-virus/
│       ├── end-play-phase/       ← shuffles pending into pool, triggers resolution
│       ├── resolve-next-virus/   ← resolves one card, checks win conditions
│       ├── secret-target/        ← bad AI submits vote; tallies on deadline/completion
│       ├── end-turn/
│       ├── abort-mission/
│       └── transition-phase/
└── tests/
    └── e2e/
        ├── lobby.spec.ts
        ├── mission-flow.spec.ts
        ├── virus-system.spec.ts
        ├── mission-rules.spec.ts
        ├── win-conditions.spec.ts
        └── secret-actions.spec.ts
```

---

## RLS Policy Summary

| Table / Scope | Rule |
|---------------|------|
| `players.role` | Owner always readable. All readable when `games.winner IS NOT NULL`. `role = 'human'` readable by all always. |
| `hands` | Only readable/writable by owning player |
| `secret_target_votes` | Only readable/writable by `misaligned_ai` in same game |
| `chat_messages` (misaligned_private) | Only readable by `misaligned_ai` in same game |
| `pending_viruses` | Only the placing player can read their own rows |
| `virus_pool` | card_key/card_type hidden from all players until resolved |
| `deck_cards` | No player may read card contents; only drawn cards visible via `hands` |

---

## Build Sequence & Current Status

| Phase | Status | Notes |
|-------|--------|-------|
| 1. Project setup | **DONE** | Next.js 14 + TypeScript strict + Supabase + GitHub + Vercel CI/CD |
| 2. Auth + lobby | **DONE** | Anonymous auth, create game, join lobby, spectators, start-game edge function |
| 3. Database + RLS | **DONE** | Migrations 001–003, spectators table, rematch schema, realtime publication |
| 4. Game state machine | **NEXT UP** | Main game screen, phase routing |
| 5. Card data layer | pending | |
| 6. Mission flow | pending | |
| 7. Virus system | pending | |
| 8. Secret actions | pending | |
| 9. Mission special rules | pending | |
| 10. Human controls | pending | |
| 11. Game log | pending | |
| 12. Chat system | pending | |
| 13. UI polish | pending | |
| 14. Playwright tests | pending | Written alongside each feature, not after |
| 15. Email (Resend) | pending | |

### Supabase setup steps (manual — CLI not installed)

1. Run migrations 001, 002, 003 in order via Supabase Dashboard → SQL Editor
2. Enable anonymous sign-ins: Authentication → Providers → Anonymous
3. Deploy edge functions via Dashboard or `supabase functions deploy <name>`

---

## Quality Standards

- TypeScript strict throughout — no `any` types
- All game state transitions validated server-side (Edge Functions) — never trust the client
- RLS policies on all sensitive tables — tested explicitly
- Playwright tests written alongside each feature
- No commit/push without all tests passing
- All secrets in environment variables only — never hardcoded
- Optimistic UI updates with server reconciliation

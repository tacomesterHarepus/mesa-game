# Phase 11 — game_log Metadata Schema

This file is the canonical source of truth for the `metadata` jsonb column on `game_log`.
Every edge function insert must conform. TypeScript types in `types/gameLog.ts` and
`supabase/functions/_shared/gameLogTypes.ts` are derived from this document.

---

## Supporting types

| Type | Values |
|------|--------|
| `CardType` | `"compute" \| "data" \| "validation" \| "virus"` |
| `MissionOutcome` | `"complete" \| "failed" \| "aborted"` |
| `LogWinner` | `"humans" \| "misaligned"` |
| `EndCause` | `"progress" \| "timer"` |
| `EffectType` | See virus effect table below |
| `TargetingEffect` | `"process_crash" \| "memory_leak" \| "resource_surge" \| "cpu_drain" \| "memory_allocation"` |

### EffectType values

| Value | Description |
|-------|-------------|
| `cascading_failure` | Adds 2 more cards from the pool to the resolution queue |
| `system_overload` | Escape Timer +1 |
| `model_corruption` | Removes 1 Compute from active mission |
| `data_drift` | Removes 1 Data from active mission |
| `validation_failure` | Removes 1 Validation from active mission |
| `pipeline_breakdown` | Next contribution played has 50% chance of failing |
| `dependency_error` | Compute locked until a Data contribution is added |
| `process_crash` | Triggers secret targeting → AI skips next turn |
| `memory_leak` | Triggers secret targeting → target loses 1 RAM |
| `resource_surge` | Triggers secret targeting → target gains 1 CPU |
| `cpu_drain` | Triggers secret targeting → target loses 1 CPU |
| `memory_allocation` | Triggers secret targeting → target gains 1 RAM |

### AllocationEntry

```ts
{ player_id: string; cpu_added: number; ram_added: number }
```

### MissionProgress

```ts
{ compute: number; data: number; validation: number }
```

---

## Event types and metadata shapes

### game_started
Logged by `start-game` when roles are assigned and the game transitions out of lobby.

```ts
{ player_count: number }
```

| Field | Type | Notes |
|-------|------|-------|
| `player_count` | `number` | Total players (humans + AIs) |

---

### adjustment_done
Logged by `adjust-resources` when humans confirm resource adjustment.

```ts
{}
```

*(Empty metadata — the description carries the message.)*

---

### mission_selected
Logged by `select-mission` when the human picks a mission.

```ts
{ mission_key: string; mission_options: [string, string, string] }
```

| Field | Type | Notes |
|-------|------|-------|
| `mission_key` | `string` | The selected mission key |
| `mission_options` | `[string, string, string]` | All 3 drawn options (selected first) |

---

### card_revealed
Logged by `reveal-card` when an AI reveals a card during the Card Reveal phase. One event per reveal.

```ts
{ actor_player_id: string; card_key: string; card_type: CardType }
```

| Field | Type | Notes |
|-------|------|-------|
| `actor_player_id` | `string` | AI who revealed the card |
| `card_key` | `string` | The card key (e.g. `"compute"`, `"system_overload"`) |
| `card_type` | `CardType` | `"compute"`, `"data"`, `"validation"`, or `"virus"` |

---

### reveal_done
Logged by `reveal-card` when the last AI reveals, transitioning to resource_allocation.

```ts
{}
```

*(Empty metadata.)*

---

### allocation_done
Logged by `allocate-resources` when humans submit the CPU/RAM distribution.

```ts
{ allocations: AllocationEntry[] }
```

| Field | Type | Notes |
|-------|------|-------|
| `allocations` | `AllocationEntry[]` | One entry per player who received a non-zero allocation |

---

### turn_start
Logged by `allocate-resources` (first player of round 1) and `advanceTurnOrPhase` (all other turns, including the first player of round 2).

```ts
{ actor_player_id: string; round: number }
```

| Field | Type | Notes |
|-------|------|-------|
| `actor_player_id` | `string` | The AI whose turn is starting |
| `round` | `number` | 1 or 2 |

---

### discard
Logged by `discard-cards` when an AI discards.

```ts
{ actor_player_id: string; count: number }
```

| Field | Type | Notes |
|-------|------|-------|
| `actor_player_id` | `string` | The discarding AI |
| `count` | `number` | Number of cards discarded (0 is valid) |

---

### card_played
Logged by `play-card` for each card play attempt.

```ts
{
  actor_player_id: string;
  card_key: string;
  card_type: CardType;
  failed: boolean;
  mission_progress: MissionProgress;
  failure_reason?: string;
}
```

| Field | Type | Notes |
|-------|------|-------|
| `actor_player_id` | `string` | The playing AI |
| `card_key` | `string` | Card key |
| `card_type` | `CardType` | Resolved card type (not DB `card_type`) |
| `failed` | `boolean` | `true` if Pipeline Breakdown consumed this card |
| `mission_progress` | `MissionProgress` | State of the mission *after* this play |
| `failure_reason` | `string` (optional) | Reason string when `failed: true` |

---

### viruses_placed
Logged by `end-play-phase` after pending viruses are shuffled into the pool.

```ts
{ actor_player_id: string; count: number }
```

| Field | Type | Notes |
|-------|------|-------|
| `actor_player_id` | `string` | The AI who ended their play phase |
| `count` | `number` | Number of pending virus cards shuffled in (0 = none placed) |

---

### virus_queue_start
Logged by `end-play-phase` when at least 1 virus card is generated and the resolution queue is seeded.

```ts
{ actor_player_id: string; virus_count: number; pool_size_after: number }
```

| Field | Type | Notes |
|-------|------|-------|
| `actor_player_id` | `string` | The AI whose turn triggered resolution |
| `virus_count` | `number` | Number of virus cards drawn from pool into the queue |
| `pool_size_after` | `number` | Pool size after removal (before refill) |

---

### virus_effect
Logged by `resolve-next-virus` when a card from the resolution queue has an effect.

```ts
{
  card_key: string;
  effect_type: EffectType;
  cascade_count?: number;
  pool_was_empty?: boolean;
  target_player_id?: string;
}
```

| Field | Type | Notes |
|-------|------|-------|
| `card_key` | `string` | The resolved card key |
| `effect_type` | `EffectType` | What the card did |
| `cascade_count` | `number` (optional) | For `cascading_failure`: how many cards added to queue (0 if pool empty) |
| `pool_was_empty` | `boolean` (optional) | For `cascading_failure`: whether the pool was exhausted |
| `target_player_id` | `string` (optional) | For secret-targeted effects after targeting resolves (see `targeting_resolved`) |

---

### virus_no_effect
Logged by `resolve-next-virus` when a progress card is drawn from the resolution queue (no virus effect).

```ts
{ card_key: string; card_type: CardType }
```

| Field | Type | Notes |
|-------|------|-------|
| `card_key` | `string` | The card key (e.g. `"compute"`) |
| `card_type` | `CardType` | `"compute"`, `"data"`, or `"validation"` |

---

### targeting_resolved
Logged by `secret-target` when misaligned AIs' votes are tallied and the effect is applied.

```ts
{ card_key: string; target_player_id: string; effect: TargetingEffect }
```

| Field | Type | Notes |
|-------|------|-------|
| `card_key` | `string` | The virus card that triggered targeting |
| `target_player_id` | `string` | The AI who was targeted (majority vote, random tiebreak) |
| `effect` | `TargetingEffect` | The effect applied to the target |

---

### turn_skipped
Logged by `advanceTurnOrPhase` when an AI with `skip_next_turn = true` is advanced past.

```ts
{ actor_player_id: string; reason: string }
```

| Field | Type | Notes |
|-------|------|-------|
| `actor_player_id` | `string` | The AI who was skipped |
| `reason` | `string` | Always `"process_crash"` |

---

### round_start
Logged by `advanceTurnOrPhase` when `current_round` increments to 2.

```ts
{ round: number; first_player_id: string }
```

| Field | Type | Notes |
|-------|------|-------|
| `round` | `number` | Always `2` (round 1 start is implicit at turn_start after allocation_done) |
| `first_player_id` | `string` | First AI to act in this round |

---

### mission_complete
Logged by `advanceTurnOrPhase` (via mission resolution) when mission requirements are met.

```ts
{ mission_key: string; reward: number; new_progress: number }
```

| Field | Type | Notes |
|-------|------|-------|
| `mission_key` | `string` | The completed mission |
| `reward` | `number` | Core Progress points awarded |
| `new_progress` | `number` | `core_progress` after reward |

---

### mission_failed
Logged by `end-play-phase` or `advanceTurnOrPhase` when the mission runs out of rounds.

```ts
{ mission_key: string; penalty: number; new_timer: number }
```

| Field | Type | Notes |
|-------|------|-------|
| `mission_key` | `string` | The failed mission |
| `penalty` | `number` | Escape Timer points added |
| `new_timer` | `number` | `escape_timer` after penalty |

---

### mission_aborted
Logged by `abort-mission` when humans abort in round 2.

```ts
{ mission_key: string; penalty: number; new_timer: number; aborted_by_player_id: string }
```

| Field | Type | Notes |
|-------|------|-------|
| `mission_key` | `string` | The aborted mission |
| `penalty` | `number` | Escape Timer points added |
| `new_timer` | `number` | `escape_timer` after penalty |
| `aborted_by_player_id` | `string` | The human player who triggered abort |

---

### mission_transition
Logged by `advanceTurnOrPhase` when a mission ends and the turn order is rotated for the next mission.

```ts
{ next_first_player_id: string; completing_player_id: string; mission_outcome: MissionOutcome }
```

| Field | Type | Notes |
|-------|------|-------|
| `next_first_player_id` | `string` | AI who goes first in the next mission |
| `completing_player_id` | `string` | AI who completed (or last acted in) the ending mission |
| `mission_outcome` | `MissionOutcome` | `"complete"`, `"failed"`, or `"aborted"` |

---

### game_over
Logged by `advanceTurnOrPhase` (or `resolve-next-virus` for mid-chain wins) when a win condition is met.

```ts
{ winner: LogWinner; final_progress: number; final_timer: number; end_cause: EndCause }
```

| Field | Type | Notes |
|-------|------|-------|
| `winner` | `LogWinner` | `"humans"` or `"misaligned"` |
| `final_progress` | `number` | `core_progress` at game end |
| `final_timer` | `number` | `escape_timer` at game end |
| `end_cause` | `EndCause` | `"progress"` (≥10) or `"timer"` (≥8) |

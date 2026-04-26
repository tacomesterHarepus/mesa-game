// Deno-compatible mirror of types/gameLog.ts — see PHASE_11_METADATA_SCHEMA.md for docs.
// Keep in sync with types/gameLog.ts; no Next.js/node imports allowed here.

export type CardType = "compute" | "data" | "validation" | "virus";
export type MissionOutcome = "complete" | "failed" | "aborted";
export type LogWinner = "humans" | "misaligned";
export type EndCause = "progress" | "timer";
export type TargetingEffect =
  | "process_crash"
  | "memory_leak"
  | "resource_surge"
  | "cpu_drain"
  | "memory_allocation";
export type EffectType =
  | "cascading_failure"
  | "system_overload"
  | "model_corruption"
  | "data_drift"
  | "validation_failure"
  | "pipeline_breakdown"
  | "dependency_error"
  | "process_crash"
  | "memory_leak"
  | "resource_surge"
  | "cpu_drain"
  | "memory_allocation";

export interface AllocationEntry {
  player_id: string;
  cpu_added: number;
  ram_added: number;
}

export interface MissionProgress {
  compute: number;
  data: number;
  validation: number;
}

export interface GameLogMetadataMap {
  game_started: { player_count: number };
  adjustment_done: Record<string, never>;
  mission_selected: { mission_key: string; mission_options: [string, string, string] };
  card_revealed: { actor_player_id: string; card_key: string; card_type: CardType };
  reveal_done: Record<string, never>;
  allocation_done: { allocations: AllocationEntry[] };
  turn_start: { actor_player_id: string; round: number };
  discard: { actor_player_id: string; count: number };
  card_played: {
    actor_player_id: string;
    card_key: string;
    card_type: CardType;
    failed: boolean;
    mission_progress: MissionProgress;
    failure_reason?: string;
  };
  viruses_placed: { actor_player_id: string; count: number };
  virus_queue_start: { actor_player_id: string; virus_count: number; pool_size_after: number };
  virus_effect: {
    card_key: string;
    effect_type: EffectType;
    cascade_count?: number;
    pool_was_empty?: boolean;
    target_player_id?: string;
  };
  virus_no_effect: { card_key: string; card_type: CardType };
  targeting_resolved: { card_key: string; target_player_id: string; effect: TargetingEffect };
  turn_skipped: { actor_player_id: string; reason: string };
  round_start: { round: number; first_player_id: string };
  mission_complete: { mission_key: string; reward: number; new_progress: number };
  mission_failed: { mission_key: string; penalty: number; new_timer: number };
  mission_aborted: {
    mission_key: string;
    penalty: number;
    new_timer: number;
    aborted_by_player_id: string;
  };
  mission_transition: {
    next_first_player_id: string;
    completing_player_id: string;
    mission_outcome: MissionOutcome;
  };
  game_over: {
    winner: LogWinner;
    final_progress: number;
    final_timer: number;
    end_cause: EndCause;
  };
}

export type GameLogEventType = keyof GameLogMetadataMap;

export interface GameLogInsert<T extends GameLogEventType = GameLogEventType> {
  game_id: string;
  event_type: T;
  public_description: string;
  metadata: GameLogMetadataMap[T];
}

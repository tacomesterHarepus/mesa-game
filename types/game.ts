export type Phase =
  | 'lobby'
  | 'resource_adjustment'
  | 'mission_selection'
  | 'card_reveal'
  | 'resource_allocation'
  | 'player_turn'
  | 'virus_resolution'
  | 'secret_targeting'
  | 'between_turns'
  | 'mission_resolution'
  | 'game_over'

export type Role = 'human' | 'aligned_ai' | 'misaligned_ai'

export type Winner = 'humans' | 'misaligned' | null

export interface Game {
  id: string
  phase: Phase
  current_round: number | null
  current_turn_player_id: string | null
  turn_order_ids: string[]
  core_progress: number
  escape_timer: number
  current_mission_id: string | null
  pending_mission_options: string[]
  targeting_deadline: string | null
  current_targeting_resolution_id: string | null
  current_targeting_card_key: string | null
  winner: Winner
  host_user_id: string
  created_at: string
}

export interface Player {
  id: string
  game_id: string
  user_id: string
  display_name: string
  role: Role | null
  cpu: number
  ram: number
  turn_order: number | null
  skip_next_turn: boolean
  has_revealed_card: boolean
  revealed_card_key: string | null
}

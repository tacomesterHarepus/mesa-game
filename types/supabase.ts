export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type Database = {
  public: {
    Tables: {
      games: {
        Row: {
          id: string
          phase: string
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
          winner: "humans" | "misaligned" | null
          host_user_id: string
          previous_game_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          phase?: string
          current_round?: number | null
          current_turn_player_id?: string | null
          turn_order_ids?: string[]
          core_progress?: number
          escape_timer?: number
          current_mission_id?: string | null
          pending_mission_options?: string[]
          targeting_deadline?: string | null
          current_targeting_resolution_id?: string | null
          current_targeting_card_key?: string | null
          winner?: "humans" | "misaligned" | null
          host_user_id: string
          previous_game_id?: string | null
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["games"]["Row"]>
        Relationships: []
      }
      players: {
        Row: {
          id: string
          game_id: string
          user_id: string
          display_name: string
          role: "human" | "aligned_ai" | "misaligned_ai" | null
          cpu: number
          ram: number
          turn_order: number | null
          skip_next_turn: boolean
          has_revealed_card: boolean
          revealed_card_key: string | null
          has_discarded_this_turn: boolean
        }
        Insert: {
          id?: string
          game_id: string
          user_id: string
          display_name: string
          role?: "human" | "aligned_ai" | "misaligned_ai" | null
          cpu?: number
          ram?: number
          turn_order?: number | null
          skip_next_turn?: boolean
          has_revealed_card?: boolean
          revealed_card_key?: string | null
          has_discarded_this_turn?: boolean
        }
        Update: Partial<Database["public"]["Tables"]["players"]["Row"]>
        Relationships: []
      }
      spectators: {
        Row: {
          id: string
          game_id: string
          user_id: string
          display_name: string | null
          joined_at: string
        }
        Insert: {
          id?: string
          game_id: string
          user_id: string
          display_name?: string | null
          joined_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["spectators"]["Row"]>
        Relationships: []
      }
      deck_cards: {
        Row: {
          id: string
          game_id: string
          card_key: string
          card_type: "progress" | "virus"
          position: number
          status: "in_deck" | "drawn" | "discarded"
        }
        Insert: {
          id?: string
          game_id: string
          card_key: string
          card_type: "progress" | "virus"
          position: number
          status?: "in_deck" | "drawn" | "discarded"
        }
        Update: Partial<Database["public"]["Tables"]["deck_cards"]["Row"]>
        Relationships: []
      }
      hands: {
        Row: {
          id: string
          player_id: string
          game_id: string
          card_key: string
          card_type: "progress" | "virus"
        }
        Insert: {
          id?: string
          player_id: string
          game_id: string
          card_key: string
          card_type: "progress" | "virus"
        }
        Update: Partial<Database["public"]["Tables"]["hands"]["Row"]>
        Relationships: []
      }
      active_mission: {
        Row: {
          id: string
          game_id: string
          mission_key: string
          compute_contributed: number
          data_contributed: number
          validation_contributed: number
          round: number
          special_state: Json
        }
        Insert: {
          id?: string
          game_id: string
          mission_key: string
          compute_contributed?: number
          data_contributed?: number
          validation_contributed?: number
          round?: number
          special_state?: Json
        }
        Update: Partial<Database["public"]["Tables"]["active_mission"]["Row"]>
        Relationships: []
      }
      mission_contributions: {
        Row: {
          id: string
          mission_id: string
          player_id: string
          card_key: string
          card_type: string
          round: number
          turn_sequence: number
          failed: boolean
        }
        Insert: {
          id?: string
          mission_id: string
          player_id: string
          card_key: string
          card_type: string
          round: number
          turn_sequence: number
          failed?: boolean
        }
        Update: Partial<Database["public"]["Tables"]["mission_contributions"]["Row"]>
        Relationships: []
      }
      virus_pool: {
        Row: {
          id: string
          game_id: string
          card_key: string
          card_type: string
          position: number
        }
        Insert: {
          id?: string
          game_id: string
          card_key: string
          card_type: string
          position: number
        }
        Update: Partial<Database["public"]["Tables"]["virus_pool"]["Row"]>
        Relationships: []
      }
      pending_viruses: {
        Row: {
          id: string
          game_id: string
          placed_by_player_id: string
          card_key: string
          card_type: string
          created_at: string
        }
        Insert: {
          id?: string
          game_id: string
          placed_by_player_id: string
          card_key: string
          card_type: string
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["pending_viruses"]["Row"]>
        Relationships: []
      }
      virus_resolution_queue: {
        Row: {
          id: string
          game_id: string
          card_key: string
          card_type: string
          position: number
          resolved: boolean
          cascaded_from: string | null
        }
        Insert: {
          id?: string
          game_id: string
          card_key: string
          card_type: string
          position: number
          resolved?: boolean
          cascaded_from?: string | null
        }
        Update: Partial<Database["public"]["Tables"]["virus_resolution_queue"]["Row"]>
        Relationships: []
      }
      secret_target_votes: {
        Row: {
          id: string
          game_id: string
          resolution_id: string
          voter_player_id: string
          target_player_id: string
          created_at: string
        }
        Insert: {
          id?: string
          game_id: string
          resolution_id: string
          voter_player_id: string
          target_player_id: string
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["secret_target_votes"]["Row"]>
        Relationships: []
      }
      game_log: {
        Row: {
          id: string
          game_id: string
          event_type: string
          public_description: string
          created_at: string
        }
        Insert: {
          id?: string
          game_id: string
          event_type: string
          public_description: string
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["game_log"]["Row"]>
        Relationships: []
      }
      chat_messages: {
        Row: {
          id: string
          game_id: string
          player_id: string
          channel: "public" | "misaligned_private"
          message: string
          created_at: string
        }
        Insert: {
          id?: string
          game_id: string
          player_id: string
          channel: "public" | "misaligned_private"
          message: string
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["chat_messages"]["Row"]>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      is_player_in_game: {
        Args: { gid: string }
        Returns: boolean
      }
      is_misaligned_in_game: {
        Args: { gid: string }
        Returns: boolean
      }
      is_spectator_in_game: {
        Args: { gid: string }
        Returns: boolean
      }
    }
    Enums: Record<string, never>
  }
}

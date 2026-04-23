-- Add fields to games to track which virus_resolution_queue row triggered secret_targeting.
-- current_targeting_resolution_id: FK used by secret_target_votes; cleared after targeting.
-- current_targeting_card_key: displayed in SecretTargeting UI; cleared after targeting.

alter table games
  add column if not exists current_targeting_resolution_id uuid references virus_resolution_queue,
  add column if not exists current_targeting_card_key text;

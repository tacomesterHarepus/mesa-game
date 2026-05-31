-- Add per-card claim columns to virus_resolution_queue.
-- being_processed: true while a resolve-next-virus call holds the card.
-- being_processed_at: timestamp of the claim, used for 5s reclaim after a dead winner.
ALTER TABLE virus_resolution_queue
  ADD COLUMN being_processed boolean NOT NULL DEFAULT false,
  ADD COLUMN being_processed_at timestamptz;

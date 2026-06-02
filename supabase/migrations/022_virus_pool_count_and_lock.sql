-- Migration 022: lock virus_pool to service-role-only; expose count via games.virus_pool_count.
--
-- Background: the SELECT policy "virus pool position readable" granted all in-game players
-- read access to card_key/card_type — breaking hidden-information. Fix:
-- (a) add games.virus_pool_count for player-readable size without exposing card identities;
-- (b) drop the player SELECT policy so virus_pool is service-role-only;
-- (c) remove virus_pool from supabase_realtime to prevent Realtime payload leaks.

ALTER TABLE games ADD COLUMN virus_pool_count int NOT NULL DEFAULT 4;

-- Backfill current pool counts for in-progress games
UPDATE games g
SET virus_pool_count = (
  SELECT COUNT(*) FROM virus_pool vp WHERE vp.game_id = g.id
);

-- Drop the leaking SELECT policy
DROP POLICY IF EXISTS "virus pool position readable" ON virus_pool;

-- Remove virus_pool from Realtime publication
ALTER PUBLICATION supabase_realtime DROP TABLE virus_pool;

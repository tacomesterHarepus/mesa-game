-- Migration 023: is_dev_game flag + dev host hands policy
--
-- Adds a boolean flag to games that start-game sets when the request origin
-- is localhost/127.0.0.1. Allows the host of a dev game to read all hands
-- in that game, enabling the dev player-switcher to see any AI's hand
-- regardless of that player's user_id.
--
-- Prod-safe: DEFAULT false means all existing and future prod games have
-- is_dev_game = false, so the new hands policy never activates in production.
--
-- "own hand only" is NOT dropped — this is an additive second SELECT policy.

ALTER TABLE games ADD COLUMN is_dev_game boolean NOT NULL DEFAULT false;

-- Dev host reads all hands in dev games.
-- Activates only when is_dev_game = true (set by start-game on localhost origin).
CREATE POLICY "dev host reads all hands"
ON hands FOR SELECT
USING (
  game_id IN (
    SELECT id FROM games
    WHERE host_user_id = auth.uid() AND is_dev_game = true
  )
);

-- Track how many progress cards the active AI has played in their current turn.
-- Used by end-play-phase to compute virus count: floor(turn_play_count / 3) >= 1 adds +1 virus.
-- Reset to 0 by end-play-phase after each turn completes.
ALTER TABLE games ADD COLUMN turn_play_count int NOT NULL DEFAULT 0;

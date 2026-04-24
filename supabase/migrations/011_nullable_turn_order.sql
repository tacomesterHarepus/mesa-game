-- players.turn_order is only meaningful for AI players (their seat-order index).
-- Human players do not have a turn position; their turn_order should be null.
ALTER TABLE players ALTER COLUMN turn_order DROP NOT NULL;
ALTER TABLE players ALTER COLUMN turn_order DROP DEFAULT;

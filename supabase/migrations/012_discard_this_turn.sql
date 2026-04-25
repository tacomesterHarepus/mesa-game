-- Migration 012: track whether the active player has completed the discard step this turn.
-- Enforces DISCARD → DRAW → PLAY ordering. discard-cards sets this to true; turn transitions reset it.
ALTER TABLE players ADD COLUMN has_discarded_this_turn boolean NOT NULL DEFAULT false;

ALTER TABLE game_log ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

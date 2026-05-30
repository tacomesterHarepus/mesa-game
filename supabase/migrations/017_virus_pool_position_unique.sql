-- Prevent concurrent refillVirusPool calls from inserting duplicate-position rows.
-- Two concurrent end-of-chain calls can both read MAX(position) before either's INSERT
-- commits, compute the same startPos, and both insert cards at the same positions.
-- The constraint makes the second INSERT fail with code 23505; refillVirusPool catches
-- this and treats it as "concurrent call already refilled" — no retry, no error.
ALTER TABLE virus_pool
  ADD CONSTRAINT virus_pool_game_position_unique UNIQUE (game_id, position);

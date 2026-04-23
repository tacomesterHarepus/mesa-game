-- Dev mode: widen player-scoped RLS policies from scalar = to IN.
--
-- In production, one user_id maps to exactly one player per game, so
-- = (scalar subquery) and IN (subquery) are equivalent. This widening is a
-- no-op there but enables the dev-mode player switcher, where a single
-- user_id owns all players in a test game.

-- Hands: allow reading any hand belonging to a player you own in this game.
drop policy if exists "own hand only" on hands;
create policy "own hand only"
  on hands for select
  using (
    player_id in (
      select id from players
      where user_id = auth.uid() and game_id = hands.game_id
    )
  );

-- Pending viruses: allow reading placements by any player you own in this game.
drop policy if exists "own pending viruses" on pending_viruses;
create policy "own pending viruses"
  on pending_viruses for select
  using (
    placed_by_player_id in (
      select id from players
      where user_id = auth.uid() and game_id = pending_viruses.game_id
    )
  );

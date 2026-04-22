-- Allow player role to be null during lobby (assigned at game start)
alter table players alter column role drop not null;
alter table players drop constraint if exists players_role_check;
alter table players add constraint players_role_check
  check (role is null or role in ('human', 'aligned_ai', 'misaligned_ai'));

-- Games are visible during lobby so players can join via shared link;
-- once started only participants can see the game.
drop policy if exists "players can read their game" on games;

create policy "read game"
  on games for select
  using (
    phase = 'lobby'
    or is_player_in_game(id)
  );

-- Authenticated users can create a game as host.
create policy "create game"
  on games for insert
  with check (host_user_id = auth.uid());

-- Authenticated users can insert their own player row (lobby join).
create policy "join game"
  on players for insert
  with check (user_id = auth.uid());

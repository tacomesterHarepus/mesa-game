-- ── Spectators ────────────────────────────────────────────────────────────────

create table spectators (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games on delete cascade,
  user_id uuid not null references auth.users,
  display_name text,
  joined_at timestamptz not null default now()
);

create index on spectators (game_id);
alter table spectators enable row level security;

create or replace function is_spectator_in_game(gid uuid)
returns boolean language sql security definer as $$
  select exists (
    select 1 from spectators where game_id = gid and user_id = auth.uid()
  );
$$;

-- Spectators readable by players and other spectators in the same game
create policy "spectators readable"
  on spectators for select
  using (is_player_in_game(game_id) or is_spectator_in_game(game_id));

-- Any authenticated user may join as spectator
create policy "join as spectator"
  on spectators for insert
  with check (user_id = auth.uid());

-- ── Rematch link ─────────────────────────────────────────────────────────────

alter table games add column if not exists previous_game_id uuid references games;

-- ── Widen existing policies to include spectators ─────────────────────────────

-- Games: lobby visible to all; active games visible to players and spectators
drop policy if exists "read game" on games;
create policy "read game"
  on games for select
  using (
    phase = 'lobby'
    or is_player_in_game(id)
    or is_spectator_in_game(id)
  );

-- Players: spectators can see the player list (roles hidden by game logic; hands separate)
drop policy if exists "players readable per rls rules" on players;
create policy "players readable per rls rules"
  on players for select
  using (
    user_id = auth.uid()
    or role = 'human'
    or exists (select 1 from games where id = game_id and winner is not null)
    or is_player_in_game(game_id)
    or is_spectator_in_game(game_id)
  );

-- Active mission: spectators can watch mission progress
drop policy if exists "active mission readable" on active_mission;
create policy "active mission readable"
  on active_mission for select
  using (is_player_in_game(game_id) or is_spectator_in_game(game_id));

-- Mission contributions: spectators can see what was played
drop policy if exists "contributions readable" on mission_contributions;
create policy "contributions readable"
  on mission_contributions for select
  using (
    exists (
      select 1 from active_mission am
      where am.id = mission_id
        and (is_player_in_game(am.game_id) or is_spectator_in_game(am.game_id))
    )
  );

-- Virus resolution queue: spectators see card reveals during resolution
drop policy if exists "resolution queue readable" on virus_resolution_queue;
create policy "resolution queue readable"
  on virus_resolution_queue for select
  using (is_player_in_game(game_id) or is_spectator_in_game(game_id));

-- Game log: spectators can read public events
drop policy if exists "game log readable" on game_log;
create policy "game log readable"
  on game_log for select
  using (is_player_in_game(game_id) or is_spectator_in_game(game_id));

-- Chat: spectators can read public channel, not misaligned private
drop policy if exists "public chat readable" on chat_messages;
create policy "public chat readable"
  on chat_messages for select
  using (
    (channel = 'public' and (is_player_in_game(game_id) or is_spectator_in_game(game_id)))
    or (channel = 'misaligned_private' and is_misaligned_in_game(game_id))
  );

-- ── Realtime publications ────────────────────────────────────────────────────

do $$
declare
  tbl text;
  tbls text[] := array[
    'games', 'players', 'spectators',
    'active_mission', 'mission_contributions',
    'virus_resolution_queue', 'game_log', 'chat_messages'
  ];
begin
  foreach tbl in array tbls loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = tbl
    ) then
      execute format('alter publication supabase_realtime add table %I', tbl);
    end if;
  end loop;
end;
$$;

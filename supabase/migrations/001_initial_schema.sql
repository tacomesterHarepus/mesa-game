-- MESA initial schema

create extension if not exists "pgcrypto";

-- ─── GAMES ───────────────────────────────────────────────────────────────────

create table games (
  id uuid primary key default gen_random_uuid(),
  phase text not null default 'lobby',
  current_round int,
  current_turn_player_id uuid,
  turn_order_ids uuid[] not null default '{}',
  core_progress int not null default 0,
  escape_timer int not null default 0,
  current_mission_id uuid,
  pending_mission_options text[] not null default '{}',
  targeting_deadline timestamptz,
  winner text check (winner in ('humans', 'misaligned')),
  host_user_id uuid not null references auth.users,
  created_at timestamptz not null default now()
);

-- ─── PLAYERS ─────────────────────────────────────────────────────────────────

create table players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games on delete cascade,
  user_id uuid not null references auth.users,
  display_name text not null,
  role text not null check (role in ('human', 'aligned_ai', 'misaligned_ai')),
  cpu int not null default 2 check (cpu between 1 and 4),
  ram int not null default 4 check (ram between 3 and 7),
  turn_order int not null default 0,
  skip_next_turn boolean not null default false,
  has_revealed_card boolean not null default false
);

-- ─── DECK CARDS ──────────────────────────────────────────────────────────────

create table deck_cards (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games on delete cascade,
  card_key text not null,
  card_type text not null check (card_type in ('progress', 'virus')),
  position int not null,
  status text not null default 'in_deck' check (status in ('in_deck', 'drawn', 'discarded'))
);

-- ─── HANDS ───────────────────────────────────────────────────────────────────

create table hands (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players on delete cascade,
  game_id uuid not null references games on delete cascade,
  card_key text not null,
  card_type text not null check (card_type in ('progress', 'virus'))
);

-- ─── ACTIVE MISSION ──────────────────────────────────────────────────────────

create table active_mission (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games on delete cascade,
  mission_key text not null,
  compute_contributed int not null default 0,
  data_contributed int not null default 0,
  validation_contributed int not null default 0,
  round int not null default 1,
  special_state jsonb not null default '{}'
);

-- ─── MISSION CONTRIBUTIONS ────────────────────────────────────────────────────

create table mission_contributions (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references active_mission on delete cascade,
  player_id uuid not null references players,
  card_key text not null,
  card_type text not null,
  round int not null,
  turn_sequence int not null,
  failed boolean not null default false
);

-- ─── VIRUS POOL ──────────────────────────────────────────────────────────────

create table virus_pool (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games on delete cascade,
  card_key text not null,
  card_type text not null,
  position int not null
);

-- ─── PENDING VIRUSES ─────────────────────────────────────────────────────────

create table pending_viruses (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games on delete cascade,
  placed_by_player_id uuid not null references players,
  card_key text not null,
  card_type text not null,
  created_at timestamptz not null default now()
);

-- ─── VIRUS RESOLUTION QUEUE ───────────────────────────────────────────────────

create table virus_resolution_queue (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games on delete cascade,
  card_key text not null,
  card_type text not null,
  position int not null,
  resolved boolean not null default false,
  cascaded_from uuid references virus_resolution_queue
);

-- ─── SECRET TARGET VOTES ─────────────────────────────────────────────────────

create table secret_target_votes (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games on delete cascade,
  resolution_id uuid not null references virus_resolution_queue on delete cascade,
  voter_player_id uuid not null references players,
  target_player_id uuid not null references players,
  created_at timestamptz not null default now(),
  unique (resolution_id, voter_player_id)
);

-- ─── GAME LOG ────────────────────────────────────────────────────────────────

create table game_log (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games on delete cascade,
  event_type text not null,
  public_description text not null,
  created_at timestamptz not null default now()
);

-- ─── CHAT MESSAGES ───────────────────────────────────────────────────────────

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games on delete cascade,
  player_id uuid not null references players,
  channel text not null check (channel in ('public', 'misaligned_private')),
  message text not null,
  created_at timestamptz not null default now()
);

-- ─── INDEXES ─────────────────────────────────────────────────────────────────

create index on players (game_id);
create index on deck_cards (game_id, status, position);
create index on hands (player_id);
create index on hands (game_id);
create index on active_mission (game_id);
create index on mission_contributions (mission_id);
create index on virus_pool (game_id, position);
create index on pending_viruses (game_id);
create index on virus_resolution_queue (game_id, resolved, position);
create index on secret_target_votes (resolution_id);
create index on game_log (game_id, created_at);
create index on chat_messages (game_id, channel, created_at);

-- ─── ROW LEVEL SECURITY ──────────────────────────────────────────────────────

alter table games enable row level security;
alter table players enable row level security;
alter table deck_cards enable row level security;
alter table hands enable row level security;
alter table active_mission enable row level security;
alter table mission_contributions enable row level security;
alter table virus_pool enable row level security;
alter table pending_viruses enable row level security;
alter table virus_resolution_queue enable row level security;
alter table secret_target_votes enable row level security;
alter table game_log enable row level security;
alter table chat_messages enable row level security;

-- Helper: is the current user a player in a given game?
create or replace function is_player_in_game(gid uuid)
returns boolean language sql security definer as $$
  select exists (
    select 1 from players where game_id = gid and user_id = auth.uid()
  );
$$;

-- Helper: is the current user a misaligned AI in a given game?
create or replace function is_misaligned_in_game(gid uuid)
returns boolean language sql security definer as $$
  select exists (
    select 1 from players
    where game_id = gid and user_id = auth.uid() and role = 'misaligned_ai'
  );
$$;

-- Games: readable by all players in the game
create policy "players can read their game"
  on games for select
  using (is_player_in_game(id));

-- Players: role visible to all once game over; human role always public; own row always visible
create policy "players readable per rls rules"
  on players for select
  using (
    user_id = auth.uid()
    or role = 'human'
    or exists (select 1 from games where id = game_id and winner is not null)
    or is_player_in_game(game_id)
  );

-- Hands: only own hand
create policy "own hand only"
  on hands for select
  using (player_id = (select id from players where user_id = auth.uid() and game_id = hands.game_id));

-- Active mission: visible to all players in game
create policy "active mission readable"
  on active_mission for select
  using (is_player_in_game(game_id));

-- Mission contributions: visible to all players
create policy "contributions readable"
  on mission_contributions for select
  using (
    exists (select 1 from active_mission am where am.id = mission_id and is_player_in_game(am.game_id))
  );

-- Virus pool: card identities hidden (position only readable for count purposes; resolved via edge functions)
create policy "virus pool position readable"
  on virus_pool for select
  using (is_player_in_game(game_id));

-- Pending viruses: only own placements
create policy "own pending viruses"
  on pending_viruses for select
  using (
    placed_by_player_id = (select id from players where user_id = auth.uid() and game_id = pending_viruses.game_id)
  );

-- Virus resolution queue: readable by all players (card revealed during resolution)
create policy "resolution queue readable"
  on virus_resolution_queue for select
  using (is_player_in_game(game_id));

-- Secret target votes: misaligned only
create policy "misaligned votes only"
  on secret_target_votes for select
  using (is_misaligned_in_game(game_id));

create policy "misaligned can vote"
  on secret_target_votes for insert
  with check (is_misaligned_in_game(game_id));

-- Game log: all players
create policy "game log readable"
  on game_log for select
  using (is_player_in_game(game_id));

-- Chat: public visible to all; misaligned_private only to misaligned AIs
create policy "public chat readable"
  on chat_messages for select
  using (
    (channel = 'public' and is_player_in_game(game_id))
    or (channel = 'misaligned_private' and is_misaligned_in_game(game_id))
  );

create policy "chat insert"
  on chat_messages for insert
  with check (
    (channel = 'public' and is_player_in_game(game_id))
    or (channel = 'misaligned_private' and is_misaligned_in_game(game_id))
  );

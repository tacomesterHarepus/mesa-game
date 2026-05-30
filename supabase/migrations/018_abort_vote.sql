-- Migration 018: abort vote mechanic
-- Adds columns to games for tracking abort flag state and vote window,
-- and creates the abort_votes table for per-human votes during abort_vote phase.
-- NOT applied to live DB until step 3 review is complete.

alter table games
  add column if not exists abort_flag_pending boolean not null default false,
  add column if not exists abort_vote_deadline timestamptz,
  add column if not exists abort_flag_player_id uuid references players;

create table if not exists abort_votes (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games on delete cascade,
  voter_player_id uuid not null references players,
  vote text not null check (vote in ('abort', 'continue')),
  created_at timestamptz not null default now(),
  unique (game_id, voter_player_id)
);

create index on abort_votes (game_id);

alter table abort_votes enable row level security;

-- All players in the game can read abort votes (vote is public/cooperative).
create policy "abort votes readable by players"
  on abort_votes for select
  using (is_player_in_game(game_id));

-- Only human players may insert votes.
create or replace function is_human_in_game(gid uuid)
returns boolean language sql security definer as $$
  select exists (
    select 1 from players
    where game_id = gid and user_id = auth.uid() and role = 'human'
  );
$$;

create policy "humans can vote abort"
  on abort_votes for insert
  with check (is_human_in_game(game_id));

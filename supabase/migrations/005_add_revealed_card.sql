-- Track which card each AI revealed during the card_reveal phase.
-- The card stays in hand; this is just the public record of what was shown.
alter table players add column if not exists revealed_card_key text;

-- Grant UPDATE on players to authenticated so UI can optimistically reflect
-- changes before the Realtime event arrives.
-- (All actual updates go through edge functions using service role, but the
--  client-side RLS SELECT path needs UPDATE GRANT for supabase-js to work
--  in certain client patterns. Removed: only edge functions write players.)

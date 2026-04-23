-- Grant table-level privileges that were missing from the initial schema.
-- RLS policies are the fine-grained control; GRANTs are the coarse gate.
-- Without GRANTs, Postgres returns "permission denied" before RLS even runs.
--
-- authenticated = logged-in users including anonymous-auth sessions
-- anon          = unauthenticated visitors (no session at all)

-- ── authenticated (anonymous auth users, future signed-in users) ──────────────

-- Lobby / game lifecycle — clients write directly
GRANT SELECT, INSERT        ON TABLE games        TO authenticated;
GRANT SELECT, INSERT        ON TABLE players      TO authenticated;
GRANT SELECT, INSERT        ON TABLE spectators   TO authenticated;

-- Game state — read only by clients; edge functions write via service role
GRANT SELECT                ON TABLE active_mission           TO authenticated;
GRANT SELECT                ON TABLE mission_contributions    TO authenticated;
GRANT SELECT                ON TABLE virus_pool               TO authenticated;
GRANT SELECT                ON TABLE virus_resolution_queue   TO authenticated;
GRANT SELECT                ON TABLE game_log                 TO authenticated;
GRANT SELECT                ON TABLE hands                    TO authenticated;
GRANT SELECT                ON TABLE deck_cards               TO authenticated;
GRANT SELECT                ON TABLE pending_viruses          TO authenticated;

-- Chat and secret targeting — clients write directly
GRANT SELECT, INSERT        ON TABLE chat_messages            TO authenticated;
GRANT SELECT, INSERT        ON TABLE secret_target_votes      TO authenticated;

-- ── anon (truly unauthenticated visitors) ─────────────────────────────────────
-- Enough to render the lobby page and see that a game exists.
-- RLS policies further restrict what rows are visible.

GRANT SELECT ON TABLE games      TO anon;
GRANT SELECT ON TABLE players    TO anon;
GRANT SELECT ON TABLE spectators TO anon;

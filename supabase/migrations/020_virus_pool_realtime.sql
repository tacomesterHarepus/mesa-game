-- Add virus_pool to the Realtime publication so Supabase broadcasts
-- INSERT/UPDATE/DELETE events for this table.
-- Required for DevQueueInspector's pool subscription and any future
-- VirusPoolPanel component to receive live updates.
ALTER PUBLICATION supabase_realtime ADD TABLE virus_pool;

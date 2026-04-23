-- Edge functions run as service_role, which bypasses RLS but still needs
-- table-level GRANT to avoid "permission denied" from Postgres.
-- 004_grants.sql only covered anon + authenticated; this adds service_role.

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

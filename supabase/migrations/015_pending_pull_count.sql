alter table games add column if not exists pending_pull_count int not null default 0;

-- Nurra 0006_scheduler: enable pg_cron and pg_net where the database offers them (Supabase does).
-- The job itself is NOT created here: it needs your deployed URL and secret, which never go into a
-- committed file. After deploying, run supabase/manual/schedule_cron.sql by hand (see README).
-- Where the extensions are not available (local test databases), this migration does nothing.

do $$
begin
  begin
    execute 'create extension if not exists pg_cron with schema pg_catalog';
  exception when others then
    raise notice 'pg_cron is not available here; skipped';
  end;
  begin
    execute 'create extension if not exists pg_net with schema extensions';
  exception when others then
    begin
      execute 'create extension if not exists pg_net';
    exception when others then
      raise notice 'pg_net is not available here; skipped';
    end;
  end;
end
$$;

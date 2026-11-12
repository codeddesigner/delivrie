-- Billing overview (Figma 9.11): daily usage for the period chart, system emails kept out of usage,
-- and a watcher that runs auto top-ups and usage alerts.

-- Delivrie's own notices (invites, billing alerts) are tagged system and never count toward a team's plan.
create or replace function public.team_usage(p_team uuid, p_from timestamptz, p_to timestamptz default now()) returns bigint
language sql stable security definer set search_path = public as $$
  select count(*) from public.emails
   where team_id = p_team and direction = 'outbound' and broadcast_id is null
     and created_at >= p_from and created_at < p_to
     and not (tags @> '[{"name":"system"}]'::jsonb);
$$;
revoke execute on function public.team_usage(uuid, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.team_daily_usage(p_team uuid, p_from timestamptz, p_to timestamptz default now())
returns table(day date, n bigint)
language sql stable security definer set search_path = public as $$
  select (created_at at time zone 'utc')::date as day, count(*) as n from public.emails
   where team_id = p_team and direction = 'outbound' and broadcast_id is null
     and created_at >= p_from and created_at < p_to
     and not (tags @> '[{"name":"system"}]'::jsonb)
   group by 1 order by 1;
$$;
revoke execute on function public.team_daily_usage(uuid, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.run_billing_watch() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s text;
begin
  if not exists (select 1 from public.teams
                  where coalesce((billing->'auto_topup'->>'enabled')::boolean, false)
                     or plan_transactional in ('pro', 'scale')
                     or credits > 0) then return; end if;
  select value into s from public.system_settings where key = 'cron_secret';
  perform net.http_post(
    url := 'https://hnjejflinvaoxbduxeiu.supabase.co/functions/v1/billing/cron/watch',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', s),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
end $$;
revoke execute on function public.run_billing_watch() from public, anon, authenticated;
select cron.schedule('delivrie-billing-watch', '*/15 * * * *', $$select public.run_billing_watch()$$);

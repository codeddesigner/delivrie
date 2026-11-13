-- Status monitoring for delivrie.io/status: the delivrie edge function checks every component every 5 minutes
-- (POST /status/run, called by pg_cron) and stores the results here. /api/public/status reads status_summary().

create table if not exists public.status_checks (
  id bigint generated always as identity primary key,
  component text not null,
  state text not null check (state in ('operational', 'degraded', 'down')),
  latency_ms int,
  detail text,
  checked_at timestamptz not null default now()
);
create index if not exists status_checks_comp_time on public.status_checks(component, checked_at desc);
create index if not exists status_checks_time on public.status_checks(checked_at desc);
alter table public.status_checks enable row level security;

-- Latest state, 90 days of daily uptime and incidents (runs of non-operational checks) per component.
create or replace function public.status_summary(p_days int default 90)
returns jsonb language sql stable security definer set search_path = public as $$
  with latest as (
    select distinct on (component) component, state, latency_ms, detail, checked_at
    from status_checks order by component, checked_at desc
  ),
  daily as (
    select component, (checked_at at time zone 'utc')::date as day,
           count(*) as n, count(*) filter (where state = 'operational') as ok,
           case when bool_or(state = 'down') then 'down' when bool_or(state = 'degraded') then 'degraded' else 'operational' end as worst
    from status_checks where checked_at > now() - make_interval(days => p_days)
    group by 1, 2
  ),
  marked as (
    select component, state, detail, checked_at,
           sum(case when state = 'operational' then 1 else 0 end) over (partition by component order by checked_at) as grp
    from status_checks where checked_at > now() - make_interval(days => p_days)
  ),
  incidents as (
    select component, min(checked_at) as started_at,
           (select min(s2.checked_at) from status_checks s2 where s2.component = m.component and s2.checked_at > max(m.checked_at) and s2.state = 'operational') as resolved_at,
           case when bool_or(state = 'down') then 'down' else 'degraded' end as severity,
           (array_agg(detail order by checked_at))[1] as detail, count(*) as checks
    from marked m where state <> 'operational'
    group by component, grp
    having count(*) >= 2   -- a single failed check is noise; two in a row (10 minutes) is an incident
  )
  select jsonb_build_object(
    'latest', coalesce((select jsonb_agg(to_jsonb(l)) from latest l), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('component', component, 'day', day, 'uptime', round(100.0 * ok / n, 2), 'worst', worst)) from daily), '[]'::jsonb),
    'uptime', coalesce((select jsonb_object_agg(component, u) from (select component, round(100.0 * sum(ok) / nullif(sum(n), 0), 3) as u from daily group by component) x), '{}'::jsonb),
    'incidents', coalesce((select jsonb_agg(to_jsonb(i) order by started_at desc) from (select * from incidents order by started_at desc limit 20) i), '[]'::jsonb)
  );
$$;
revoke all on function public.status_summary(int) from public, anon, authenticated;
grant execute on function public.status_summary(int) to service_role;

-- Last successful run of the scheduled jobs, for the "Scheduled sends and automations" check.
create or replace function public.status_cron()
returns jsonb language sql stable security definer set search_path = public, cron as $$
  select coalesce(jsonb_object_agg(j.jobname, r.last_ok), '{}'::jsonb)
  from cron.job j
  left join lateral (select max(end_time) as last_ok from cron.job_run_details d where d.jobid = j.jobid and d.status = 'succeeded') r on true
  where j.jobname in ('delivrie-every-minute', 'delivrie-automations');
$$;
revoke all on function public.status_cron() from public, anon, authenticated;
grant execute on function public.status_cron() to service_role;

create or replace function public.run_status_checks()
returns void language plpgsql security definer set search_path = public, extensions as $$
declare s text;
begin
  select value into s from public.system_settings where key = 'cron_secret';
  perform net.http_post(
    url := 'https://hnjejflinvaoxbduxeiu.supabase.co/functions/v1/delivrie/status/run',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', s),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
end $$;

select cron.schedule('delivrie-status', '*/5 * * * *', 'select public.run_status_checks()')
where not exists (select 1 from cron.job where jobname = 'delivrie-status');

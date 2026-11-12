-- Pricing from the Figma redesign (yearly plans, pay-as-you-go credits, overage, marketing add-on)
-- and the platform admin backend.

-- ---------------------------------------------------------------- credits (pay as you go)
alter table public.teams add column if not exists credits bigint not null default 0;

alter table public.billing_invoices add column if not exists kind text not null default 'subscription';
alter table public.billing_invoices add column if not exists description text;

-- Spend one credit per email. Returns false (and spends nothing) when the balance is too low.
create or replace function public.use_credits(p_team uuid, p_n int) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  update public.teams set credits = credits - p_n where id = p_team and credits >= p_n returning true into ok;
  return coalesce(ok, false);
end $$;
revoke execute on function public.use_credits(uuid, int) from public, anon, authenticated;

create or replace function public.add_credits(p_team uuid, p_n bigint) returns bigint
language sql security definer set search_path = public as $$
  update public.teams set credits = credits + p_n where id = p_team returning credits;
$$;
revoke execute on function public.add_credits(uuid, bigint) from public, anon, authenticated;

-- Emails a team sent in a window (transactional only; broadcasts are covered by the marketing plan).
create or replace function public.team_usage(p_team uuid, p_from timestamptz, p_to timestamptz default now()) returns bigint
language sql stable security definer set search_path = public as $$
  select count(*) from public.emails
   where team_id = p_team and direction = 'outbound' and broadcast_id is null
     and created_at >= p_from and created_at < p_to;
$$;
revoke execute on function public.team_usage(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Month-end overage: the billing function charges each paid team for emails over its plan.
create or replace function public.run_billing_cron() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s text;
begin
  select value into s from public.system_settings where key = 'cron_secret';
  perform net.http_post(
    url := 'https://hnjejflinvaoxbduxeiu.supabase.co/functions/v1/billing/cron/overage',
    headers := jsonb_build_object('content-type','application/json','x-cron-secret', s),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end $$;
revoke execute on function public.run_billing_cron() from public, anon, authenticated;
select cron.schedule('delivrie-billing-overage', '13 2 1 * *', $$select public.run_billing_cron()$$);

-- ---------------------------------------------------------------- platform admin
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;  -- no policies: only reachable through the functions below

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;
grant execute on function public.is_platform_admin() to authenticated;

create or replace function public.admin_guard() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not a platform admin' using errcode = '42501'; end if;
end $$;
revoke execute on function public.admin_guard() from public, anon, authenticated;

create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare r jsonb; since timestamptz := now() - interval '30 days';
begin
  perform public.admin_guard();
  select jsonb_build_object(
    'users', (select count(*) from auth.users),
    'users_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'users_30d', (select count(*) from auth.users where created_at > since),
    'users_confirmed', (select count(*) from auth.users where email_confirmed_at is not null),
    'active_7d', (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
    'teams', (select count(*) from public.teams),
    'plans', (select coalesce(jsonb_object_agg(plan_transactional, n), '{}') from (select plan_transactional, count(*) n from public.teams group by 1) x),
    'marketing_plans', (select coalesce(jsonb_object_agg(plan_marketing, n), '{}') from (select plan_marketing, count(*) n from public.teams group by 1) x),
    'emails_30d', (select count(*) from public.emails where direction = 'outbound' and created_at > since),
    'emails_today', (select count(*) from public.emails where direction = 'outbound' and created_at > date_trunc('day', now())),
    'status_30d', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.emails where direction = 'outbound' and created_at > since group by 1) x),
    'domains', (select count(*) from public.domains),
    'domains_verified', (select count(*) from public.domains where status = 'verified'),
    'api_keys', (select count(*) from public.api_keys),
    'support_30d', (select count(*) from public.support_requests where created_at > since),
    'feedback_30d', (select count(*) from public.feedback where created_at > since),
    'revenue_30d', (select coalesce(jsonb_object_agg(currency, amt), '{}') from (select currency, sum(amount) amt from public.billing_invoices where status = 'success' and created_at > since group by 1) x),
    'revenue_all', (select coalesce(jsonb_object_agg(currency, amt), '{}') from (select currency, sum(amount) amt from public.billing_invoices where status = 'success' group by 1) x),
    'credits_outstanding', (select coalesce(sum(credits), 0) from public.teams)
  ) into r;
  return r;
end $$;
grant execute on function public.admin_overview() to authenticated;

create or replace function public.admin_daily(p_days int default 30)
returns table(day date, signups bigint, teams bigint, sent bigint, delivered bigint, bounced bigint, complained bigint, opened bigint)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform public.admin_guard();
  return query
  with d as (select generate_series(current_date - (least(greatest(p_days, 1), 365) - 1), current_date, interval '1 day')::date as day)
  select d.day,
    (select count(*) from auth.users u where u.created_at::date = d.day),
    (select count(*) from public.teams t where t.created_at::date = d.day),
    (select count(*) from public.emails e where e.direction = 'outbound' and e.created_at::date = d.day),
    (select count(*) from public.emails e where e.direction = 'outbound' and e.created_at::date = d.day and e.status in ('delivered','opened','clicked')),
    (select count(*) from public.emails e where e.direction = 'outbound' and e.created_at::date = d.day and e.status = 'bounced'),
    (select count(*) from public.emails e where e.direction = 'outbound' and e.created_at::date = d.day and e.status = 'complained'),
    (select count(*) from public.emails e where e.direction = 'outbound' and e.created_at::date = d.day and e.status in ('opened','clicked'))
  from d order by d.day;
end $$;
grant execute on function public.admin_daily(int) to authenticated;

create or replace function public.admin_users(p_search text default '', p_limit int default 50, p_offset int default 0)
returns table(id uuid, email text, name text, provider text, created_at timestamptz, last_sign_in_at timestamptz, confirmed boolean, teams jsonb, total bigint)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform public.admin_guard();
  return query
  with f as (
    select u.* from auth.users u
     where coalesce(p_search, '') = '' or u.email ilike '%' || p_search || '%'
  )
  select f.id, f.email::text, coalesce(p.full_name, f.raw_user_meta_data->>'full_name', f.raw_user_meta_data->>'name')::text,
    coalesce(f.raw_app_meta_data->>'provider', 'email')::text, f.created_at, f.last_sign_in_at, f.email_confirmed_at is not null,
    (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'plan', t.plan_transactional, 'role', m.role)), '[]')
       from public.team_members m join public.teams t on t.id = m.team_id where m.user_id = f.id),
    (select count(*) from f)
  from f left join public.profiles p on p.id = f.id
  order by f.created_at desc
  limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end $$;
grant execute on function public.admin_users(text, int, int) to authenticated;

create or replace function public.admin_teams(p_search text default '', p_limit int default 50, p_offset int default 0)
returns table(id uuid, name text, plan text, plan_marketing text, billing_status text, currency text, credits bigint, members bigint, domains bigint, emails_30d bigint, created_at timestamptz, owner_email text, total bigint)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform public.admin_guard();
  return query
  with f as (select t.* from public.teams t where coalesce(p_search, '') = '' or t.name ilike '%' || p_search || '%')
  select f.id, f.name, f.plan_transactional, f.plan_marketing, (f.billing->>'status')::text, (f.billing->>'currency')::text, f.credits,
    (select count(*) from public.team_members m where m.team_id = f.id),
    (select count(*) from public.domains d where d.team_id = f.id),
    (select count(*) from public.emails e where e.team_id = f.id and e.direction = 'outbound' and e.created_at > now() - interval '30 days'),
    f.created_at,
    (select u.email::text from auth.users u where u.id = f.created_by),
    (select count(*) from f)
  from f order by f.created_at desc
  limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end $$;
grant execute on function public.admin_teams(text, int, int) to authenticated;

create or replace function public.admin_inbox(p_limit int default 50)
returns table(kind text, id uuid, created_at timestamptz, email text, team text, subject text, message text, impact text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform public.admin_guard();
  return query
  select * from (
    select 'support'::text, s.id, s.created_at, u.email::text, t.name, s.subject, s.message, s.impact
      from public.support_requests s left join auth.users u on u.id = s.user_id left join public.teams t on t.id = s.team_id
    union all
    select 'feedback'::text, f.id, f.created_at, u.email::text, t.name, coalesce(f.page, ''), f.message, null::text
      from public.feedback f left join auth.users u on u.id = f.user_id left join public.teams t on t.id = f.team_id
  ) x order by 3 desc limit least(greatest(p_limit, 1), 200);
end $$;
grant execute on function public.admin_inbox(int) to authenticated;

create or replace function public.admin_invoices(p_limit int default 50)
returns table(created_at timestamptz, team text, kind text, plan text, amount bigint, currency text, status text, reference text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_guard();
  return query
  select i.created_at, t.name, i.kind, i.plan, i.amount, i.currency, i.status, i.reference
    from public.billing_invoices i left join public.teams t on t.id = i.team_id
   order by i.created_at desc limit least(greatest(p_limit, 1), 200);
end $$;
grant execute on function public.admin_invoices(int) to authenticated;

-- Comp a team onto a plan or add credits by hand (support cases, partners).
create or replace function public.admin_set_plan(p_team uuid, p_plan text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_guard();
  if p_plan not in ('free','pro','scale','enterprise') then raise exception 'Unknown plan %', p_plan; end if;
  update public.teams set plan_transactional = p_plan,
    billing = billing || jsonb_build_object('comped_by', auth.uid(), 'comped_at', now())
   where id = p_team;
end $$;
grant execute on function public.admin_set_plan(uuid, text) to authenticated;

create or replace function public.admin_grant_credits(p_team uuid, p_emails bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  perform public.admin_guard();
  update public.teams set credits = greatest(credits + p_emails, 0) where id = p_team returning credits into v;
  return v;
end $$;
grant execute on function public.admin_grant_credits(uuid, bigint) to authenticated;

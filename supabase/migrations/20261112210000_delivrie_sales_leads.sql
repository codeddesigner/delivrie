-- Contact-sales leads from delivrie.io/contact-sales, and data retention that matches the pricing page and Privacy Policy.

create table if not exists public.sales_leads (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (char_length(first_name) between 1 and 80),
  last_name text not null check (char_length(last_name) between 1 and 80),
  email text not null check (char_length(email) between 3 and 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  company text not null check (char_length(company) between 1 and 120),
  volume text check (char_length(volume) <= 40),
  country text check (char_length(country) <= 60),
  message text check (char_length(message) <= 4000),
  created_at timestamptz not null default now()
);
alter table public.sales_leads enable row level security;
-- The public form can only add a lead. Nobody can read leads except through the admin functions.
grant insert on public.sales_leads to anon, authenticated;
create policy sales_leads_insert on public.sales_leads for insert to anon, authenticated with check (true);

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
    union all
    select 'sales'::text, l.id, l.created_at, l.email, l.company, (l.first_name || ' ' || l.last_name || ' · ' || coalesce(l.volume, '') || ' · ' || coalesce(l.country, '')), coalesce(l.message, ''), null::text
      from public.sales_leads l
  ) x order by 3 desc limit least(greatest(p_limit, 1), 200);
end $$;
revoke execute on function public.admin_inbox(int) from public, anon;
grant execute on function public.admin_inbox(int) to authenticated;

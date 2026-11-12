-- Billing with Paystack: invoices, plan expiry, and locking plan columns to the server.

create table if not exists public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  reference text not null unique,
  plan text,
  amount bigint not null,          -- smallest unit (cents / kobo)
  currency text not null,
  status text not null,            -- success | failed
  card text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists billing_invoices_team on public.billing_invoices(team_id, created_at desc);
alter table public.billing_invoices enable row level security;
create policy billing_invoices_member_select on public.billing_invoices
  for select to authenticated using (public.is_team_member(team_id));

-- Plans and billing details may only be changed by the server (service role).
-- Admins can still rename the team, change its logo and edit the unsubscribe page.
revoke update on public.teams from authenticated;
grant update (name, avatar_url, unsubscribe_page, integrations) on public.teams to authenticated;

-- A cancelled subscription keeps its plan until the paid period ends, then drops to free.
create or replace function public.expire_cancelled_plans() returns void
language sql security definer set search_path = public as $$
  update public.teams
     set plan_transactional = 'free',
         billing = billing || jsonb_build_object('status', 'canceled', 'plan', 'free')
   where billing->>'status' = 'cancelling'
     and (billing->>'cancel_at')::timestamptz < now();
$$;
revoke execute on function public.expire_cancelled_plans() from public, anon, authenticated;
select cron.schedule('delivrie-billing-expire', '17 * * * *', $$select public.expire_cancelled_plans()$$);

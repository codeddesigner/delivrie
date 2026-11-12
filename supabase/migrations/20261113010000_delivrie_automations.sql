-- Automations (Figma 11.x): custom events, automations made of steps, and runs.

create table if not exists public.event_definitions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null check (name ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
  description text,
  fields jsonb not null default '[]'::jsonb,       -- [{ name, type, example }]
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (team_id, name)
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  email text,
  contact_id uuid references public.contacts(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists events_team_name on public.events(team_id, name, created_at desc);

create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null default 'Untitled automation' check (char_length(name) between 1 and 120),
  status text not null default 'draft' check (status in ('draft', 'live', 'paused')),
  trigger jsonb not null default '{"type":"event","event":""}'::jsonb,   -- {type:event,event,filter?} | {type:segment,segment_id} | {type:schedule,segment_id,every:day|week,at:"09:00",weekday?}
  steps jsonb not null default '{}'::jsonb,                             -- { id: { id, type, next?, yes?, no?, ...config } }
  start_step text,
  reentry text not null default 'once' check (reentry in ('once', 'always')),
  version int not null default 0,
  published_at timestamptz,
  next_fire_at timestamptz,                                             -- schedule triggers
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists automations_team on public.automations(team_id, updated_at desc);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  email text not null,
  data jsonb not null default '{}'::jsonb,
  trigger text,
  version int not null default 0,
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'canceled')),
  current_step text,
  next_at timestamptz default now(),
  log jsonb not null default '[]'::jsonb,
  error text,
  test boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists automation_runs_due on public.automation_runs(next_at) where status = 'running';
create index if not exists automation_runs_auto on public.automation_runs(automation_id, started_at desc);
create index if not exists automation_runs_contact on public.automation_runs(automation_id, email);

alter table public.event_definitions enable row level security;
alter table public.events enable row level security;
alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;
do $$ declare t text; begin
  foreach t in array array['event_definitions', 'automations'] loop
    execute format('create policy "%1$s_member_select" on public.%1$I for select to authenticated using (public.is_team_member(team_id))', t);
    execute format('create policy "%1$s_member_insert" on public.%1$I for insert to authenticated with check (public.is_team_member(team_id))', t);
    execute format('create policy "%1$s_member_update" on public.%1$I for update to authenticated using (public.is_team_member(team_id)) with check (public.is_team_member(team_id))', t);
    execute format('create policy "%1$s_member_delete" on public.%1$I for delete to authenticated using (public.is_team_member(team_id))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
  -- runs and events are written by the server; members can read them (and cancel runs)
  foreach t in array array['events', 'automation_runs'] loop
    execute format('create policy "%1$s_member_select" on public.%1$I for select to authenticated using (public.is_team_member(team_id))', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Segment triggers: adding a contact to a segment starts runs of live automations listening to that segment.
create or replace function public.automation_segment_enter() returns trigger
language plpgsql security definer set search_path = public as $$
declare a record; c record;
begin
  select id, email, team_id into c from public.contacts where id = new.contact_id;
  if c.id is null then return null; end if;
  for a in select * from public.automations
            where team_id = c.team_id and status = 'live' and trigger->>'type' = 'segment' and trigger->>'segment_id' = new.segment_id::text and start_step is not null loop
    if a.reentry = 'once' and exists (select 1 from public.automation_runs r where r.automation_id = a.id and r.email = c.email and not r.test) then continue; end if;
    insert into public.automation_runs(automation_id, team_id, contact_id, email, trigger, version, current_step, next_at)
    values (a.id, a.team_id, c.id, c.email, 'segment', a.version, a.start_step, now());
  end loop;
  return null;
end $$;
revoke execute on function public.automation_segment_enter() from public, anon, authenticated;
drop trigger if exists segment_contacts_automations on public.segment_contacts;
create trigger segment_contacts_automations after insert on public.segment_contacts for each row execute function public.automation_segment_enter();

-- Runner: every minute, pg_cron calls the automations function to advance due runs and fire schedules.
create or replace function public.run_automations_cron() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s text;
begin
  if not exists (select 1 from public.automation_runs where status = 'running' and next_at <= now())
     and not exists (select 1 from public.automations where status = 'live' and next_fire_at <= now()) then return; end if;
  select value into s from public.system_settings where key = 'cron_secret';
  perform net.http_post(
    url := 'https://hnjejflinvaoxbduxeiu.supabase.co/functions/v1/automations/cron',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', s),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
end $$;
revoke execute on function public.run_automations_cron() from public, anon, authenticated;
select cron.schedule('delivrie-automations', '* * * * *', $$select public.run_automations_cron()$$);

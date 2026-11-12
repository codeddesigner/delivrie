create extension if not exists pgcrypto with schema extensions;

-- ---------- Teams & people ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  last_team_id uuid,
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  avatar_url text,
  plan_transactional text not null default 'free',
  plan_marketing text not null default 'free',
  billing jsonb not null default '{}'::jsonb,
  unsubscribe_page jsonb not null default '{}'::jsonb,
  integrations jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','member')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index on public.team_members(user_id);

create table public.team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin','member')),
  token text not null unique default encode(extensions.gen_random_bytes(24),'hex'),
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.team_invites(team_id);

-- membership helpers (security definer so policies don't recurse)
create or replace function public.is_team_member(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.team_members where team_id = t and user_id = auth.uid());
$$;
create or replace function public.is_team_admin(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.team_members where team_id = t and user_id = auth.uid() and role = 'admin');
$$;

-- ---------- Domains ----------
create table public.domains (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  region text not null default 'eu-west-1',
  status text not null default 'not_started' check (status in ('not_started','pending','verified','failed','temporary_failure')),
  records jsonb not null default '[]'::jsonb,
  dkim_selector text not null default 'delivrie',
  sending_enabled boolean not null default true,
  receiving_enabled boolean not null default false,
  click_tracking boolean not null default false,
  open_tracking boolean not null default false,
  tls text not null default 'opportunistic' check (tls in ('opportunistic','enforced')),
  return_path text not null default 'send',
  provider text,
  config_set text,
  dns_found_at timestamptz,
  verified_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (team_id, name)
);
-- private key material: no RLS policies => only the service role can read it
create table public.domain_secrets (
  domain_id uuid primary key references public.domains(id) on delete cascade,
  dkim_private_key text not null,
  created_at timestamptz not null default now()
);

-- ---------- API keys ----------
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null unique,
  permission text not null default 'full' check (permission in ('full','sending')),
  domain_id uuid references public.domains(id) on delete cascade,
  last_used_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.api_keys(team_id);

-- ---------- Audience ----------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  email text not null,
  first_name text,
  last_name text,
  unsubscribed boolean not null default false,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, email)
);
create index on public.contacts(team_id, created_at desc);

create table public.contact_properties (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,49}$'),
  type text not null default 'string' check (type in ('string','number')),
  fallback text,
  created_at timestamptz not null default now(),
  unique (team_id, key)
);

create table public.segments (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create table public.segment_contacts (
  segment_id uuid not null references public.segments(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (segment_id, contact_id)
);
create index on public.segment_contacts(contact_id);

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  description text,
  default_subscription text not null default 'opt_in' check (default_subscription in ('opt_in','opt_out')),
  visibility text not null default 'public' check (visibility in ('public','private')),
  created_at timestamptz not null default now()
);
create table public.contact_topics (
  contact_id uuid not null references public.contacts(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  subscription text not null check (subscription in ('opt_in','opt_out')),
  updated_at timestamptz not null default now(),
  primary key (contact_id, topic_id)
);

-- ---------- Templates ----------
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  alias text,
  status text not null default 'draft' check (status in ('draft','published')),
  "from" text,
  reply_to text,
  subject text,
  content jsonb not null default '{"blocks":[]}'::jsonb,
  html text,
  text text,
  variables jsonb not null default '[]'::jsonb,
  published_version int,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, alias)
);
create table public.template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  version int not null,
  snapshot jsonb not null,
  published boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  unique (template_id, version)
);

-- ---------- Broadcasts ----------
create table public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null default 'Untitled',
  status text not null default 'draft' check (status in ('draft','scheduled','sending','sent','canceled')),
  "from" text,
  reply_to text,
  segment_id uuid references public.segments(id) on delete set null,
  topic_id uuid references public.topics(id) on delete set null,
  subject text,
  preview_text text,
  content jsonb not null default '{"blocks":[]}'::jsonb,
  html text,
  text text,
  scheduled_at timestamptz,
  sent_at timestamptz,
  recipients int,
  stamp_no int,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.broadcasts(team_id, created_at desc);

-- ---------- Emails & events ----------
create table public.emails (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  direction text not null default 'outbound' check (direction in ('outbound','inbound')),
  api_key_id uuid references public.api_keys(id) on delete set null,
  domain_id uuid references public.domains(id) on delete set null,
  broadcast_id uuid references public.broadcasts(id) on delete set null,
  template_id uuid references public.templates(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  "from" text not null,
  "to" text[] not null,
  cc text[],
  bcc text[],
  reply_to text[],
  subject text not null default '',
  html text,
  text text,
  headers jsonb not null default '{}'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'queued' check (status in ('queued','scheduled','sent','delivered','delivery_delayed','bounced','complained','opened','clicked','failed','canceled','received','suppressed')),
  error text,
  scheduled_at timestamptz,
  sent_at timestamptz,
  attempts int not null default 0,
  ses_message_id text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique (team_id, idempotency_key)
);
create index on public.emails(team_id, created_at desc);
create index on public.emails(status, scheduled_at) where status in ('queued','scheduled');
create index on public.emails(broadcast_id);
create index on public.emails(ses_message_id);

create table public.email_events (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null references public.emails(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.email_events(email_id, created_at);
create index on public.email_events(team_id, type, created_at);

create table public.email_shares (
  token text primary key default encode(extensions.gen_random_bytes(18),'hex'),
  email_id uuid not null references public.emails(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  expires_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.suppressions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  email text not null,
  reason text not null default 'manual' check (reason in ('bounce','complaint','manual','unsubscribe')),
  created_at timestamptz not null default now(),
  unique (team_id, email)
);

-- ---------- Webhooks ----------
create table public.webhooks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  endpoint text not null check (endpoint ~ '^https://'),
  events text[] not null,
  status text not null default 'enabled' check (status in ('enabled','disabled')),
  signing_secret text not null,
  created_at timestamptz not null default now()
);
create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references public.webhooks(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  status_code int,
  response_body text,
  attempts int not null default 0,
  delivered boolean not null default false,
  next_attempt_at timestamptz default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.webhook_deliveries(webhook_id, created_at desc);
create index on public.webhook_deliveries(next_attempt_at) where delivered = false;

-- ---------- Logs, support ----------
create table public.request_logs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  api_key_id uuid references public.api_keys(id) on delete set null,
  endpoint text not null,
  method text not null,
  status int not null,
  user_agent text,
  request_body jsonb,
  response_body jsonb,
  created_at timestamptz not null default now()
);
create index on public.request_logs(team_id, created_at desc);

create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  subject text not null,
  message text not null,
  impact text not null check (impact in ('low','medium','high','critical')),
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  page text,
  message text not null,
  created_at timestamptz not null default now()
);

-- private system settings (cron secret, signing secrets) - service role only
create table public.system_settings (
  key text primary key,
  value text not null
);
insert into public.system_settings(key, value) values
  ('cron_secret', encode(extensions.gen_random_bytes(32),'hex')),
  ('link_secret', encode(extensions.gen_random_bytes(32),'hex'));

-- ---------- New user -> profile ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- create team + admin membership atomically
create or replace function public.create_team(team_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.teams(name, created_by) values (trim(team_name), auth.uid()) returning id into t;
  insert into public.team_members(team_id, user_id, role) values (t, auth.uid(), 'admin');
  update public.profiles set last_team_id = t where id = auth.uid();
  return t;
end $$;

-- accept invite by token (invitee must be signed in with the invited email)
create or replace function public.accept_invite(invite_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv public.team_invites; uemail text;
begin
  select email into uemail from auth.users where id = auth.uid();
  select * into inv from public.team_invites where token = invite_token and status = 'pending';
  if inv.id is null then raise exception 'invite not found'; end if;
  if lower(inv.email) <> lower(uemail) then raise exception 'invite is for a different email'; end if;
  insert into public.team_members(team_id, user_id, role) values (inv.team_id, auth.uid(), inv.role)
    on conflict do nothing;
  update public.team_invites set status = 'accepted' where id = inv.id;
  update public.profiles set last_team_id = inv.team_id where id = auth.uid();
  return inv.team_id;
end $$;

-- updated_at triggers
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger t_contacts before update on public.contacts for each row execute function public.touch_updated_at();
create trigger t_templates before update on public.templates for each row execute function public.touch_updated_at();
create trigger t_broadcasts before update on public.broadcasts for each row execute function public.touch_updated_at();

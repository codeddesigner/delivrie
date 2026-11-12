-- Figma 12.1 receiving setup, 7.4 domain claims, 9.9 single sign-on, 9.10 connected apps (OAuth for MCP).

-- 12.1 Receiving on a subdomain, for every address or only the ones you list.
alter table public.domains add column if not exists receiving_subdomain text;          -- null = the domain itself
alter table public.domains add column if not exists receiving_mode text not null default 'all' check (receiving_mode in ('all', 'specific'));
alter table public.domains add column if not exists receiving_addresses text[] not null default '{}';
alter table public.domains add column if not exists receiving_verified_at timestamptz;

-- 7.4 Claim a domain that another team added, by proving DNS control.
create table if not exists public.domain_claims (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  region text not null default 'eu-west-1',
  token text not null,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'expired')),
  claimed_from uuid,
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default now() + interval '72 hours',
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists domain_claims_team on public.domain_claims(team_id, created_at desc);
alter table public.domain_claims enable row level security;
create policy domain_claims_member_select on public.domain_claims for select to authenticated using (public.is_team_member(team_id));
grant select on public.domain_claims to authenticated;

-- 9.9 Single sign-on (SAML). Saved by team admins; activated on the Supabase Auth side by Delivrie.
create table if not exists public.sso_configs (
  team_id uuid primary key references public.teams(id) on delete cascade,
  provider text not null default 'okta',
  sso_url text,
  entity_id text,
  certificate text,
  metadata_url text,
  domain text,
  enforce boolean not null default false,
  jit boolean not null default true,
  status text not null default 'draft' check (status in ('draft', 'requested', 'active')),
  supabase_provider_id text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.sso_configs enable row level security;
create policy sso_member_select on public.sso_configs for select to authenticated using (public.is_team_member(team_id));
create policy sso_admin_insert on public.sso_configs for insert to authenticated with check (public.is_team_admin(team_id) and status <> 'active');
create policy sso_admin_update on public.sso_configs for update to authenticated using (public.is_team_admin(team_id)) with check (public.is_team_admin(team_id));
grant select, insert, update on public.sso_configs to authenticated;
-- members can't flip a config to active themselves
create or replace function public.sso_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if auth.role() = 'authenticated' and new.status = 'active' and (tg_op = 'INSERT' or old.status <> 'active') then new.status := 'requested'; end if;
  if auth.role() = 'authenticated' and tg_op = 'UPDATE' then new.supabase_provider_id := old.supabase_provider_id; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists sso_configs_guard on public.sso_configs;
create trigger sso_configs_guard before insert or update on public.sso_configs for each row execute function public.sso_guard();

-- Which team an SSO email domain belongs to (for the sign-in page). Returns only whether SSO is active.
create or replace function public.sso_for_email(p_email text) returns table(domain text, enforce boolean)
language sql stable security definer set search_path = public as $$
  select s.domain, s.enforce from public.sso_configs s
   where s.status = 'active' and s.domain is not null and lower(split_part(p_email, '@', 2)) = lower(s.domain) limit 1;
$$;
grant execute on function public.sso_for_email(text) to anon, authenticated;

-- 9.10 Connected apps: OAuth 2.1 (PKCE + dynamic client registration) for MCP clients.
create table if not exists public.oauth_clients (
  id text primary key,
  name text not null,
  redirect_uris text[] not null,
  logo_uri text,
  client_uri text,
  created_at timestamptz not null default now()
);
create table if not exists public.oauth_codes (
  code_hash text primary key,
  client_id text not null references public.oauth_clients(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scopes text[] not null,
  redirect_uri text not null,
  code_challenge text not null,
  expires_at timestamptz not null default now() + interval '10 minutes',
  used boolean not null default false
);
create table if not exists public.oauth_grants (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.oauth_clients(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  scopes text[] not null,
  access_hash text unique,
  refresh_hash text unique,
  access_expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists oauth_grants_team on public.oauth_grants(team_id, created_at desc);
alter table public.oauth_clients enable row level security;
alter table public.oauth_codes enable row level security;
alter table public.oauth_grants enable row level security;
create policy oauth_clients_read on public.oauth_clients for select to authenticated using (true);
grant select on public.oauth_clients to authenticated;
-- members see their team's connected apps (no token hashes: column grants below)
create policy oauth_grants_member_select on public.oauth_grants for select to authenticated using (public.is_team_member(team_id));
revoke all on public.oauth_grants from authenticated;
grant select (id, client_id, team_id, user_id, scopes, last_used_at, revoked_at, created_at) on public.oauth_grants to authenticated;

create or replace function public.revoke_oauth_grant(p_grant uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  select team_id into t from public.oauth_grants where id = p_grant;
  if t is null or not public.is_team_admin(t) then raise exception 'Only team admins can revoke connected apps'; end if;
  update public.oauth_grants set revoked_at = now(), access_hash = null, refresh_hash = null where id = p_grant and revoked_at is null;
end $$;
grant execute on function public.revoke_oauth_grant(uuid) to authenticated;

-- Who authorized each app (names for the Connected apps list).
create or replace function public.oauth_grants_for_team(p_team uuid)
returns table(id uuid, client_id text, client_name text, client_uri text, scopes text[], authorized_by text, last_used_at timestamptz, revoked_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select g.id, g.client_id, c.name, c.client_uri, g.scopes, coalesce(p.full_name, p.email), g.last_used_at, g.revoked_at, g.created_at
    from public.oauth_grants g join public.oauth_clients c on c.id = g.client_id left join public.profiles p on p.id = g.user_id
   where g.team_id = p_team and public.is_team_member(p_team)
   order by g.revoked_at nulls first, g.created_at desc;
$$;
grant execute on function public.oauth_grants_for_team(uuid) to authenticated;

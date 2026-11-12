-- Inbox (Figma 12.3): a shared inbox on top of receiving. Received emails are grouped into threads by
-- Message-ID / In-Reply-To / References (falling back to sender + subject); replies sent from the Inbox join the same thread.

create table if not exists public.inbox_labels (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text not null default '#8a8f98',
  created_at timestamptz not null default now(),
  unique (team_id, name)
);

create table if not exists public.inbox_threads (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  mailbox text not null,                 -- the address mail arrived at, e.g. support@in.kora.ng
  contact text not null,                 -- the other party's address
  contact_name text,
  subject text not null default '',
  snippet text not null default '',
  message_count int not null default 0,
  unread boolean not null default true,
  status text not null default 'open' check (status in ('open', 'archived')),
  labels uuid[] not null default '{}',
  last_at timestamptz not null default now(),
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists inbox_threads_team on public.inbox_threads(team_id, mailbox, last_at desc);

alter table public.emails add column if not exists thread_id uuid references public.inbox_threads(id) on delete set null;
create index if not exists emails_thread on public.emails(thread_id, created_at);

alter table public.inbox_labels enable row level security;
alter table public.inbox_threads enable row level security;
do $$ declare t text; begin
  foreach t in array array['inbox_labels', 'inbox_threads'] loop
    execute format('create policy "%1$s_member_select" on public.%1$I for select to authenticated using (public.is_team_member(team_id))', t);
    execute format('create policy "%1$s_member_insert" on public.%1$I for insert to authenticated with check (public.is_team_member(team_id))', t);
    execute format('create policy "%1$s_member_update" on public.%1$I for update to authenticated using (public.is_team_member(team_id)) with check (public.is_team_member(team_id))', t);
    execute format('create policy "%1$s_member_delete" on public.%1$I for delete to authenticated using (public.is_team_member(team_id))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- helpers
create or replace function public.email_addr(s text) returns text language sql immutable as $$
  select lower(coalesce(substring(s from '<([^>]+)>'), trim(s)));
$$;
create or replace function public.email_name(s text) returns text language sql immutable as $$
  select nullif(trim(both ' "' from split_part(s, '<', 1)), '');
$$;
create or replace function public.base_subject(s text) returns text language sql immutable as $$
  select lower(trim(regexp_replace(coalesce(s, ''), '^\s*((re|fw|fwd|aw|sv)\s*(\[\d+\])?\s*:\s*)+', '', 'i')));
$$;
-- Message ids referenced by an email: In-Reply-To and References, without brackets.
create or replace function public.email_refs(h jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct m[1]), '{}') from regexp_matches(
    coalesce(h->>'in-reply-to', h->>'In-Reply-To', '') || ' ' || coalesce(h->>'references', h->>'References', ''), '<([^>]+)>', 'g') as m;
$$;

create or replace function public.inbox_assign_thread() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  refs text[]; tid uuid; mbox text; party text; snip text; inbound boolean := new.direction = 'inbound'; ts timestamptz := coalesce(new.created_at, now());
begin
  if new.thread_id is not null then return new; end if;
  refs := public.email_refs(new.headers);
  if not inbound and coalesce(array_length(refs, 1), 0) = 0 then return new; end if;  -- ordinary sends stay out of the Inbox

  -- 1. a message this email replies to
  if coalesce(array_length(refs, 1), 0) > 0 then
    select e.thread_id into tid from public.emails e
     where e.team_id = new.team_id and e.thread_id is not null
       and (e.headers->>'message-id' is not null and trim(both '<>' from e.headers->>'message-id') = any(refs)
            or e.ses_message_id is not null and exists (select 1 from unnest(refs) r where split_part(r, '@', 1) = e.ses_message_id))
     order by e.created_at desc limit 1;
  end if;

  if inbound then
    select public.email_addr(a) into mbox from unnest(new."to") a
      join public.domains d on d.team_id = new.team_id and d.receiving_enabled
        and (split_part(public.email_addr(a), '@', 2) = d.name or split_part(public.email_addr(a), '@', 2) like '%.' || d.name)
     limit 1;
    mbox := coalesce(mbox, public.email_addr(new."to"[1]));
    party := public.email_addr(new."from");
    -- 2. same sender and subject in the last 30 days
    if tid is null then
      select id into tid from public.inbox_threads
       where team_id = new.team_id and mailbox = mbox and contact = party
         and public.base_subject(subject) = public.base_subject(new.subject) and last_at > ts - interval '30 days'
       order by last_at desc limit 1;
    end if;
    if tid is null then
      insert into public.inbox_threads(team_id, mailbox, contact, contact_name, subject, last_at, created_at)
      values (new.team_id, mbox, party, public.email_name(new."from"), coalesce(nullif(new.subject, ''), '(no subject)'), ts, ts)
      returning id into tid;
    end if;
  end if;
  if tid is null then return new; end if;

  new.thread_id := tid;
  snip := left(regexp_replace(coalesce(new.text, regexp_replace(coalesce(new.html, ''), '<[^>]*>', ' ', 'g')), '\s+', ' ', 'g'), 160);
  update public.inbox_threads set
    message_count = message_count + 1,
    snippet = coalesce(nullif(trim(snip), ''), snippet),
    last_at = greatest(last_at, ts),
    last_inbound_at = case when inbound then greatest(coalesce(last_inbound_at, ts), ts) else last_inbound_at end,
    last_outbound_at = case when inbound then last_outbound_at else greatest(coalesce(last_outbound_at, ts), ts) end,
    unread = inbound or unread,
    status = case when inbound then 'open' else status end
   where id = tid;
  return new;
end $$;
revoke execute on function public.inbox_assign_thread() from public, anon, authenticated;
drop trigger if exists emails_inbox_thread on public.emails;
create trigger emails_inbox_thread before insert or update of headers on public.emails for each row execute function public.inbox_assign_thread();

-- Put mail received before the Inbox existed into threads.
update public.emails set headers = headers where direction = 'inbound' and thread_id is null;

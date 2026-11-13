-- Support chat: customers message the Delivrie team from the dashboard; admins reply from Admin → Support.
-- Everything goes through the delivrie edge function (service role), so the tables have no public policies.

create table if not exists public.support_threads (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  email text,
  status text not null default 'open' check (status in ('open', 'closed')),
  last_message_at timestamptz not null default now(),
  last_author text check (last_author in ('customer', 'support')),
  last_preview text,
  unread_support int not null default 0,   -- customer messages the team hasn't read
  unread_customer int not null default 0,  -- replies the customer hasn't read
  customer_seen_at timestamptz,
  support_notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists support_threads_user on public.support_threads(user_id, last_message_at desc);
create index if not exists support_threads_status on public.support_threads(status, last_message_at desc);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.support_threads(id) on delete cascade,
  author text not null check (author in ('customer', 'support')),
  user_id uuid references auth.users(id) on delete set null,
  author_name text,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index if not exists support_messages_thread on public.support_messages(thread_id, created_at);

alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;

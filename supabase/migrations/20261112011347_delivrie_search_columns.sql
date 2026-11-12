create or replace function public.immutable_array_to_text(a text[]) returns text language sql immutable parallel safe set search_path = public as $$ select array_to_string(a, ',') $$;
alter table public.emails add column if not exists to_text text generated always as (lower(public.immutable_array_to_text("to"))) stored;
create index if not exists emails_team_dir_created on public.emails(team_id, direction, created_at desc);
alter table public.contacts add column if not exists search text generated always as (lower(coalesce(email,'') || ' ' || coalesce(first_name,'') || ' ' || coalesce(last_name,''))) stored;

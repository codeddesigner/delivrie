-- Template folders (Figma 4.4): group templates into folders and move them from the row menu.
create table if not exists public.template_folders (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (team_id, name)
);
alter table public.template_folders enable row level security;
create policy template_folders_member_select on public.template_folders for select to authenticated using (public.is_team_member(team_id));
create policy template_folders_member_insert on public.template_folders for insert to authenticated with check (public.is_team_member(team_id));
create policy template_folders_member_update on public.template_folders for update to authenticated using (public.is_team_member(team_id)) with check (public.is_team_member(team_id));
create policy template_folders_member_delete on public.template_folders for delete to authenticated using (public.is_team_member(team_id));
grant select, insert, update, delete on public.template_folders to authenticated;
alter table public.templates add column if not exists folder_id uuid references public.template_folders(id) on delete set null;
create index if not exists templates_folder on public.templates(folder_id);

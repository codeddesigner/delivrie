insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('email-assets','email-assets', true, 5242880, array['image/png','image/jpeg','image/gif','image/webp'])
on conflict (id) do nothing;
create policy "team members upload email assets" on storage.objects for insert to authenticated
  with check (bucket_id = 'email-assets' and public.is_team_member(((storage.foldername(name))[1])::uuid));
create policy "team members delete email assets" on storage.objects for delete to authenticated
  using (bucket_id = 'email-assets' and public.is_team_member(((storage.foldername(name))[1])::uuid));
grant execute on function public.is_team_member(uuid) to authenticated;

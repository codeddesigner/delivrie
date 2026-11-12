revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.create_team(text) from public, anon;
revoke execute on function public.accept_invite(text) from public, anon;
revoke execute on function public.is_team_member(uuid) from public, anon;
revoke execute on function public.is_team_admin(uuid) from public, anon;
grant execute on function public.is_team_member(uuid), public.is_team_admin(uuid), public.create_team(text), public.accept_invite(text) to authenticated;
revoke execute on function public.email_metrics(uuid,timestamptz,uuid), public.domain_volume(uuid,timestamptz), public.segment_stats(uuid), public.team_usage(uuid), public.broadcast_stats(uuid) from public, anon;
alter function public.touch_updated_at() set search_path = public;

do $$
declare t text;
begin
  foreach t in array array['profiles','teams','team_members','team_invites','domains','domain_secrets','api_keys','contacts','contact_properties','segments','segment_contacts','topics','contact_topics','templates','template_versions','broadcasts','emails','email_events','email_shares','suppressions','webhooks','webhook_deliveries','request_logs','support_requests','feedback','system_settings']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  -- full CRUD for team members
  foreach t in array array['contacts','contact_properties','segments','segment_contacts','topics','contact_topics','templates','template_versions','broadcasts','suppressions','webhooks','api_keys','email_shares']
  loop
    execute format('create policy "%1$s_member_select" on public.%1$I for select to authenticated using (public.is_team_member(team_id))', t);
    execute format('create policy "%1$s_member_insert" on public.%1$I for insert to authenticated with check (public.is_team_member(team_id))', t);
    execute format('create policy "%1$s_member_update" on public.%1$I for update to authenticated using (public.is_team_member(team_id)) with check (public.is_team_member(team_id))', t);
    execute format('create policy "%1$s_member_delete" on public.%1$I for delete to authenticated using (public.is_team_member(team_id))', t);
  end loop;
  -- read-only for team members (writes happen server-side)
  foreach t in array array['domains','emails','email_events','webhook_deliveries','request_logs']
  loop
    execute format('create policy "%1$s_member_select" on public.%1$I for select to authenticated using (public.is_team_member(team_id))', t);
  end loop;
end $$;

-- profiles
create policy profiles_self_select on public.profiles for select to authenticated
  using (id = auth.uid() or exists (select 1 from public.team_members m1 join public.team_members m2 on m1.team_id = m2.team_id where m1.user_id = auth.uid() and m2.user_id = profiles.id));
create policy profiles_self_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- teams
create policy teams_member_select on public.teams for select to authenticated using (public.is_team_member(id));
create policy teams_admin_update on public.teams for update to authenticated using (public.is_team_admin(id)) with check (public.is_team_admin(id));
create policy teams_admin_delete on public.teams for delete to authenticated using (public.is_team_admin(id));

-- team members
create policy tm_select on public.team_members for select to authenticated using (public.is_team_member(team_id));
create policy tm_admin_update on public.team_members for update to authenticated using (public.is_team_admin(team_id)) with check (public.is_team_admin(team_id));
create policy tm_admin_or_self_delete on public.team_members for delete to authenticated using (public.is_team_admin(team_id) or user_id = auth.uid());

-- invites
create policy ti_member_select on public.team_invites for select to authenticated using (public.is_team_member(team_id));
create policy ti_admin_insert on public.team_invites for insert to authenticated with check (public.is_team_admin(team_id));
create policy ti_admin_update on public.team_invites for update to authenticated using (public.is_team_admin(team_id)) with check (public.is_team_admin(team_id));
create policy ti_admin_delete on public.team_invites for delete to authenticated using (public.is_team_admin(team_id));

-- support & feedback
create policy sr_insert on public.support_requests for insert to authenticated with check (user_id = auth.uid());
create policy sr_select on public.support_requests for select to authenticated using (user_id = auth.uid());
create policy fb_insert on public.feedback for insert to authenticated with check (user_id = auth.uid());
create policy fb_select on public.feedback for select to authenticated using (user_id = auth.uid());

-- ---------- RPCs for the dashboard (security invoker => RLS applies) ----------
create or replace function public.email_metrics(p_team uuid, p_since timestamptz, p_domain uuid default null)
returns table(day date, sent bigint, delivered bigint, opened bigint, clicked bigint, bounced bigint, complained bigint)
language sql stable set search_path = public as $$
  with days as (
    select generate_series(date_trunc('day', p_since)::date, current_date, interval '1 day')::date as day
  ), ev as (
    select date_trunc('day', ev.created_at)::date as day, ev.type
    from public.email_events ev join public.emails e on e.id = ev.email_id
    where ev.team_id = p_team and ev.created_at >= p_since and e.direction = 'outbound'
      and (p_domain is null or e.domain_id = p_domain)
  )
  select d.day,
    count(*) filter (where ev.type = 'sent'),
    count(*) filter (where ev.type = 'delivered'),
    count(*) filter (where ev.type = 'opened'),
    count(*) filter (where ev.type = 'clicked'),
    count(*) filter (where ev.type = 'bounced'),
    count(*) filter (where ev.type = 'complained')
  from days d left join ev on ev.day = d.day
  group by d.day order by d.day;
$$;

create or replace function public.domain_volume(p_team uuid, p_since timestamptz)
returns table(domain_id uuid, emails bigint, delivered bigint)
language sql stable set search_path = public as $$
  select e.domain_id, count(*), count(*) filter (where e.status in ('delivered','opened','clicked'))
  from public.emails e
  where e.team_id = p_team and e.created_at >= p_since and e.direction = 'outbound' and e.domain_id is not null
  group by e.domain_id;
$$;

create or replace function public.segment_stats(p_team uuid)
returns table(segment_id uuid, contacts bigint, unsubscribed bigint)
language sql stable set search_path = public as $$
  select s.id, count(sc.contact_id), count(sc.contact_id) filter (where c.unsubscribed)
  from public.segments s
  left join public.segment_contacts sc on sc.segment_id = s.id
  left join public.contacts c on c.id = sc.contact_id
  where s.team_id = p_team
  group by s.id;
$$;

create or replace function public.team_usage(p_team uuid)
returns json language sql stable set search_path = public as $$
  select json_build_object(
    'month', (select count(*) from public.emails where team_id = p_team and direction='outbound' and broadcast_id is null and created_at >= date_trunc('month', now()) and status not in ('failed','canceled','suppressed')),
    'day', (select count(*) from public.emails where team_id = p_team and direction='outbound' and broadcast_id is null and created_at >= date_trunc('day', now()) and status not in ('failed','canceled','suppressed')),
    'contacts', (select count(*) from public.contacts where team_id = p_team),
    'segments', (select count(*) from public.segments where team_id = p_team),
    'broadcasts', (select count(*) from public.broadcasts where team_id = p_team),
    'domains', (select count(*) from public.domains where team_id = p_team),
    'members', (select count(*) from public.team_members where team_id = p_team),
    'api_keys', (select count(*) from public.api_keys where team_id = p_team),
    'webhooks', (select count(*) from public.webhooks where team_id = p_team)
  );
$$;

create or replace function public.broadcast_stats(p_broadcast uuid)
returns json language sql stable set search_path = public as $$
  select json_build_object(
    'total', count(*),
    'delivered', count(*) filter (where status in ('delivered','opened','clicked','complained')),
    'bounced', count(*) filter (where status = 'bounced'),
    'suppressed', count(*) filter (where status = 'suppressed'),
    'opened', count(*) filter (where status in ('opened','clicked')),
    'clicked', count(*) filter (where status = 'clicked'),
    'complained', count(*) filter (where status = 'complained'),
    'unsubscribed', (select count(*) from public.email_events ev where ev.type = 'unsubscribed' and ev.email_id in (select id from public.emails where broadcast_id = p_broadcast))
  ) from public.emails where broadcast_id = p_broadcast;
$$;

grant execute on function public.create_team(text), public.accept_invite(text), public.email_metrics(uuid,timestamptz,uuid), public.domain_volume(uuid,timestamptz), public.segment_stats(uuid), public.team_usage(uuid), public.broadcast_stats(uuid) to authenticated;
revoke execute on function public.create_team(text), public.accept_invite(text) from anon;

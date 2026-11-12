-- NOT APPLIED YET: turns on the retention promised on the pricing page and in the Privacy Policy.
-- It permanently clears email bodies and attachments after the plan's retention window. Apply once you approve.

-- Retention: email bodies and attachments are kept 1 day on Free, 3 on Pro, 7 on Scale, 30 on Enterprise.
-- Recipients, status and timestamps stay so logs, metrics and suppressions keep working. API request logs: 30 days.
create or replace function public.purge_expired_content() returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.emails e
     set html = null, text = null, attachments = '[]'::jsonb
    from public.teams t
   where t.id = e.team_id
     and e.status not in ('queued', 'scheduled')
     and (e.html is not null or e.text is not null or e.attachments <> '[]'::jsonb)
     and e.created_at < now() - make_interval(days => case t.plan_transactional when 'pro' then 3 when 'scale' then 7 when 'enterprise' then 30 else 1 end);
  delete from public.request_logs where created_at < now() - interval '30 days';
end $$;
revoke execute on function public.purge_expired_content() from public, anon, authenticated;
select cron.schedule('delivrie-retention', '41 * * * *', $$select public.purge_expired_content()$$);

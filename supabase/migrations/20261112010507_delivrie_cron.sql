create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.run_delivrie_cron() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s text;
begin
  select value into s from public.system_settings where key = 'cron_secret';
  perform net.http_post(
    url := 'https://hnjejflinvaoxbduxeiu.supabase.co/functions/v1/delivrie/cron',
    headers := jsonb_build_object('content-type','application/json','x-cron-secret', s),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end $$;
revoke execute on function public.run_delivrie_cron() from public, anon, authenticated;

select cron.schedule('delivrie-every-minute', '* * * * *', $$select public.run_delivrie_cron()$$);

-- contact webhooks for changes made directly in the dashboard (API writes emit their own)
create or replace function public.enqueue_contact_webhook() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare r record; t text; payload jsonb; evt text := 'evt_' || encode(gen_random_bytes(9),'hex'); row_data record;
begin
  if tg_op = 'INSERT' then t := 'contact.created'; row_data := new;
  elsif tg_op = 'UPDATE' then t := 'contact.updated'; row_data := new;
  else t := 'contact.deleted'; row_data := old; end if;
  -- the API path already emits; skip when called by the service role
  if coalesce(auth.role(), '') = 'service_role' then return null; end if;
  payload := jsonb_build_object('type', t, 'created_at', now(), 'data', jsonb_build_object('id', row_data.id, 'email', row_data.email, 'first_name', row_data.first_name, 'last_name', row_data.last_name, 'unsubscribed', row_data.unsubscribed));
  for r in select id from public.webhooks where team_id = row_data.team_id and status = 'enabled' and (t = any(events) or '*' = any(events)) loop
    insert into public.webhook_deliveries(webhook_id, team_id, event_id, event_type, payload, next_attempt_at) values (r.id, row_data.team_id, evt, t, payload, now());
  end loop;
  return null;
end $$;
revoke execute on function public.enqueue_contact_webhook() from public, anon, authenticated;
create trigger contacts_webhooks after insert or update or delete on public.contacts
  for each row execute function public.enqueue_contact_webhook();

-- Two asks from the hotel:
--   1) The existing "unclaimed > 3 min" / "stalled > 10 min" escalation
--      (use-request-alerts.ts) only ever shows a toast to whoever happens
--      to have the dashboard open right now -- it notifies nobody else.
--      Move the actual notification server-side: a scheduled job scans for
--      requests crossing either threshold and pushes whoever is on duty,
--      the same recipient rule (housekeeping_push_recipient_profiles,
--      already on_duty-gated) already used for urgent/priority pushes.
--      The in-tab toast in use-request-alerts.ts is untouched -- this adds
--      the "reaches people who don't have the tab open" path on top of it,
--      it doesn't replace it.
--   2) A manual "sollecito": reception can nudge whoever currently has an
--      in-progress request in charge, instead of waiting for the 10-minute
--      auto-escalation.
--
-- Both reuse the existing notify-request-event Edge Function (deployed
-- separately) and its pg_net-direct trigger pattern (20260918150000's own
-- header explains why embedding the anon key is fine here).
begin;

alter table guest_requests
  add column unclaimed_alert_sent_at timestamptz,
  add column stalled_alert_sent_at timestamptz;

-- Scans for requests crossing either escalation threshold and pushes once
-- per request per threshold (the *_alert_sent_at columns are the durable
-- equivalent of use-request-alerts.ts's own in-memory firedRef Set, so a
-- request already alerted doesn't get re-notified on every cron tick).
create or replace function escalate_guest_requests() returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in
    select id, hotel_id, room_number, assigned_job_title_ids
    from guest_requests
    where status = 'requested'
      and rejected_at is null
      and archived_at is null
      and created_at <= now() - interval '3 minutes'
      and unclaimed_alert_sent_at is null
  loop
    update guest_requests set unclaimed_alert_sent_at = now() where id = r.id;
    perform net.http_post(
      url := 'https://flyedzqqdrxxtxchoeer.supabase.co/functions/v1/notify-request-event',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZseWVkenFxZHJ4eHR4Y2hvZWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4OTUwNTQsImV4cCI6MjEwMzQ3MTA1NH0.c6z6VldYjWf-ITHgAh1bhBHAaoc75uP1jlZo-E0YdTo'
      ),
      body := jsonb_build_object('type', 'unclaimed', 'table', 'guest_requests', 'record', to_jsonb(r))
    );
  end loop;

  for r in
    select id, hotel_id, room_number, assigned_job_title_ids
    from guest_requests
    where status = 'in_progress'
      and archived_at is null
      and accepted_at <= now() - interval '10 minutes'
      and stalled_alert_sent_at is null
  loop
    update guest_requests set stalled_alert_sent_at = now() where id = r.id;
    perform net.http_post(
      url := 'https://flyedzqqdrxxtxchoeer.supabase.co/functions/v1/notify-request-event',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZseWVkenFxZHJ4eHR4Y2hvZWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4OTUwNTQsImV4cCI6MjEwMzQ3MTA1NH0.c6z6VldYjWf-ITHgAh1bhBHAaoc75uP1jlZo-E0YdTo'
      ),
      body := jsonb_build_object('type', 'stalled', 'table', 'guest_requests', 'record', to_jsonb(r))
    );
  end loop;
end;
$$;

revoke all on function escalate_guest_requests() from public, anon, authenticated;

-- Fires every minute; re-running this migration (cron.schedule on an
-- existing job name updates it in place) keeps this idempotent.
select cron.schedule('escalate-guest-requests', '* * * * *', $$select escalate_guest_requests();$$);

-- Manual "sollecito": only for a request that's actually in_progress and
-- claimed, gated the same way the existing guest_requests_update_hotel RLS
-- policy already gates claim/reject/reassign on this same row (admin/master,
-- a full-queue job title, or assigned by mansione) -- "can manage this
-- request" is the one authorization boundary this app already has for
-- acting on someone else's claimed request; a reminder is a lighter action
-- than reassigning or rejecting it, not a reason to invent a separate one.
create or replace function send_request_reminder(p_request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v record;
begin
  select id, hotel_id, room_number, status, accepted_by, assigned_job_title_ids
    into v from guest_requests where id = p_request_id;

  if v.id is null then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  if v.hotel_id <> current_staff_hotel() then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;
  if not (
    current_staff_role() = any (array['admin'::staff_role, 'master'::staff_role])
    or current_staff_sees_full_queue()
    or current_staff_job_title_id() = any (v.assigned_job_title_ids)
  ) then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;
  if v.status <> 'in_progress' or v.accepted_by is null then
    raise exception 'not_in_progress' using errcode = '22023';
  end if;

  perform net.http_post(
    url := 'https://flyedzqqdrxxtxchoeer.supabase.co/functions/v1/notify-request-event',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZseWVkenFxZHJ4eHR4Y2hvZWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4OTUwNTQsImV4cCI6MjEwMzQ3MTA1NH0.c6z6VldYjWf-ITHgAh1bhBHAaoc75uP1jlZo-E0YdTo'
    ),
    body := jsonb_build_object(
      'type', 'reminder',
      'table', 'guest_requests',
      'record', to_jsonb(v),
      'target_staff_id', v.accepted_by
    )
  );
end;
$$;

revoke all on function send_request_reminder(uuid) from public, anon;
grant execute on function send_request_reminder(uuid) to authenticated;

commit;

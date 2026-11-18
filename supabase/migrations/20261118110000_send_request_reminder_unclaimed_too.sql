-- send_request_reminder only ever worked for an already-claimed request
-- (pushing the one person who has it in charge) -- reception also wants
-- to use "Sollecita" on a still-unclaimed one, in "Nuove richieste",
-- before the automatic 3-minute escalation fires. For that case there's
-- nobody specific to target yet, so it broadcasts to whoever is on duty
-- for the request's department, the same recipient rule and 'unclaimed'
-- notification text escalate_guest_requests() already uses -- this is
-- just that same push, fired on demand instead of waiting for the cron.
begin;

create or replace function send_request_reminder(p_request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_event_type text;
begin
  select id, hotel_id, room_number, status, accepted_by, rejected_at, assigned_job_title_ids
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

  if v.status = 'in_progress' and v.accepted_by is not null then
    v_event_type := 'reminder';
  elsif v.status = 'requested' and v.rejected_at is null then
    v_event_type := 'unclaimed';
  else
    raise exception 'not_remindable' using errcode = '22023';
  end if;

  perform net.http_post(
    url := 'https://flyedzqqdrxxtxchoeer.supabase.co/functions/v1/notify-request-event',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZseWVkenFxZHJ4eHR4Y2hvZWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4OTUwNTQsImV4cCI6MjEwMzQ3MTA1NH0.c6z6VldYjWf-ITHgAh1bhBHAaoc75uP1jlZo-E0YdTo'
    ),
    body := jsonb_build_object(
      'type', v_event_type,
      'table', 'guest_requests',
      'record', to_jsonb(v),
      'target_staff_id', v.accepted_by
    )
  );
end;
$$;

commit;

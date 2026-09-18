-- Push notifications for two more guest_requests events, on top of the
-- existing new-request webhook (20260827121300/122700): a manual priority
-- reorder, and a request being flagged urgent. Same pg_net-direct pattern
-- (this project's Studio doesn't expose the Database Webhooks UI), same
-- live project host and public anon key already embedded in
-- notify_new_request() -- see that migration's header for why embedding
-- the anon key here is fine (it's the project's public key, already
-- shipped in the web bundle, not a secret).
--
-- One function, parameterized by TG_ARGV[0] via the trigger definition
-- itself, rather than one copy-pasted function per event -- both events
-- post the same shape (type/table/record/old_record) to the same new
-- Edge Function (notify-request-event, deployed separately; see its
-- source under supabase/functions/notify-request-event), which decides
-- who to notify and what to say per type.
--
-- WHEN clauses do the event filtering at the trigger level so the function
-- body itself doesn't need to inspect OLD/NEW to decide whether to fire:
--   - priority_changed: any change to priority, in either direction.
--   - urgent_flagged: only the transition into urgent = true. Clearing the
--     flag deliberately does not notify -- unflagging isn't the kind of
--     event anyone needs to be paged for.
begin;

create function notify_guest_request_webhook() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://flyedzqqdrxxtxchoeer.supabase.co/functions/v1/notify-request-event',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZseWVkenFxZHJ4eHR4Y2hvZWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4OTUwNTQsImV4cCI6MjEwMzQ3MTA1NH0.c6z6VldYjWf-ITHgAh1bhBHAaoc75uP1jlZo-E0YdTo'
    ),
    body := jsonb_build_object('type', TG_ARGV[0], 'table', 'guest_requests', 'record', to_jsonb(NEW), 'old_record', to_jsonb(OLD))
  );
  return NEW;
end;
$$;

create trigger guest_requests_notify_priority_changed
  after update on guest_requests
  for each row
  when (OLD.priority is distinct from NEW.priority)
  execute function notify_guest_request_webhook('priority_changed');

create trigger guest_requests_notify_urgent_flagged
  after update on guest_requests
  for each row
  when (OLD.urgent is distinct from NEW.urgent and NEW.urgent)
  execute function notify_guest_request_webhook('urgent_flagged');

commit;

-- Server-side safety net for the 8h-inactivity auto-off-duty rule: the
-- client-side idle timer only works while the tab stays open continuously
-- for the full 8 hours. If someone just closes the browser, locks the
-- device, or it sleeps, that JS timer never runs and on_duty stays true
-- forever -- exactly what "Chi è in turno" was showing. last_seen_at is a
-- lightweight heartbeat the client touches periodically while actually
-- open; a scheduled job then flips on_duty off for anyone whose heartbeat
-- went stale, independent of whether their tab is still running.
alter table staff_profiles add column if not exists last_seen_at timestamptz;

create or replace function touch_staff_presence()
returns void
language sql
security definer
set search_path = public
as $$
  update staff_profiles set last_seen_at = now() where auth_user_id = auth.uid();
$$;
revoke all on function touch_staff_presence() from public;
grant execute on function touch_staff_presence() to authenticated;

-- Going on/off duty explicitly is itself a real, current heartbeat.
create or replace function set_on_duty(p_on_duty boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update staff_profiles set on_duty = p_on_duty, last_seen_at = now() where auth_user_id = auth.uid();
$$;

-- One-time grace period: give every currently on-duty profile a fresh
-- heartbeat as of this migration, so the sweep below doesn't sign
-- everyone off before the client code that actually calls
-- touch_staff_presence() has had a chance to ship.
update staff_profiles set last_seen_at = now() where on_duty and last_seen_at is null;

select cron.schedule(
  'auto-off-duty-stale-presence',
  '*/15 * * * *',
  $$
    update staff_profiles
    set on_duty = false
    where on_duty
      and (last_seen_at is null or last_seen_at < now() - interval '8 hours')
  $$
);

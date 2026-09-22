-- device_push_subscriptions_owner (20260912100000_device_push_subscriptions.sql)
-- is a single `for all using (profile_id = auth.uid()) with check (profile_id
-- = auth.uid())` policy. For an UPDATE, Postgres RLS evaluates `using`
-- against the EXISTING row and `with check` against the NEW row -- both must
-- pass. That makes the table's own documented "shared device" behavior
-- impossible: saveDevicePushSubscription() (packages/core-sdk/src/
-- devicePush.ts) upserts on `on_conflict: 'endpoint'`, and its own comment
-- says "re-subscribing the same browser/device transfers the row to whoever
-- is currently signed in on it, which is the correct behavior for a shared
-- device" -- but whenever the endpoint's existing row belongs to a DIFFERENT
-- profile, `using` rejects the UPDATE before `with check` is ever reached,
-- since the existing row's profile_id != the newly-signed-in user's
-- auth.uid(). Confirmed live: a facchino account got a 403 on
-- device_push_subscriptions?on_conflict=endpoint after a reception account
-- had already registered notifications on the same shared device.
--
-- Fix: split the single policy into one per command. SELECT and DELETE stay
-- exactly as strict as before (profile_id = auth.uid(), still covered by
-- 043_device_push_subscriptions.test.sql, untouched by this migration).
-- INSERT keeps the same check. UPDATE gets a permissive `using (true)` --
-- any authenticated user may target any existing row for the on_conflict
-- resolution -- while `with check (profile_id = auth.uid())` still
-- guarantees the row can only ever end up owned by whoever is currently
-- authenticated. That is exactly the "transfers to whoever is signed in on
-- this device now" behavior the table's own original migration comment
-- already describes as intended; this migration makes the RLS policy
-- actually allow it.

begin;

drop policy if exists device_push_subscriptions_owner on device_push_subscriptions;

create policy device_push_subscriptions_select on device_push_subscriptions for select to authenticated
  using (profile_id = auth.uid());

create policy device_push_subscriptions_insert on device_push_subscriptions for insert to authenticated
  with check (profile_id = auth.uid());

-- Permissive `using`: an upsert's on_conflict=endpoint resolves to an
-- UPDATE, which must be able to target a row currently owned by a
-- *different* profile (the device's previous user) so it can be reassigned
-- -- see the migration comment above. `with check` is what keeps this safe:
-- the row can never end up owned by anyone other than the caller.
create policy device_push_subscriptions_update on device_push_subscriptions for update to authenticated
  using (true)
  with check (profile_id = auth.uid());

create policy device_push_subscriptions_delete on device_push_subscriptions for delete to authenticated
  using (profile_id = auth.uid());

commit;

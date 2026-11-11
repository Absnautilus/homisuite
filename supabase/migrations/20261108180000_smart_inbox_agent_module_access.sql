-- Smart Inbox — an agent is whoever would pass has_permission(property,
-- 'smart_inbox.view') themselves, now including the per-member module
-- access switch in Team (membership_module_access). Before, someone whose
-- Smart Inbox access was switched off in Team could not open the module
-- but still appeared in the "Agent" picker and could be assigned guests.
--
-- profile_has_permission() (20261013120000_membership_module_access.sql) is
-- exactly has_permission() evaluated for another profile, so the agent check
-- reuses it instead of keeping its own copy of the rule.

begin;

create or replace function smart_inbox_is_agent(p_property_id uuid, p_profile_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select has_permission(p_property_id, 'smart_inbox.view')
    and profile_has_permission(p_profile_id, p_property_id, 'smart_inbox.view');
$$;

commit;

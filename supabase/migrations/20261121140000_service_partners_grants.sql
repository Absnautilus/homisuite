-- Missing table-level GRANTs on service_partners/service_partner_users --
-- RLS policies restrict which rows a role can see, but they're only
-- reachable at all once the role already holds the base SQL privilege on
-- the table; the original service_partners/service_partner_users
-- migrations enabled RLS and added policies but never granted the
-- underlying privilege itself, unlike every other table in this module
-- (see e.g. restaurants' own `grant select, insert, update, delete on
-- dining_categories, restaurants, restaurant_hours to authenticated` in
-- 20260918100000_dining_module.sql). Caught by test-partner-flow: a
-- signed-in staff member with dining.manage still got `42501 permission
-- denied for table service_partners` on a plain select.
begin;

grant select, insert, update, delete on service_partners to authenticated;
grant select, insert, update, delete on service_partner_users to authenticated;

commit;

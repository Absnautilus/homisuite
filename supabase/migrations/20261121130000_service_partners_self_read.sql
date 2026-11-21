-- A partner user needs their own service_partners row (just the name) to
-- show "which business am I" in apps/partner's header -- missed in the
-- original service_partner_users migration, which only covered the tables
-- the reservation list itself needs. Additive, select-only, same pattern
-- as the other partner_read policies: service_partners_manage (staff,
-- dining.manage) stays the only policy that can write.
begin;

create policy service_partners_self_read on service_partners for select to authenticated
  using (is_active_partner_user(id));

commit;

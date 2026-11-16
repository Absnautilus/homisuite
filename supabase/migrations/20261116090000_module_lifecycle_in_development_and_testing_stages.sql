-- Two more module lifecycle stages, matching how the team actually talks
-- about a module's maturity: "active"/"beta" alone couldn't say a module
-- is still being built (in_development) or is being tried out on a
-- handful of properties before a wider rollout (testing). Visibility
-- rules per stage (enforced in the client, same pattern the existing
-- active/beta/deprecated distinction already uses):
--   in_development -> platform admins (technical/master admin) only
--   testing        -> platform admins, plus properties explicitly opted
--                      in via property_modules.testing_access
--   beta / active  -> everyone, as before
--   deprecated     -> unchanged

alter table modules drop constraint modules_status_check;
alter table modules add constraint modules_status_check
  check (status in ('in_development', 'testing', 'beta', 'active', 'deprecated'));

alter table property_modules
  add column testing_access boolean not null default false;

-- Reclassify against today's reality: Transfer is a pure placeholder page
-- (no real functionality yet, no property has ever enabled it) --
-- in_development. Shifts/Turni had several real production bugs found
-- and fixed today (rest-day rotation collisions, uncovered night shifts,
-- data overwrite protection) and is still being actively hardened on
-- real data -- testing, not yet "fully usable" without caveats. The
-- property already using it keeps full access via testing_access, so
-- nothing changes for its day-to-day use.
update modules set status = 'in_development' where slug = 'transfers';
update modules set status = 'testing' where slug = 'shifts';

update property_modules
set testing_access = true
where module_id = (select id from modules where slug = 'shifts')
  and property_id = 'e82a8248-2a37-45a9-abe2-686334e40f2e';

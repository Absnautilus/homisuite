-- rotation_slot: the stable per-employee anchor the "Imposta riposi" rest
-- rotation (see modules/shifts/src/domain/restRotation.ts, ported from
-- Absnautilus/plannerturni) needs for a rotating-rest employee's rest-day
-- weekday. Assigned once (the smallest integer not already used by another
-- rotating profile at the property) and never recomputed from array
-- position -- recomputing it on every run would reshuffle everyone else's
-- rest days whenever staff are added, removed or reordered.
--
-- Scoped to the whole property (not per planning unit): a person's days off
-- don't change depending on which unit happens to be viewed, matching how
-- rest_mode/fixed_rest_days already work on this same table.
alter table shift_staff_profiles add column rotation_slot integer check (rotation_slot is null or rotation_slot >= 0);

-- Partial unique index: two profiles at the same property may never share a
-- slot once assigned (that would give them identical rest days), but the
-- column is null until "Imposta riposi" first assigns one, or forever for
-- fixed-rest employees who never need a slot at all.
create unique index shift_staff_profiles_rotation_slot_unique
  on shift_staff_profiles (property_id, rotation_slot)
  where rotation_slot is not null;

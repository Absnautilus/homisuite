-- early_access_signups.main_problem: text -> text[]. The landing's form
-- moved from a single-select to a multi-select for "cosa vorresti
-- semplificare" (a hotel's pain point is rarely just one thing), so a
-- single scalar can no longer hold what the Edge Function validates and
-- writes. Additive/backward-compatible at the data level: every existing
-- row's single value is wrapped into a one-element array, nothing is lost.
begin;

alter table early_access_signups
  drop constraint early_access_signups_main_problem_check;

alter table early_access_signups
  alter column main_problem type text[] using array[main_problem];

-- Every element must be in the same whitelist as before, and the array
-- itself must be non-empty -- the Edge Function requires at least one
-- selection, so the database should never accept a lead with none.
alter table early_access_signups
  add constraint early_access_signups_main_problem_check
  check (
    cardinality(main_problem) > 0
    and main_problem <@ array['guest_requests', 'shift_planning', 'internal_communication', 'transfer', 'restaurants_experiences', 'handover', 'other']::text[]
  );

commit;

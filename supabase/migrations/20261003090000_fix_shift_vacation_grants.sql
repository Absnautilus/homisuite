-- Hotfix: shift_vacation_periods/shift_vacation_settings were created
-- enabled for RLS but never given the explicit table-level grant this
-- project's Turni tables all rely on (see 20260918160000's "revoke all ...
-- grant select, insert, update, delete ... to authenticated" -- unlike some
-- Supabase projects, this one does NOT fall back to a broad default
-- privilege for authenticated/anon on new tables). Without it, PostgREST
-- returns 403 before RLS is even evaluated, which broke the whole Turni
-- page (loadVacationData's rejection aborts ShiftPlannerPage's entire
-- refreshLiveData, not just the vacation panel).
--
-- Periods: read-only via REST -- every write goes through the
-- request_vacation_period/decide_vacation_period SECURITY DEFINER RPCs,
-- which run as the function owner and never need a caller-side table grant.
-- Settings: read AND written via REST (saveVacationSettings does a plain
-- upsert), so authenticated needs select/insert/update there; RLS already
-- gates insert/update to shifts.manage.
revoke all on table shift_vacation_periods, shift_vacation_settings from anon, authenticated;
grant select on table shift_vacation_periods to authenticated;
grant select, insert, update on table shift_vacation_settings to authenticated;

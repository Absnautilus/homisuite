-- RLS policies for these tables already permit INSERT/UPDATE for authenticated
-- (smart_inbox_* write policies, staff_profiles_write_scoped), but the table-
-- level GRANT was never issued for those commands -- a GRANT is checked
-- before RLS ever evaluates, so every one of these calls from the client
-- (apps/web/src/modules/smart-inbox/api.ts, modules/housekeeping/src/lib/
-- admin-api.ts's setStaffActive) has been failing with "permission denied",
-- regardless of how permissive the RLS policy is. Granting only the commands
-- an existing policy already covers, not the full set a table might have --
-- RLS still enforces exactly what each policy's USING/WITH CHECK allows.

grant update on table public.smart_inbox_conversations to authenticated;
grant update on table public.smart_inbox_messages to authenticated;
grant update on table public.smart_inbox_drafts to authenticated;
grant insert, update on table public.smart_inbox_templates to authenticated;
grant insert, update on table public.smart_inbox_knowledge_entries to authenticated;
grant insert, update on table public.smart_inbox_settings to authenticated;
grant insert, update on table public.smart_inbox_agent_preferences to authenticated;
grant update on table public.staff_profiles to authenticated;

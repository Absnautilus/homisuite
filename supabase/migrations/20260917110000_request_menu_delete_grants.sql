-- The Menu richieste page's "Rimuovi" action (categories and items) had no
-- backing delete: authenticated was never granted DELETE on
-- request_categories/request_types, only select/insert/update (see
-- 20260827120200_guest_requests_rls.sql). A delete attempt hits Postgres'
-- table-level privilege check before RLS is even evaluated, so it always
-- failed -- the UI covered this by only hiding the row client-side, which
-- is why a "deleted" item reappeared on the next reload.
--
-- rooms has the exact same gap (deleteRoom already attempts a real delete,
-- but authenticated was never granted it either) -- same fix, same
-- migration, since it's the identical missing grant on a sibling table.
--
-- No new RLS policy is needed: rooms_admin_write, request_categories_admin_write
-- and request_types_admin_write are already `for all`, so they already scope
-- delete correctly (own hotel, admin role) once the grant exists. This
-- mirrors 20260910130000_membership_delete.sql, which fixed the same bug for
-- Team's "remove" action.

grant delete on rooms, request_categories, request_types to authenticated;

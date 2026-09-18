-- "Urgente" label: front-desk-toggled attention flag on a guest request,
-- independent of manual priority ordering (0700). No RLS change needed --
-- guest_requests_update_hotel (20260827121400) already lets any staff who
-- can see a row update it; who is *offered* the toggle in the UI is a
-- front-desk-only affordance enforced client-side (managesFrontDesk, the
-- same convention request-queue.tsx already uses for canReorder), matching
-- the "attivabile da parte di utente della reception" request -- everyone
-- who can see the request still needs to see the badge.

begin;

alter table guest_requests add column urgent boolean not null default false;

commit;

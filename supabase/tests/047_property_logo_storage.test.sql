-- Storage RLS for the property-logos bucket (20260915130000). Authorization
-- mirrors properties_update exactly: has_permission(property_id,
-- 'core.property.manage'), keyed off the property id encoded as the
-- object's top-level folder (`<property_id>/logo.png`). Reads are gated to
-- has_property_access instead, so any staff member of the property can see
-- the current logo (e.g. to render a preview) even without permission to
-- change it -- separate from the bucket's own public=true flag, which is
-- what actually serves the logo to anon guests via its public URL and is
-- untouched by these policies.
begin;
create extension if not exists pgtap;
select plan(8);

insert into organizations (id, name, slug) values
  ('00000047-0000-0000-0000-000000000001', 'Test Org A', 'test-047-org-a'),
  ('00000047-0000-0000-0000-000000000002', 'Test Org B', 'test-047-org-b');
insert into properties (id, organization_id, name, slug) values
  ('00000047-0000-0000-0000-000000000011', '00000047-0000-0000-0000-000000000001', 'Property A', 'a047'),
  ('00000047-0000-0000-0000-000000000012', '00000047-0000-0000-0000-000000000002', 'Property B', 'b047');

insert into auth.users (id) values
  ('00000047-0000-0000-0000-000000000041'),
  ('00000047-0000-0000-0000-000000000042'),
  ('00000047-0000-0000-0000-000000000043');
insert into profiles (id, full_name) values
  ('00000047-0000-0000-0000-000000000041', 'Property A Admin'),
  ('00000047-0000-0000-0000-000000000042', 'Property A Receptionist'),
  ('00000047-0000-0000-0000-000000000043', 'Property B Admin');

insert into memberships (id, profile_id, property_id, role_id, status)
select v.membership_id, v.profile_id, v.property_id, r.id, 'active'
from (values
  ('00000047-0000-0000-0000-000000000051'::uuid, '00000047-0000-0000-0000-000000000041'::uuid, '00000047-0000-0000-0000-000000000011'::uuid, 'property_admin'),
  ('00000047-0000-0000-0000-000000000052'::uuid, '00000047-0000-0000-0000-000000000042'::uuid, '00000047-0000-0000-0000-000000000011'::uuid, 'receptionist'),
  ('00000047-0000-0000-0000-000000000053'::uuid, '00000047-0000-0000-0000-000000000043'::uuid, '00000047-0000-0000-0000-000000000012'::uuid, 'property_admin')
) as v(membership_id, profile_id, property_id, role_slug)
join roles r on r.slug = v.role_slug;

select is(storage_extract_property_id('not-a-uuid/logo.png'), null,
  'a malformed folder name resolves to null instead of raising');

set local role authenticated;
set local request.jwt.claim.sub = '00000047-0000-0000-0000-000000000041';

select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('property-logos', '00000047-0000-0000-0000-000000000011/logo.png') $$,
  'the property admin can upload a logo for their own property'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('property-logos', '00000047-0000-0000-0000-000000000012/logo.png') $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'the property admin cannot upload a logo for an unrelated property'
);

set local request.jwt.claim.sub = '00000047-0000-0000-0000-000000000042';

select ok(
  (select count(*) = 1 from storage.objects where name = '00000047-0000-0000-0000-000000000011/logo.png'),
  'a receptionist on the same property can see the uploaded logo'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('property-logos', '00000047-0000-0000-0000-000000000011/logo.png') $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'a receptionist without core.property.manage cannot upload a logo'
);

-- UPDATE's policy gates visibility via USING, not a thrown error like
-- INSERT's WITH CHECK: a row the caller's USING clause can't see is simply
-- not matched, so this is an affected-row-count check, not throws_ok.
with upd as (
  update storage.objects set metadata = '{}'::jsonb
  where name = '00000047-0000-0000-0000-000000000011/logo.png'
  returning 1
)
select is((select count(*)::int from upd), 0,
  'a receptionist without core.property.manage cannot replace the logo');

-- No DELETE coverage here: real Supabase Storage unconditionally blocks a
-- direct `delete from storage.objects` for every role, including
-- service_role, via its own protect_delete trigger ("Direct deletion from
-- storage tables is not allowed. Use the Storage API instead") -- this
-- fires before RLS is even consulted, so pgTAP has no way to exercise
-- property_logos_delete directly. The policy is exercised for real when the
-- Storage API deletes an object on the app's behalf (see onLogoRemove in
-- SettingsPage.tsx); confirmed the hard way, by this exact migration
-- failing CI's real Supabase stack until these DELETE assertions were
-- removed.

set local request.jwt.claim.sub = '00000047-0000-0000-0000-000000000043';

select ok(
  (select count(*) = 0 from storage.objects where name = '00000047-0000-0000-0000-000000000011/logo.png'),
  'a property admin of an unrelated property cannot see Property A''s logo'
);

set local request.jwt.claim.sub = '00000047-0000-0000-0000-000000000041';

select lives_ok(
  $$ update storage.objects set metadata = '{"resized": true}'::jsonb where name = '00000047-0000-0000-0000-000000000011/logo.png' $$,
  'the property admin can replace their own property''s logo'
);

select * from finish();
rollback;

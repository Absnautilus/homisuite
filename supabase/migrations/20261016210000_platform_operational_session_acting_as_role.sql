-- Admin Master asked for the operational banner to also name the role of
-- the person she's viewing as, not just their name -- "Stai visualizzando
-- come <nome> e <ruolo>". platform_my_operational_session() already joins
-- memberships/profiles for acting_as_full_name; this adds the one extra
-- join (roles, via the acting-as membership's own role_id) and column
-- needed. Postgres refuses CREATE OR REPLACE when the OUT-parameter row
-- type changes (a new column), so this drops the function first -- same
-- grants reapplied right after, same as every prior change to this
-- function.

begin;

drop function if exists platform_my_operational_session();

create function platform_my_operational_session() returns table(
  id uuid,
  property_id uuid,
  status text,
  reason text,
  opened_at timestamptz,
  expires_at timestamptz,
  acting_as_membership_id uuid,
  acting_as_full_name text,
  acting_as_role_display_name text
)
language plpgsql security definer set search_path = public as $$
declare
  v_admin_id uuid;
begin
  select pa.id into v_admin_id from platform_admins pa where pa.profile_id = auth.uid() and pa.status = 'active';

  if v_admin_id is null then
    return;
  end if;

  update platform_operational_sessions s
     set status = 'expired'
   where s.platform_admin_id = v_admin_id
     and s.status = 'active'
     and s.expires_at <= now();

  return query
    select s.id, s.property_id, s.status, s.reason, s.opened_at, s.expires_at,
           s.acting_as_membership_id, p.full_name, r.display_name
    from platform_operational_sessions s
    left join memberships m on m.id = s.acting_as_membership_id
    left join profiles p on p.id = m.profile_id
    left join roles r on r.id = m.role_id
    where s.platform_admin_id = v_admin_id
      and s.status = 'active'
    order by s.opened_at desc
    limit 1;
end;
$$;

revoke all on function platform_my_operational_session() from public, anon;
grant execute on function platform_my_operational_session() to authenticated;

commit;

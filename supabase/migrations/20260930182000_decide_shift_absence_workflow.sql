create or replace function public.decide_shift_absence(p_request_id uuid,p_approve boolean)
returns void language plpgsql security definer set search_path=public as $$
declare r public.shift_absence_requests%rowtype; actor uuid:=auth.uid(); code_id uuid; code_kind text;
begin
 if actor is null then raise exception 'Non autenticato'; end if;
 select * into r from public.shift_absence_requests where id=p_request_id for update;
 if r.id is null then raise exception 'Richiesta non trovata'; end if;
 if not (public.has_permission(r.property_id,'shifts.manage') or public.has_permission(r.property_id,'shifts.requests.manage')) then raise exception 'Non autorizzato'; end if;
 if r.status<>'pending' then raise exception 'Richiesta già decisa'; end if;
 if exists(select 1 from public.shift_month_states where property_id=r.property_id and planning_unit_id=r.planning_unit_id and month=date_trunc('month',r.starts_on)::date and status='final') then raise exception 'Il mese è Definitivo'; end if;
 if not p_approve then update public.shift_absence_requests set status='rejected',decided_by=actor,decided_at=now(),updated_at=now() where id=r.id; return; end if;
 code_kind:=case r.absence_kind when 'leave' then 'leave' when 'permission' then 'permission' else 'absence' end;
 select id into code_id from public.shift_codes where property_id=r.property_id and planning_unit_id=r.planning_unit_id and kind=code_kind and active=true order by case code when 'F' then 0 when 'P' then 0 when 'M' then 0 else 1 end,code limit 1;
 if code_id is null then raise exception 'Nessun codice turno compatibile configurato'; end if;
 if exists(select 1 from public.shifts where property_id=r.property_id and planning_unit_id=r.planning_unit_id and staff_profile_id=r.staff_profile_id and shift_date between r.starts_on and r.ends_on and locked) then raise exception 'Un turno DNM impedisce l’approvazione'; end if;
 insert into public.shifts(property_id,planning_unit_id,staff_profile_id,shift_code_id,shift_date,locked,source,created_by,note)
 select r.property_id,r.planning_unit_id,r.staff_profile_id,code_id,d,true,'manual',actor,r.note from generate_series(r.starts_on,r.ends_on,interval '1 day') d
 on conflict(planning_unit_id,staff_profile_id,shift_date) do update set shift_code_id=excluded.shift_code_id,locked=true,source='manual',created_by=actor,note=excluded.note,updated_at=now();
 update public.shift_absence_requests set status='approved',decided_by=actor,decided_at=now(),updated_at=now() where id=r.id;
end $$;
revoke all on function public.decide_shift_absence(uuid,boolean) from public,anon;
grant execute on function public.decide_shift_absence(uuid,boolean) to authenticated;

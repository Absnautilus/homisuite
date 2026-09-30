create or replace function public.respond_shift_swap(p_request_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r public.shift_swap_requests%rowtype; requested public.shifts%rowtype; offered public.shifts%rowtype; actor uuid := auth.uid(); is_target boolean; manager boolean; final_month boolean;
begin
 if actor is null then raise exception 'Non autenticato'; end if;
 select * into r from public.shift_swap_requests where id=p_request_id for update;
 if r.id is null then raise exception 'Richiesta non trovata'; end if;
 is_target := r.target_staff_profile_id is not null and owns_shift_staff_profile(r.property_id,r.target_staff_profile_id);
 manager := has_permission(r.property_id,'shifts.requests.manage');
 if r.status='pending' then
  if not is_target then raise exception 'Solo il collega destinatario può rispondere'; end if;
  if not p_accept then update public.shift_swap_requests set status='rejected',decided_by=actor,decided_at=now(),updated_at=now() where id=r.id; return; end if;
  select * into requested from public.shifts where id=r.requested_shift_id for update;
  select * into offered from public.shifts where id=r.offered_shift_id for update;
  if requested.id is null or offered.id is null or requested.locked or offered.locked then raise exception 'Uno dei turni non è più scambiabile'; end if;
  final_month := exists(select 1 from public.shift_month_states where property_id=r.property_id and planning_unit_id=r.planning_unit_id and month=date_trunc('month',requested.shift_date)::date and status='final');
  if final_month then update public.shift_swap_requests set status='accepted',updated_at=now() where id=r.id; return; end if;
 elsif r.status='accepted' then
  if not manager then raise exception 'Solo un responsabile può approvare questo cambio'; end if;
  if not p_accept then update public.shift_swap_requests set status='rejected',decided_by=actor,decided_at=now(),updated_at=now() where id=r.id; return; end if;
  select * into requested from public.shifts where id=r.requested_shift_id for update;
  select * into offered from public.shifts where id=r.offered_shift_id for update;
  if requested.id is null or offered.id is null or requested.locked or offered.locked then raise exception 'Uno dei turni non è più scambiabile'; end if;
 else raise exception 'Richiesta non modificabile'; end if;
 update public.shifts set shift_code_id=offered.shift_code_id,locked=true,source='manual',created_by=actor,updated_at=now() where id=requested.id;
 update public.shifts set shift_code_id=requested.shift_code_id,locked=true,source='manual',created_by=actor,updated_at=now() where id=offered.id;
 update public.shift_swap_requests set status='approved',decided_by=actor,decided_at=now(),updated_at=now() where id=r.id;
end $$;
revoke execute on function public.respond_shift_swap(uuid,boolean) from public,anon;
grant execute on function public.respond_shift_swap(uuid,boolean) to authenticated;

alter table public.shift_unit_members
  add column if not exists display_order integer;

comment on column public.shift_unit_members.display_order is
  'Optional manual ordering of people inside a planning unit. Lower values render first; null values follow.';

create index if not exists shift_unit_members_display_order_idx
  on public.shift_unit_members (planning_unit_id, display_order)
  where active = true;

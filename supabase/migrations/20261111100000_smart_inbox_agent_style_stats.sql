-- Smart Inbox — per-agent style and language preferences, and statistics.
--
-- * Each agent can set, for themselves, a tone and a few lines of
--   instructions the assistant follows when drafting replies that agent
--   sends (or that land on a guest the agent looks after), plus the
--   languages they read: the Italian translation under a draft is hidden
--   from them when the guest writes in one of those languages.
--   Strictly personal: an agent reads and writes only their own row.
-- * smart_inbox_stats(): message volumes, replies, response times, how many
--   replies went out exactly as drafted, by day, channel and agent. Every
--   agent sees the property totals and their own figures; only managers
--   (smart_inbox.manage) see the per-agent breakdown of colleagues.

begin;

create table smart_inbox_agent_preferences (
  property_id uuid not null references properties(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  -- null = use the property's tone.
  tone text check (tone in ('cordiale', 'formale', 'essenziale')),
  instructions text not null default '' check (char_length(instructions) <= 600),
  -- ISO 639-1 codes the agent reads ('it', 'en', 'de'...).
  languages text[] not null default '{it}'
    check (cardinality(languages) <= 20 and languages <@ array[
      'it', 'en', 'de', 'fr', 'es', 'nl', 'pt', 'ru', 'zh', 'ja', 'pl', 'ar', 'cs', 'da', 'el', 'fi', 'hu', 'ko', 'no', 'ro', 'sv', 'tr', 'uk'
    ]),
  updated_at timestamptz not null default now(),
  primary key (property_id, profile_id)
);

create trigger smart_inbox_agent_preferences_set_updated_at
  before update on smart_inbox_agent_preferences
  for each row execute function set_updated_at();

alter table smart_inbox_agent_preferences enable row level security;

create policy smart_inbox_agent_preferences_select on smart_inbox_agent_preferences for select to authenticated
  using (profile_id = auth.uid() and has_permission(property_id, 'smart_inbox.view'));
create policy smart_inbox_agent_preferences_insert on smart_inbox_agent_preferences for insert to authenticated
  with check (profile_id = auth.uid() and has_permission(property_id, 'smart_inbox.view'));
create policy smart_inbox_agent_preferences_update on smart_inbox_agent_preferences for update to authenticated
  using (profile_id = auth.uid() and has_permission(property_id, 'smart_inbox.view'))
  with check (profile_id = auth.uid() and has_permission(property_id, 'smart_inbox.view'));

revoke all on table smart_inbox_agent_preferences from public, anon, authenticated;
grant select on table smart_inbox_agent_preferences to authenticated;
grant insert (property_id, profile_id, tone, instructions, languages) on table smart_inbox_agent_preferences to authenticated;
grant update (tone, instructions, languages) on table smart_inbox_agent_preferences to authenticated;

-- ---------------------------------------------------------------------------
-- Statistics
-- ---------------------------------------------------------------------------
-- p_days: the last N days (1..366), counted in the property's timezone and
-- including today. Messages filtered before the AI (newsletters, OTA
-- notifications...) are not counted as received.
create function smart_inbox_stats(p_property_id uuid, p_days int default 30)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_from timestamptz;
  v_days int := least(greatest(coalesce(p_days, 30), 1), 366);
  v_manager boolean;
  v_result jsonb;
begin
  if not has_permission(p_property_id, 'smart_inbox.view') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  v_manager := has_permission(p_property_id, 'smart_inbox.manage');
  select timezone into v_tz from properties where id = p_property_id;
  v_tz := coalesce(v_tz, 'Europe/Rome');
  v_from := ((now() at time zone v_tz)::date - (v_days - 1))::timestamp at time zone v_tz;

  with received as (
    select m.id, m.source, m.received_at, m.mailbox_id
    from smart_inbox_messages m
    where m.property_id = p_property_id
      and m.received_at >= v_from
      and m.status <> 'ignored'
  ),
  sent as (
    select d.sent_by, d.sent_at, m.received_at, m.source,
      -- Sent exactly as drafted: the sent body is the AI text plus the
      -- signature appended at send time.
      (d.body = d.ai_body or left(d.body, char_length(btrim(d.ai_body)) + 1) = btrim(d.ai_body) || E'\n') as unchanged
    from smart_inbox_drafts d
    join smart_inbox_messages m on m.id = d.message_id
    where d.property_id = p_property_id
      and d.status = 'sent'
      and d.sent_at >= v_from
  ),
  days as (
    select generate_series((now() at time zone v_tz)::date - (v_days - 1), (now() at time zone v_tz)::date, interval '1 day')::date as day
  )
  select jsonb_build_object(
    'days', v_days,
    'received', (select count(*) from received),
    'replied', (select count(*) from sent),
    'unchanged', (select count(*) from sent where unchanged),
    'avg_response_minutes', (select round(avg(extract(epoch from (sent_at - received_at)) / 60)::numeric, 0) from sent where sent_at >= received_at),
    'median_response_minutes', (select round((percentile_cont(0.5) within group (order by extract(epoch from (sent_at - received_at)) / 60))::numeric, 0) from sent where sent_at >= received_at),
    'open_now', (
      select count(*) from smart_inbox_messages
      where property_id = p_property_id and status in ('pending', 'processing', 'draft_ready', 'needs_attention', 'failed')
    ),
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', d.day,
        'received', (select count(*) from received r where (r.received_at at time zone v_tz)::date = d.day),
        'replied', (select count(*) from sent s where (s.sent_at at time zone v_tz)::date = d.day)
      ) order by d.day), '[]'::jsonb)
      from days d
    ),
    'by_channel', (
      select coalesce(jsonb_agg(jsonb_build_object('source', source, 'received', received, 'replied', replied) order by received desc), '[]'::jsonb)
      from (
        select coalesce(r.source, s.source) as source, coalesce(r.n, 0) as received, coalesce(s.n, 0) as replied
        from (select source, count(*) as n from received group by source) r
        full join (select source, count(*) as n from sent group by source) s on s.source = r.source
      ) channels
    ),
    'by_agent', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'profile_id', a.sent_by,
        'full_name', p.full_name,
        'replied', a.replied,
        'unchanged', a.unchanged,
        'avg_response_minutes', a.avg_minutes
      ) order by a.replied desc), '[]'::jsonb)
      from (
        select sent_by, count(*) as replied, count(*) filter (where unchanged) as unchanged,
          round(avg(extract(epoch from (sent_at - received_at)) / 60) filter (where sent_at >= received_at)::numeric, 0) as avg_minutes
        from sent
        where sent_by is not null and (v_manager or sent_by = auth.uid())
        group by sent_by
      ) a
      left join profiles p on p.id = a.sent_by
    ),
    'agents_visible', case when v_manager then 'all' else 'self' end
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function smart_inbox_stats(uuid, int) from public, anon;
grant execute on function smart_inbox_stats(uuid, int) to authenticated;

comment on table smart_inbox_agent_preferences is
  'Per-agent Smart Inbox preferences: own tone and instructions for the assistant, languages they read. Each agent reads and writes only their own row.';

commit;

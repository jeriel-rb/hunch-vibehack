-- v3: conversational rounds. Each participant answers privately through rounds;
-- the reveal returns either a consensus pick OR one follow-up question (host re-checks).

alter table public.rooms
  add column if not exists round int not null default 0,
  add column if not exists followups text[] not null default '{}';

create table if not exists public.responses (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,   -- { budget, style, avoid, freestyle, followups: [] }
  ready boolean not null default false,
  answered_round int not null default -1,
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists responses_room_idx on public.responses (room_id);

alter table public.responses enable row level security;
-- Own row only; others are exposed solely via get_room_state (definer) after reveal.
drop policy if exists responses_rw_self on public.responses;
create policy responses_rw_self on public.responses
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Merge a participant's answers and (optionally) mark them ready for the current round.
create or replace function public.submit_response(p_room_id uuid, p_answers jsonb, p_ready boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_round int; v_count int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_room_participant(p_room_id) then raise exception 'not a participant'; end if;
  select round into v_round from public.rooms where id = p_room_id;

  insert into public.responses (room_id, user_id, answers, ready, answered_round, updated_at)
  values (p_room_id, auth.uid(), coalesce(p_answers, '{}'::jsonb), p_ready,
          case when p_ready then v_round else -1 end, now())
  on conflict (room_id, user_id) do update set
    answers = public.responses.answers || coalesce(excluded.answers, '{}'::jsonb),
    ready = excluded.ready or public.responses.ready,
    answered_round = case when p_ready then v_round
                          else public.responses.answered_round end,
    updated_at = now();

  select count(*) into v_count from public.responses
   where room_id = p_room_id and answered_round >= v_round;
  update public.rooms set answered_count = v_count where id = p_room_id;
end; $$;

-- Replace get_room_state to carry rounds + per-user answers (others only when revealed).
create or replace function public.get_room_state(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_room public.rooms; v_mine public.responses; v_responses jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.rooms where code = upper(p_code);
  if v_room.id is null then raise exception 'room not found'; end if;
  if not public.is_room_participant(v_room.id) then raise exception 'not a participant'; end if;

  select * into v_mine from public.responses where room_id = v_room.id and user_id = auth.uid();

  if v_room.status = 'revealed' then
    select jsonb_agg(jsonb_build_object('label', chr(64 + rn::int), 'answers', answers) order by rn)
      into v_responses
    from (
      select answers, row_number() over (order by updated_at) as rn
      from public.responses where room_id = v_room.id
    ) t;
  end if;

  return jsonb_build_object(
    'id', v_room.id, 'code', v_room.code, 'question', v_room.question, 'category', v_room.category,
    'location_label', v_room.location_label, 'host_id', v_room.host_id,
    'is_host', v_room.host_id = auth.uid(), 'status', v_room.status,
    'round', v_room.round, 'followups', to_jsonb(v_room.followups),
    'participant_count', v_room.participant_count, 'answered_count', v_room.answered_count,
    'my_answers', coalesce(v_mine.answers, '{}'::jsonb),
    'my_round', coalesce(v_mine.answered_round, -1),
    'result', v_room.result, 'responses', v_responses
  );
end; $$;

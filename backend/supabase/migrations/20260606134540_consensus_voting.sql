-- AI consensus loop: private follow-ups, 3 place options, and majority voting.

alter table public.rooms
  drop constraint if exists rooms_status_check;

alter table public.rooms
  add constraint rooms_status_check check (status in ('waiting','open','choosing','revealing','revealed'));

create table if not exists public.room_ai_sessions (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  openai_response_id text,
  round int not null default 0,
  last_action text,
  updated_at timestamptz not null default now()
);

create table if not exists public.room_private_prompts (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  round int not null,
  prompt text not null,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id, round)
);

create table if not exists public.room_place_options (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  option_index int not null check (option_index between 1 and 3),
  round int not null default 0,
  cuisine text not null default '',
  rationale text not null default '',
  reasons text[] not null default '{}',
  ruled_out text[] not null default '{}',
  venue jsonb not null,
  created_at timestamptz not null default now(),
  unique (room_id, round, option_index)
);

create table if not exists public.room_place_votes (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  option_id uuid not null references public.room_place_options(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists room_private_prompts_user_idx
  on public.room_private_prompts (user_id, room_id, round);
create index if not exists room_place_options_room_round_idx
  on public.room_place_options (room_id, round, option_index);
create index if not exists room_place_votes_room_idx
  on public.room_place_votes (room_id, option_id);

alter table public.room_ai_sessions enable row level security;
alter table public.room_private_prompts enable row level security;
alter table public.room_place_options enable row level security;
alter table public.room_place_votes enable row level security;

drop policy if exists room_ai_sessions_select on public.room_ai_sessions;
create policy room_ai_sessions_select on public.room_ai_sessions
  for select to authenticated using (public.is_room_participant(room_id));

drop policy if exists room_private_prompts_select_own on public.room_private_prompts;
create policy room_private_prompts_select_own on public.room_private_prompts
  for select to authenticated using (user_id = auth.uid());

drop policy if exists room_place_options_select on public.room_place_options;
create policy room_place_options_select on public.room_place_options
  for select to authenticated using (public.is_room_participant(room_id));

drop policy if exists room_place_votes_select_own on public.room_place_votes;
create policy room_place_votes_select_own on public.room_place_votes
  for select to authenticated using (user_id = auth.uid());

do $$
begin
  alter publication supabase_realtime add table public.room_place_options;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.room_place_votes;
exception
  when duplicate_object then null;
end $$;

create or replace function public.submit_response(p_room_id uuid, p_answers jsonb, p_ready boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_round int;
  v_status text;
  v_count int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_room_participant(p_room_id) then raise exception 'not a participant'; end if;

  select round, status into v_round, v_status
  from public.rooms
  where id = p_room_id;

  if v_status is null then raise exception 'room not found'; end if;
  if v_status <> 'open' then raise exception 'room is not open'; end if;

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

create or replace function public.vote_place_option(p_option_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_room_id uuid;
  v_room public.rooms;
  v_total int;
  v_votes_cast int;
  v_winner_id uuid;
  v_winner_votes int;
  v_winner public.room_place_options;
  v_options jsonb;
  v_next_round int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select room_id into v_room_id
  from public.room_place_options
  where id = p_option_id;

  if v_room_id is null then raise exception 'option not found'; end if;
  if not public.is_room_participant(v_room_id) then raise exception 'not a participant'; end if;

  select * into v_room from public.rooms where id = v_room_id;
  if v_room.status <> 'choosing' then raise exception 'room is not choosing'; end if;

  insert into public.room_place_votes (room_id, user_id, option_id, updated_at)
  values (v_room_id, auth.uid(), p_option_id, now())
  on conflict (room_id, user_id) do update set option_id = excluded.option_id, updated_at = now();

  v_total := greatest(v_room.participant_count, 1);

  select option_id, count(*)::int
    into v_winner_id, v_winner_votes
  from public.room_place_votes
  where room_id = v_room_id
  group by option_id
  order by count(*) desc, max(updated_at) asc
  limit 1;

  select count(*)::int into v_votes_cast
  from public.room_place_votes
  where room_id = v_room_id;

  update public.rooms
     set answered_count = v_votes_cast
   where id = v_room_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'option_index', option_index,
    'cuisine', cuisine,
    'rationale', rationale,
    'reasons', to_jsonb(reasons),
    'ruled_out', to_jsonb(ruled_out),
    'venue', venue
  ) order by option_index), '[]'::jsonb)
    into v_options
  from public.room_place_options
  where room_id = v_room_id
    and round = (
      select max(round) from public.room_place_options where room_id = v_room_id
    );

  if coalesce(v_winner_votes, 0) > (v_total::numeric / 2) then
    select * into v_winner from public.room_place_options where id = v_winner_id;

    update public.rooms
      set status = 'revealed',
          result = jsonb_build_object(
            'summary', coalesce(nullif(v_winner.rationale, ''), 'Consensus unlocked.'),
            'cuisine', v_winner.cuisine,
            'reasons', to_jsonb(v_winner.reasons),
            'ruled_out', to_jsonb(v_winner.ruled_out),
            'venue', v_winner.venue,
            'options', v_options,
            'selected_option_id', v_winner.id,
            'success_title', 'Consensus unlocked',
            'success_copy', 'No group chat chaos required. Hunch found the yes.'
          ),
          revealed_at = now()
    where id = v_room_id;

    return jsonb_build_object('status', 'revealed', 'winner_id', v_winner_id);
  end if;

  if v_votes_cast >= v_total then
    v_next_round := v_room.round + 1;

    insert into public.room_private_prompts (room_id, user_id, round, prompt)
    select v_room_id, rp.user_id, v_next_round,
           'No majority yet. What would make you happily switch picks?'
    from public.room_participants rp
    where rp.room_id = v_room_id
    on conflict (room_id, user_id, round) do update set prompt = excluded.prompt;

    update public.rooms
       set status = 'open',
           round = v_next_round,
           answered_count = 0
     where id = v_room_id;

    return jsonb_build_object('status', 'followup', 'round', v_next_round);
  end if;

  return jsonb_build_object('status', 'choosing', 'votes_cast', v_votes_cast, 'participant_count', v_total);
end; $$;

create or replace function public.get_room_state(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room public.rooms;
  v_mine public.responses;
  v_responses jsonb;
  v_members jsonb;
  v_invite_status text;
  v_is_participant boolean;
  v_private_prompt text;
  v_private_prompts jsonb;
  v_place_options jsonb;
  v_my_place_vote uuid;
  v_votes_cast int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_room from public.rooms where code = upper(p_code);
  if v_room.id is null then raise exception 'room not found'; end if;

  v_is_participant := public.is_room_participant(v_room.id);

  select status into v_invite_status
  from public.room_invites
  where room_id = v_room.id and invited_user = auth.uid();

  if not (
    v_room.host_id = auth.uid()
    or v_is_participant
    or (v_invite_status = 'pending' and v_room.status = 'waiting')
  ) then
    raise exception 'not a participant';
  end if;

  if v_is_participant then
    select * into v_mine from public.responses where room_id = v_room.id and user_id = auth.uid();
  end if;

  select prompt into v_private_prompt
  from public.room_private_prompts
  where room_id = v_room.id and user_id = auth.uid() and round = v_room.round;

  select coalesce(jsonb_agg(prompt order by round), '[]'::jsonb)
    into v_private_prompts
  from public.room_private_prompts
  where room_id = v_room.id and user_id = auth.uid();

  if v_room.status = 'revealed' and v_is_participant then
    select jsonb_agg(jsonb_build_object('label', chr(64 + rn::int), 'answers', answers) order by rn)
      into v_responses
    from (
      select answers, row_number() over (order by updated_at) as rn
      from public.responses where room_id = v_room.id
    ) t;
  end if;

  with member_rows as (
    select v_room.host_id as user_id, 'host' as role, 'accepted' as status, v_room.created_at as sort_at
    union all
    select ri.invited_user, 'member', ri.status, ri.created_at
    from public.room_invites ri
    where ri.room_id = v_room.id
    union all
    select rp.user_id, 'member', 'accepted', rp.joined_at
    from public.room_participants rp
    where rp.room_id = v_room.id
      and rp.user_id <> v_room.host_id
      and not exists (
        select 1 from public.room_invites ri
        where ri.room_id = rp.room_id and ri.invited_user = rp.user_id
      )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'username', p.username,
    'display_name', p.display_name,
    'role', mr.role,
    'status', mr.status,
    'is_current_user', p.id = auth.uid()
  ) order by case when mr.role = 'host' then 0 else 1 end, mr.sort_at, p.username), '[]'::jsonb)
    into v_members
  from member_rows mr
  join public.profiles p on p.id = mr.user_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'option_index', option_index,
    'cuisine', cuisine,
    'rationale', rationale,
    'reasons', to_jsonb(reasons),
    'ruled_out', to_jsonb(ruled_out),
    'venue', venue
  ) order by option_index), '[]'::jsonb)
    into v_place_options
  from public.room_place_options
  where room_id = v_room.id
    and round = (
      select max(round) from public.room_place_options where room_id = v_room.id
    );

  select option_id into v_my_place_vote
  from public.room_place_votes
  where room_id = v_room.id and user_id = auth.uid();

  select count(*)::int into v_votes_cast
  from public.room_place_votes
  where room_id = v_room.id;

  return jsonb_build_object(
    'id', v_room.id, 'code', v_room.code, 'question', v_room.question, 'category', v_room.category,
    'location_label', v_room.location_label, 'host_id', v_room.host_id,
    'is_host', v_room.host_id = auth.uid(), 'status', v_room.status,
    'round', v_room.round, 'followups', to_jsonb(v_room.followups),
    'private_prompt', v_private_prompt,
    'private_prompts', v_private_prompts,
    'participant_count', v_room.participant_count, 'answered_count', v_room.answered_count,
    'my_answers', coalesce(v_mine.answers, '{}'::jsonb),
    'my_round', coalesce(v_mine.answered_round, -1),
    'invite_status', v_invite_status,
    'members', v_members,
    'place_options', v_place_options,
    'my_place_vote', v_my_place_vote,
    'votes_cast', v_votes_cast,
    'result', v_room.result, 'responses', v_responses
  );
end; $$;

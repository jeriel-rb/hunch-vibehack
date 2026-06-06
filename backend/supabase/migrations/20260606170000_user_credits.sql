-- User credits: every account starts with 20 credits, and each new room
-- membership consumes one credit. Hosting a room also consumes one credit
-- because the host is inserted into room_participants.

alter table public.profiles
  add column if not exists credits int;

update public.profiles
   set credits = 20
 where credits is null;

alter table public.profiles
  alter column credits set default 20,
  alter column credits set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_credits_nonnegative'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_credits_nonnegative check (credits >= 0);
  end if;
end $$;

create or replace function public.debit_room_join_credit()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
     set credits = credits - 1
   where id = new.user_id
     and credits > 0;

  if not found then
    if exists (select 1 from public.profiles where id = new.user_id) then
      raise exception 'not enough credits';
    end if;

    raise exception 'profile not found';
  end if;

  return new;
end; $$;

drop trigger if exists on_room_participant_debit_credit on public.room_participants;

create trigger on_room_participant_debit_credit
  after insert on public.room_participants
  for each row execute function public.debit_room_join_credit();

create or replace function public.get_home()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_profile jsonb;
  v_invites jsonb;
  v_history jsonb;
  v_req_count int;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  select jsonb_build_object(
      'id', id,
      'username', username,
      'display_name', display_name,
      'is_pro', is_pro,
      'credits', credits
    )
    into v_profile from public.profiles where id = v_me;

  select count(*) into v_req_count from public.friendships
   where (user_low = v_me or user_high = v_me) and status = 'pending' and requested_by <> v_me;

  select coalesce(jsonb_agg(jsonb_build_object(
      'room_id', r.id,
      'code', r.code,
      'question', r.question,
      'category', r.category,
      'status', ri.status,
      'inviter', ip.username
    ) order by ri.created_at desc), '[]'::jsonb)
    into v_invites
  from public.room_invites ri
  join public.rooms r on r.id = ri.room_id and r.status = 'waiting'
  join public.profiles ip on ip.id = ri.invited_by
  where ri.invited_user = v_me
    and ri.status = 'pending'
    and not public.is_room_participant(ri.room_id);

  select coalesce(jsonb_agg(jsonb_build_object(
      'room_id', r.id,
      'code', r.code,
      'question', r.question,
      'category', r.category,
      'status', r.status,
      'created_at', r.created_at,
      'revealed_at', r.revealed_at,
      'participant_count', r.participant_count,
      'summary', r.result->>'summary',
      'venue_name', r.result->'venue'->>'name'
    ) order by coalesce(r.revealed_at, r.created_at) desc), '[]'::jsonb)
    into v_history
  from (
    select r.*
    from public.rooms r
    where r.host_id = v_me
       or exists (
         select 1
         from public.room_participants rp
         where rp.room_id = r.id and rp.user_id = v_me
       )
    order by coalesce(r.revealed_at, r.created_at) desc
    limit 8
  ) r;

  return jsonb_build_object(
    'profile', v_profile,
    'incoming_requests', v_req_count,
    'invites', v_invites,
    'history', v_history
  );
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
  v_my_credits int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select credits into v_my_credits
  from public.profiles
  where id = auth.uid();

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
    'my_credits', v_my_credits,
    'result', v_room.result, 'responses', v_responses
  );
end; $$;

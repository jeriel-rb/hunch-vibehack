-- Started rooms are sealed: no late code joins and no new invites.

create or replace function public.join_room(p_code text)
returns public.rooms
language plpgsql security definer set search_path = public as $$
declare
  v_room public.rooms;
  v_invite_status text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_room from public.rooms where code = upper(p_code);
  if v_room.id is null then raise exception 'room not found'; end if;

  if v_room.status = 'waiting' then
    if v_room.host_id = auth.uid() or public.is_room_participant(v_room.id) then
      return v_room;
    end if;

    select status into v_invite_status
    from public.room_invites
    where room_id = v_room.id and invited_user = auth.uid();

    if v_invite_status = 'pending' then
      return v_room;
    end if;

    if v_invite_status = 'accepted' then
      insert into public.room_participants (room_id, user_id)
      values (v_room.id, auth.uid())
      on conflict (room_id, user_id) do nothing;
      return v_room;
    end if;

    raise exception 'room has not started';
  end if;

  if not public.is_room_participant(v_room.id) then
    raise exception 'room already started';
  end if;

  return v_room;
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

  return jsonb_build_object(
    'id', v_room.id, 'code', v_room.code, 'question', v_room.question, 'category', v_room.category,
    'location_label', v_room.location_label, 'host_id', v_room.host_id,
    'is_host', v_room.host_id = auth.uid(), 'status', v_room.status,
    'round', v_room.round, 'followups', to_jsonb(v_room.followups),
    'participant_count', v_room.participant_count, 'answered_count', v_room.answered_count,
    'my_answers', coalesce(v_mine.answers, '{}'::jsonb),
    'my_round', coalesce(v_mine.answered_round, -1),
    'invite_status', v_invite_status,
    'members', v_members,
    'result', v_room.result, 'responses', v_responses
  );
end; $$;

create or replace function public.invite_to_room(p_room_id uuid, p_friend uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_host uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_friend = auth.uid() then raise exception 'cannot invite yourself'; end if;

  select status, host_id into v_status, v_host
  from public.rooms
  where id = p_room_id;

  if v_status is null then raise exception 'room not found'; end if;
  if v_host <> auth.uid() then raise exception 'only the host can invite'; end if;
  if v_status <> 'waiting' then raise exception 'room already started'; end if;

  if not exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and f.user_low = least(auth.uid(), p_friend)
      and f.user_high = greatest(auth.uid(), p_friend)
  ) then
    raise exception 'you can only invite accepted friends';
  end if;

  insert into public.room_invites (room_id, invited_user, invited_by, status, responded_at)
  values (p_room_id, p_friend, auth.uid(), 'pending', null)
  on conflict (room_id, invited_user) do update set
    invited_by = excluded.invited_by,
    status = case
      when public.room_invites.status = 'accepted' then public.room_invites.status
      else 'pending'
    end,
    responded_at = case
      when public.room_invites.status = 'accepted' then public.room_invites.responded_at
      else null
    end;
end; $$;

create or replace function public.get_home()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_profile jsonb; v_invites jsonb; v_req_count int;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  select jsonb_build_object('id', id, 'username', username, 'display_name', display_name, 'is_pro', is_pro)
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

  return jsonb_build_object('profile', v_profile, 'incoming_requests', v_req_count, 'invites', v_invites);
end; $$;

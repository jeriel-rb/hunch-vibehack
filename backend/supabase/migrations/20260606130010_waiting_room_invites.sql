-- Gate room start behind invite acceptance.

alter table public.rooms
  drop constraint if exists rooms_status_check;

alter table public.rooms
  add constraint rooms_status_check check (status in ('waiting','open','revealing','revealed'));

alter table public.room_invites
  add column if not exists status text not null default 'pending',
  add column if not exists responded_at timestamptz;

do $$
begin
  alter table public.room_invites
    add constraint room_invites_status_check check (status in ('pending','accepted','declined'));
exception
  when duplicate_object then null;
end $$;

create index if not exists room_invites_room_status_idx
  on public.room_invites (room_id, status);

create or replace function public.create_room(
  p_question text,
  p_category text,
  p_location_label text,
  p_lat double precision,
  p_lng double precision,
  p_member_ids uuid[] default '{}'::uuid[]
) returns public.rooms
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_room public.rooms;
  v_member_ids uuid[];
  v_invalid_count int;
  i int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select coalesce(array_agg(distinct member_id), '{}'::uuid[])
    into v_member_ids
  from unnest(coalesce(p_member_ids, '{}'::uuid[])) as members(member_id)
  where member_id is not null and member_id <> auth.uid();

  select count(*)
    into v_invalid_count
  from unnest(v_member_ids) as members(member_id)
  where not exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and f.user_low = least(auth.uid(), member_id)
      and f.user_high = greatest(auth.uid(), member_id)
  );

  if v_invalid_count > 0 then
    raise exception 'selected members must be accepted friends';
  end if;

  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', floor(random() * 32)::int + 1, 1);
    end loop;
    exit when not exists (select 1 from public.rooms where code = v_code);
  end loop;

  insert into public.rooms (code, host_id, question, category, location_label, lat, lng, status)
  values (
    v_code, auth.uid(),
    coalesce(nullif(p_question, ''), 'Where should we eat?'),
    coalesce(nullif(p_category, ''), 'eat'),
    p_location_label, p_lat, p_lng,
    case when cardinality(v_member_ids) > 0 then 'waiting' else 'open' end
  )
  returning * into v_room;

  insert into public.room_participants (room_id, user_id)
  values (v_room.id, auth.uid());

  insert into public.room_invites (room_id, invited_user, invited_by, status, responded_at)
  select v_room.id, member_id, auth.uid(), 'pending', null
  from unnest(v_member_ids) as members(member_id)
  on conflict (room_id, invited_user) do update set
    invited_by = excluded.invited_by,
    status = 'pending',
    responded_at = null;

  return v_room;
end; $$;

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

  insert into public.room_participants (room_id, user_id)
  values (v_room.id, auth.uid())
  on conflict (room_id, user_id) do nothing;

  return v_room;
end; $$;

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

create or replace function public.respond_room_invite(p_room_id uuid, p_accept boolean default true)
returns public.rooms
language plpgsql security definer set search_path = public as $$
declare
  v_room public.rooms;
  v_invite_status text;
  v_unaccepted_count int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_room from public.rooms where id = p_room_id;
  if v_room.id is null then raise exception 'room not found'; end if;

  select status into v_invite_status
  from public.room_invites
  where room_id = p_room_id and invited_user = auth.uid();

  if v_invite_status is null then raise exception 'invitation not found'; end if;
  if v_room.status = 'revealed' then raise exception 'room is already revealed'; end if;

  if p_accept then
    update public.room_invites
       set status = 'accepted', responded_at = now()
     where room_id = p_room_id and invited_user = auth.uid();

    insert into public.room_participants (room_id, user_id)
    values (p_room_id, auth.uid())
    on conflict (room_id, user_id) do nothing;

    select count(*) into v_unaccepted_count
    from public.room_invites
    where room_id = p_room_id and status <> 'accepted';

    if v_room.status = 'waiting' and v_unaccepted_count = 0 then
      update public.rooms set status = 'open'
      where id = p_room_id
      returning * into v_room;
    else
      select * into v_room from public.rooms where id = p_room_id;
    end if;
  else
    update public.room_invites
       set status = 'declined', responded_at = now()
     where room_id = p_room_id and invited_user = auth.uid();

    select * into v_room from public.rooms where id = p_room_id;
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
    or (v_invite_status = 'pending' and v_room.status in ('waiting','open','revealing'))
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
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_friend = auth.uid() then raise exception 'cannot invite yourself'; end if;
  if not public.is_room_participant(p_room_id) then raise exception 'not in room'; end if;

  select status into v_status from public.rooms where id = p_room_id;
  if v_status is null then raise exception 'room not found'; end if;
  if v_status = 'revealed' then raise exception 'room is already revealed'; end if;

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
  join public.rooms r on r.id = ri.room_id and r.status in ('waiting','open','revealing')
  join public.profiles ip on ip.id = ri.invited_by
  where ri.invited_user = v_me
    and ri.status = 'pending'
    and not public.is_room_participant(ri.room_id);

  return jsonb_build_object('profile', v_profile, 'incoming_requests', v_req_count, 'invites', v_invites);
end; $$;

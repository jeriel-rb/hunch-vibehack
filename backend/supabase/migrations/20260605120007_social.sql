-- Friend system + room invites.

-- A single canonical row per pair (user_low < user_high) avoids duplicates.
create table public.friendships (
  user_low uuid not null references auth.users(id) on delete cascade,
  user_high uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  requested_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_low, user_high),
  check (user_low < user_high)
);

create table public.room_invites (
  room_id uuid not null references public.rooms(id) on delete cascade,
  invited_user uuid not null references auth.users(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, invited_user)
);

create index on public.room_invites (invited_user);

alter table public.friendships enable row level security;
alter table public.room_invites enable row level security;

-- Reads only; all writes go through the SECURITY DEFINER RPCs below.
create policy friendships_select on public.friendships
  for select to authenticated using (user_low = auth.uid() or user_high = auth.uid());

create policy room_invites_select on public.room_invites
  for select to authenticated
  using (invited_user = auth.uid() or invited_by = auth.uid() or public.is_room_participant(room_id));

-- ---- Friend RPCs ---------------------------------------------------------

-- Send a friend request to a username (idempotent).
create or replace function public.send_friend_request(p_username text)
returns void language plpgsql security definer set search_path = public as $$
declare v_target uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select id into v_target from public.profiles where username = lower(p_username);
  if v_target is null then raise exception 'user not found'; end if;
  if v_target = auth.uid() then raise exception 'cannot add yourself'; end if;

  insert into public.friendships (user_low, user_high, status, requested_by)
  values (least(auth.uid(), v_target), greatest(auth.uid(), v_target), 'pending', auth.uid())
  on conflict (user_low, user_high) do nothing;
end; $$;

-- Accept or decline an incoming request (only the recipient may respond).
create or replace function public.respond_friend_request(p_other uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_lo uuid := least(auth.uid(), p_other); v_hi uuid := greatest(auth.uid(), p_other);
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_accept then
    update public.friendships set status = 'accepted'
     where user_low = v_lo and user_high = v_hi and status = 'pending' and requested_by <> auth.uid();
  else
    delete from public.friendships
     where user_low = v_lo and user_high = v_hi and requested_by <> auth.uid();
  end if;
end; $$;

-- Search users by username prefix, annotated with friendship status.
create or replace function public.search_users(p_query text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if coalesce(trim(p_query), '') = '' then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'username', p.username, 'display_name', p.display_name,
    'status', f.status, 'requested_by', f.requested_by
  )), '[]'::jsonb)
  into v
  from public.profiles p
  left join public.friendships f
    on f.user_low = least(v_me, p.id) and f.user_high = greatest(v_me, p.id)
  where p.id <> v_me and p.username ilike (lower(p_query) || '%')
  limit 10;
  return v;
end; $$;

-- Friends + incoming + outgoing pending, with profiles.
create or replace function public.get_social()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_friends jsonb; v_incoming jsonb; v_outgoing jsonb;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name) order by p.username), '[]'::jsonb)
    into v_friends
  from public.friendships f
  join public.profiles p on p.id = case when f.user_low = v_me then f.user_high else f.user_low end
  where (f.user_low = v_me or f.user_high = v_me) and f.status = 'accepted';

  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name)), '[]'::jsonb)
    into v_incoming
  from public.friendships f
  join public.profiles p on p.id = f.requested_by
  where (f.user_low = v_me or f.user_high = v_me) and f.status = 'pending' and f.requested_by <> v_me;

  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name)), '[]'::jsonb)
    into v_outgoing
  from public.friendships f
  join public.profiles p on p.id = case when f.user_low = v_me then f.user_high else f.user_low end
  where (f.user_low = v_me or f.user_high = v_me) and f.status = 'pending' and f.requested_by = v_me;

  return jsonb_build_object('friends', v_friends, 'incoming', v_incoming, 'outgoing', v_outgoing);
end; $$;

-- ---- Room invites --------------------------------------------------------

-- Invite a friend to a room (caller must be in the room).
create or replace function public.invite_to_room(p_room_id uuid, p_friend uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_room_participant(p_room_id) then raise exception 'not in room'; end if;
  insert into public.room_invites (room_id, invited_user, invited_by)
  values (p_room_id, p_friend, auth.uid())
  on conflict (room_id, invited_user) do nothing;
end; $$;

-- Home payload: profile, incoming-request count, and pending room invites.
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
      'code', r.code, 'question', r.question, 'category', r.category, 'inviter', ip.username
    )), '[]'::jsonb)
    into v_invites
  from public.room_invites ri
  join public.rooms r on r.id = ri.room_id and r.status <> 'revealed'
  join public.profiles ip on ip.id = ri.invited_by
  where ri.invited_user = v_me and not public.is_room_participant(ri.room_id);

  return jsonb_build_object('profile', v_profile, 'incoming_requests', v_req_count, 'invites', v_invites);
end; $$;

-- Live updates for requests + invites (rooms already added in an earlier migration).
alter publication supabase_realtime add table public.friendships;
alter publication supabase_realtime add table public.room_invites;

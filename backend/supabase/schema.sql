-- Hunch full schema — paste into the Supabase SQL Editor for project jdzcgsdtwsassowfooar
-- (generated from backend/supabase/migrations, in order)

-- ===== supabase/migrations/20260605120001_profiles.sql =====
-- Profiles mirror auth.users; a trigger creates one on signup.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text,
  avatar_url text,
  is_pro boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    -- prefer the chosen username; fall back to a stable unique handle
    lower(coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text, 1, 8))),
    coalesce(
      new.raw_user_meta_data->>'display_name',
      new.raw_user_meta_data->>'username',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Anonymous check used by the signup form (before the user has a session).
create or replace function public.username_available(p_username text)
returns boolean
language sql security definer set search_path = public stable
as $$
  select not exists (select 1 from public.profiles where username = lower(p_username));
$$;

-- ===== supabase/migrations/20260605120002_rooms.sql =====
-- Core tables. Counts are denormalized onto `rooms` so progress can be broadcast
-- via Realtime without ever sending answer content over the wire.
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid not null references auth.users(id) on delete cascade,
  question text not null default 'Where should we eat?',
  category text not null default 'eat' check (category in ('eat','travel','watch','other')),
  location_label text,
  lat double precision,
  lng double precision,
  status text not null default 'open' check (status in ('open','revealing','revealed')),
  participant_count int not null default 0,
  answered_count int not null default 0,
  result jsonb,
  created_at timestamptz not null default now(),
  revealed_at timestamptz
);

create table public.room_participants (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table public.answers (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index on public.room_participants (user_id);
create index on public.answers (room_id);

-- ===== supabase/migrations/20260605120003_counts_triggers.sql =====
-- Keep the denormalized counts on `rooms` in sync.

-- participant_count bumps when someone joins
create or replace function public.bump_participant_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.rooms set participant_count = participant_count + 1 where id = new.room_id;
  return new;
end; $$;

create trigger trg_bump_participants
  after insert on public.room_participants
  for each row execute function public.bump_participant_count();

-- answered_count bumps only on the FIRST answer (insert), not on edits (update)
create or replace function public.bump_answer_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.rooms set answered_count = answered_count + 1 where id = new.room_id;
  return new;
end; $$;

create trigger trg_bump_answers
  after insert on public.answers
  for each row execute function public.bump_answer_count();

-- ===== supabase/migrations/20260605120004_rls.sql =====
-- Row Level Security: this is where the privacy promise is enforced.
alter table public.rooms enable row level security;
alter table public.room_participants enable row level security;
alter table public.answers enable row level security;

-- Helper avoids RLS recursion when policies need a membership check.
create or replace function public.is_room_participant(p_room_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.room_participants
    where room_id = p_room_id and user_id = auth.uid()
  );
$$;

-- profiles: any signed-in user can read; update only self
create policy profiles_select on public.profiles
  for select to authenticated using (true);
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid());

-- rooms: host or participant can read; writes happen only via RPC / service role
create policy rooms_select on public.rooms
  for select to authenticated
  using (host_id = auth.uid() or public.is_room_participant(id));

-- participants: read rows of your rooms; insert only your own row
create policy participants_select on public.room_participants
  for select to authenticated using (public.is_room_participant(room_id));
create policy participants_insert_self on public.room_participants
  for insert to authenticated with check (user_id = auth.uid());

-- answers: read OWN always; read others ONLY when the room is revealed
create policy answers_select on public.answers
  for select to authenticated using (
    user_id = auth.uid()
    or exists (
      select 1 from public.rooms r
      where r.id = answers.room_id
        and r.status = 'revealed'
        and public.is_room_participant(r.id)
    )
  );

-- answers: write only your own, and only while you're a participant
create policy answers_insert_self on public.answers
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_room_participant(room_id));
create policy answers_update_self on public.answers
  for update to authenticated using (user_id = auth.uid());

-- ===== supabase/migrations/20260605120005_rpc.sql =====
-- RPC functions for the transactional CRUD. All SECURITY DEFINER, validating auth.uid().

-- create_room: generate a unique short code, insert the room, auto-join the host,
-- and pre-add selected accepted friends as room participants.
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
      -- unambiguous alphabet (no 0/O/1/I)
      v_code := v_code || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', floor(random() * 32)::int + 1, 1);
    end loop;
    exit when not exists (select 1 from public.rooms where code = v_code);
  end loop;

  insert into public.rooms (code, host_id, question, category, location_label, lat, lng)
  values (
    v_code, auth.uid(),
    coalesce(nullif(p_question, ''), 'Where should we eat?'),
    coalesce(nullif(p_category, ''), 'eat'),
    p_location_label, p_lat, p_lng
  )
  returning * into v_room;

  insert into public.room_participants (room_id, user_id) values (v_room.id, auth.uid());

  insert into public.room_participants (room_id, user_id)
  select v_room.id, member_id
  from unnest(v_member_ids) as members(member_id)
  on conflict (room_id, user_id) do nothing;

  return v_room;
end; $$;

-- join_room: idempotent join by code.
create or replace function public.join_room(p_code text)
returns public.rooms
language plpgsql security definer set search_path = public as $$
declare v_room public.rooms;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.rooms where code = upper(p_code);
  if v_room.id is null then raise exception 'room not found'; end if;
  insert into public.room_participants (room_id, user_id)
  values (v_room.id, auth.uid())
  on conflict (room_id, user_id) do nothing;
  return v_room;
end; $$;

-- submit_answer: upsert the caller's answer while the room is open.
create or replace function public.submit_answer(p_room_id uuid, p_body text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'empty answer'; end if;
  select status into v_status from public.rooms where id = p_room_id;
  if v_status is null then raise exception 'room not found'; end if;
  if v_status <> 'open' then raise exception 'room is not open'; end if;
  if not public.is_room_participant(p_room_id) then raise exception 'not a participant'; end if;
  insert into public.answers (room_id, user_id, body, updated_at)
  values (p_room_id, auth.uid(), p_body, now())
  on conflict (room_id, user_id) do update set body = excluded.body, updated_at = now();
end; $$;

-- get_room_state: full state for the caller. Other answers are included ONLY when revealed.
create or replace function public.get_room_state(p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_room public.rooms; v_my_answer text; v_answers jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.rooms where code = upper(p_code);
  if v_room.id is null then raise exception 'room not found'; end if;
  if not public.is_room_participant(v_room.id) then raise exception 'not a participant'; end if;

  select body into v_my_answer from public.answers
   where room_id = v_room.id and user_id = auth.uid();

  if v_room.status = 'revealed' then
    select jsonb_agg(jsonb_build_object('label', chr(64 + rn::int), 'body', body) order by rn)
      into v_answers
    from (
      select body, row_number() over (order by updated_at) as rn
      from public.answers where room_id = v_room.id
    ) t;
  end if;

  return jsonb_build_object(
    'id', v_room.id,
    'code', v_room.code,
    'question', v_room.question,
    'category', v_room.category,
    'location_label', v_room.location_label,
    'host_id', v_room.host_id,
    'is_host', v_room.host_id = auth.uid(),
    'status', v_room.status,
    'participant_count', v_room.participant_count,
    'answered_count', v_room.answered_count,
    'has_answered', v_my_answer is not null,
    'my_answer', v_my_answer,
    'result', v_room.result,
    'answers', v_answers
  );
end; $$;

-- ===== supabase/migrations/20260605120006_realtime.sql =====
-- Only the `rooms` row is broadcast over Realtime. Progress counts are denormalized
-- onto it, and the reveal flips status + writes result on the same row — so clients
-- get live updates without any answer content ever crossing Realtime.
alter publication supabase_realtime add table public.rooms;

-- ===== supabase/migrations/20260605120007_social.sql =====
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

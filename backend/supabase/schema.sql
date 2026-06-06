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

-- create_room: generate a unique short code, insert the room, auto-join the host.
create or replace function public.create_room(
  p_question text, p_category text, p_location_label text,
  p_lat double precision, p_lng double precision
) returns public.rooms
language plpgsql security definer set search_path = public as $$
declare v_code text; v_room public.rooms; i int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

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

-- ===== supabase/migrations/20260605120008_conversational.sql =====
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

-- ===== supabase/migrations/20260606112009_room_members.sql =====
-- Initialize selected members as room participants when the host creates a room.
-- Each member still signs in with their own session; this pre-creates access and
-- the participant count before the room opens.

drop function if exists public.create_room(text, text, text, double precision, double precision);

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

  insert into public.rooms (code, host_id, question, category, location_label, lat, lng)
  values (
    v_code, auth.uid(),
    coalesce(nullif(p_question, ''), 'Where should we eat?'),
    coalesce(nullif(p_category, ''), 'eat'),
    p_location_label, p_lat, p_lng
  )
  returning * into v_room;

  insert into public.room_participants (room_id, user_id)
  values (v_room.id, auth.uid());

  insert into public.room_participants (room_id, user_id)
  select v_room.id, member_id
  from unnest(v_member_ids) as members(member_id)
  on conflict (room_id, user_id) do nothing;

  return v_room;
end; $$;

-- ===== supabase/migrations/20260606130010_waiting_room_invites.sql =====
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

-- ===== supabase/migrations/20260606131520_waiting_room_status_guard.sql =====
-- Keep waiting rooms locked even if an older client/function tries to reveal.

create or replace function public.prevent_waiting_room_start()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'waiting'
     and new.status in ('revealing','revealed')
     and exists (
       select 1
       from public.room_invites ri
       where ri.room_id = old.id and ri.status <> 'accepted'
     ) then
    raise exception 'room is waiting for invited members';
  end if;

  return new;
end; $$;

drop trigger if exists trg_prevent_waiting_room_start on public.rooms;
create trigger trg_prevent_waiting_room_start
  before update of status on public.rooms
  for each row execute function public.prevent_waiting_room_start();

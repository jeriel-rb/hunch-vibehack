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

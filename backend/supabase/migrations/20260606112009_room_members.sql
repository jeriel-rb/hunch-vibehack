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

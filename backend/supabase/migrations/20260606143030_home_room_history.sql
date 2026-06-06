-- Home room history for Pro accounts. Free accounts receive the same preview
-- data, but the client keeps the room links locked.

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

-- Auto-resolve the restaurant vote so the room never stalls.
-- Once a direction is agreed, every shortlisted place is a good yes — so a 1-1-1
-- split no longer reopens the chat. Instead Hunch reveals the best-fit pick
-- (most votes, then highest-rated venue, then earliest decided) as soon as
-- everyone has voted. The chat phase still converges the direction beforehand.

create or replace function public.vote_place_option(p_option_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_room_id uuid;
  v_option_round int;
  v_room public.rooms;
  v_total int;
  v_votes_cast int;
  v_winner_id uuid;
  v_winner_votes int;
  v_winner public.room_place_options;
  v_options jsonb;
  v_majority boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select room_id, round into v_room_id, v_option_round
  from public.room_place_options
  where id = p_option_id;

  if v_room_id is null then raise exception 'option not found'; end if;
  if not public.is_room_participant(v_room_id) then raise exception 'not a participant'; end if;

  select * into v_room from public.rooms where id = v_room_id;
  if v_room.status <> 'choosing' then raise exception 'room is not choosing'; end if;
  if v_option_round <> v_room.round then raise exception 'option is not current'; end if;

  insert into public.room_place_votes (room_id, user_id, option_id, updated_at)
  values (v_room_id, auth.uid(), p_option_id, now())
  on conflict (room_id, user_id) do update set option_id = excluded.option_id, updated_at = now();

  v_total := greatest(v_room.participant_count, 1);

  -- Best-fit winner: most votes, then highest-rated venue, then earliest decided.
  select v.option_id, count(*)::int
    into v_winner_id, v_winner_votes
  from public.room_place_votes v
  join public.room_place_options o on o.id = v.option_id
  where v.room_id = v_room_id
    and o.round = v_room.round
  group by v.option_id
  order by count(*) desc,
           max((o.venue->>'rating')::numeric) desc nulls last,
           max(v.updated_at) asc
  limit 1;

  select count(*)::int into v_votes_cast
  from public.room_place_votes v
  join public.room_place_options o on o.id = v.option_id
  where v.room_id = v_room_id
    and o.round = v_room.round;

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
    and round = v_room.round;

  v_majority := coalesce(v_winner_votes, 0) > (v_total::numeric / 2);

  -- Reveal once a majority emerges, or once everyone has voted (best-fit breaks ties).
  if v_majority or v_votes_cast >= v_total then
    select * into v_winner from public.room_place_options where id = v_winner_id;

    update public.rooms
      set status = 'revealed',
          result = jsonb_build_object(
            'summary', coalesce(nullif(v_winner.rationale, ''), 'Hunch found the yes.'),
            'cuisine', v_winner.cuisine,
            'reasons', to_jsonb(v_winner.reasons),
            'ruled_out', to_jsonb(v_winner.ruled_out),
            'venue', v_winner.venue,
            'options', v_options,
            'selected_option_id', v_winner.id,
            'success_title', 'Consensus unlocked',
            'success_copy', case when v_majority
              then 'No group chat chaos required. Hunch found the yes.'
              else 'Close call — Hunch landed on the spot everyone can say yes to.' end
          ),
          revealed_at = now()
    where id = v_room_id;

    return jsonb_build_object('status', 'revealed', 'winner_id', v_winner_id);
  end if;

  return jsonb_build_object('status', 'choosing', 'votes_cast', v_votes_cast, 'participant_count', v_total);
end; $$;

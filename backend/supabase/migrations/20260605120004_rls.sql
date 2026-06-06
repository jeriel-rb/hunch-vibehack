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

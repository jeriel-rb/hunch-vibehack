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

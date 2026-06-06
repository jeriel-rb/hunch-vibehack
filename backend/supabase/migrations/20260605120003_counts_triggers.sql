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

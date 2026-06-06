-- Only the `rooms` row is broadcast over Realtime. Progress counts are denormalized
-- onto it, and the reveal flips status + writes result on the same row — so clients
-- get live updates without any answer content ever crossing Realtime.
alter publication supabase_realtime add table public.rooms;

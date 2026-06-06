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

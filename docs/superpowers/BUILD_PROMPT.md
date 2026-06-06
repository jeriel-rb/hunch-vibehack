# Hunch — Full Build Prompt (paste into your coding agent)

> Copy everything below the line into a coding agent (Codex / Claude Code) in an empty folder. It builds the whole app end-to-end. Replace the secrets in §0 when you have them.

---

## ROLE & MISSION

You are an expert full-stack engineer. Build **Hunch**, a mobile-first PWA for AI group **food** decisions, minus the social pressure.

Core loop: a signed-in **host** opens a room (category, question, location) and shares a link. Each participant signs in and answers privately in a **guided chat** (budget → cuisine → avoid → freestyle) — nobody sees anyone else's answers. The host taps **Find the yes**; an AI reads everyone's pooled answers and returns **either** a consensus pick (a real nearby restaurant via Google Places) **or** one tie-breaker question posted to everyone for another round. Plus: accounts, a friends system, and a category home where only "Where to eat" is free (others are Pro-locked).

Work in phases; after each, run `npx tsc --noEmit` and `npm run build` (frontend) and `deno test` (edge function) and fix everything before moving on.

## 0. STACK (non-negotiable) + SECRETS

- **Frontend:** Next.js 16 (App Router, TS, Turbopack), React 19, Tailwind **v4**, shadcn/ui, `@supabase/ssr`, `next-themes`, `lucide-react`, `sonner`.
- **Backend:** hosted **Supabase** (Postgres + RLS + RPC + Realtime + one Deno Edge Function).
- **AI:** OpenAI `gpt-4o` (JSON mode). **Places:** Google Places API (New) + Geocoding API.
- Monorepo: `frontend/` (Next app) and `backend/` (Supabase). Deploy frontend on Vercel (root `frontend`).

Secrets to fill in:
```
NEXT_PUBLIC_SUPABASE_URL=        # https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=   # sb_publishable_...
GOOGLE_PLACES_API_KEY=           # server-only; Geocoding API enabled
OPENAI_API_KEY=                  # sk-... (edge function secret)
# GOOGLE_PLACES_API_KEY also set as an edge function secret (Places API New)
```

## ⚠️ CRITICAL GOTCHAS (this exact stack)

1. **Next 16 renamed middleware → `proxy.ts`.** Export a function named `proxy`; runs on Node runtime. (Used for Supabase session refresh.)
2. **Next 16 async APIs:** `await cookies()`, `params: Promise<…>` (await it), `searchParams` async.
3. **Next 16 images:** use `images.remotePatterns` (not `domains`); render Google photos with `unoptimized`.
4. **shadcn here runs on Base UI**, not Radix. Composition uses a **`render` prop**, NOT `asChild`. E.g. `<Button render={<Link href="/x" />}>Go</Button>` and `<DialogTrigger render={<Button />}>…</DialogTrigger>`.
5. **Tailwind v4:** theme tokens live in CSS (`@theme inline` + `:root`/`.dark`), not a `tailwind.config`.
6. Keep Supabase JS clients **untyped** (skip the DB generic) and cast RPC results to hand-written domain types — fastest path.

## SETUP

```bash
npx create-next-app@latest frontend --typescript --tailwind --app --eslint --no-src-dir --import-alias "@/*" --use-npm --turbopack --disable-git --yes
cd frontend
npm i @supabase/supabase-js @supabase/ssr next-themes
npm i -D @playwright/test
npx shadcn@latest init -d
npx shadcn@latest add button input textarea card label sonner skeleton dialog tabs avatar badge
cd .. && mkdir -p backend && (cd backend && supabase init)
```

## 1. BACKEND — apply this schema verbatim

Run the full SQL below **once** on a fresh Supabase project (SQL editor, or `psql "<session-pooler-uri>" -f schema.sql`). It creates tables, RLS (the privacy guarantee), all RPCs, realtime, and the conversational `responses` model.

```sql
-- ===== profiles =====
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
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    lower(coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text, 1, 8))),
    coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
create or replace function public.username_available(p_username text)
returns boolean language sql security definer set search_path = public stable as $$
  select not exists (select 1 from public.profiles where username = lower(p_username));
$$;

-- ===== rooms / participants / answers (counts denormalized for realtime) =====
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid not null references auth.users(id) on delete cascade,
  question text not null default 'Where should we eat?',
  category text not null default 'eat' check (category in ('eat','travel','watch','other')),
  location_label text, lat double precision, lng double precision,
  status text not null default 'open' check (status in ('open','revealing','revealed')),
  participant_count int not null default 0,
  answered_count int not null default 0,
  round int not null default 0,
  followups text[] not null default '{}',
  result jsonb,
  created_at timestamptz not null default now(), revealed_at timestamptz
);
create table public.room_participants (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index on public.room_participants (user_id);

-- ===== count triggers =====
create or replace function public.bump_participant_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin update public.rooms set participant_count = participant_count + 1 where id = new.room_id; return new; end; $$;
create trigger trg_bump_participants after insert on public.room_participants for each row execute function public.bump_participant_count();

-- ===== responses (one private row per participant) =====
create table public.responses (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,   -- { budget, style, avoid, freestyle, followups: [] }
  ready boolean not null default false,
  answered_round int not null default -1,
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index on public.responses (room_id);

-- ===== friends + room invites =====
create table public.friendships (
  user_low uuid not null references auth.users(id) on delete cascade,
  user_high uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  requested_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_low, user_high), check (user_low < user_high)
);
create table public.room_invites (
  room_id uuid not null references public.rooms(id) on delete cascade,
  invited_user uuid not null references auth.users(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, invited_user)
);
create index on public.room_invites (invited_user);

-- ===== RLS =====
alter table public.rooms enable row level security;
alter table public.room_participants enable row level security;
alter table public.responses enable row level security;
alter table public.friendships enable row level security;
alter table public.room_invites enable row level security;
create or replace function public.is_room_participant(p_room_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.room_participants where room_id = p_room_id and user_id = auth.uid());
$$;
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid());
create policy rooms_select on public.rooms for select to authenticated using (host_id = auth.uid() or public.is_room_participant(id));
create policy participants_select on public.room_participants for select to authenticated using (public.is_room_participant(room_id));
create policy participants_insert_self on public.room_participants for insert to authenticated with check (user_id = auth.uid());
create policy responses_rw_self on public.responses for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy friendships_select on public.friendships for select to authenticated using (user_low = auth.uid() or user_high = auth.uid());
create policy room_invites_select on public.room_invites for select to authenticated using (invited_user = auth.uid() or invited_by = auth.uid() or public.is_room_participant(room_id));

-- ===== RPCs =====
create or replace function public.create_room(p_question text, p_category text, p_location_label text, p_lat double precision, p_lng double precision)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare v_code text; v_room public.rooms; i int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  loop
    v_code := '';
    for i in 1..6 loop v_code := v_code || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', floor(random()*32)::int + 1, 1); end loop;
    exit when not exists (select 1 from public.rooms where code = v_code);
  end loop;
  insert into public.rooms (code, host_id, question, category, location_label, lat, lng)
  values (v_code, auth.uid(), coalesce(nullif(p_question,''),'Where should we eat?'), coalesce(nullif(p_category,''),'eat'), p_location_label, p_lat, p_lng)
  returning * into v_room;
  insert into public.room_participants (room_id, user_id) values (v_room.id, auth.uid());
  return v_room;
end; $$;

create or replace function public.join_room(p_code text)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare v_room public.rooms;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.rooms where code = upper(p_code);
  if v_room.id is null then raise exception 'room not found'; end if;
  insert into public.room_participants (room_id, user_id) values (v_room.id, auth.uid()) on conflict do nothing;
  return v_room;
end; $$;

create or replace function public.submit_response(p_room_id uuid, p_answers jsonb, p_ready boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_round int; v_count int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_room_participant(p_room_id) then raise exception 'not a participant'; end if;
  select round into v_round from public.rooms where id = p_room_id;
  insert into public.responses (room_id, user_id, answers, ready, answered_round, updated_at)
  values (p_room_id, auth.uid(), coalesce(p_answers,'{}'::jsonb), p_ready, case when p_ready then v_round else -1 end, now())
  on conflict (room_id, user_id) do update set
    answers = public.responses.answers || coalesce(excluded.answers,'{}'::jsonb),
    ready = excluded.ready or public.responses.ready,
    answered_round = case when p_ready then v_round else public.responses.answered_round end,
    updated_at = now();
  select count(*) into v_count from public.responses where room_id = p_room_id and answered_round >= v_round;
  update public.rooms set answered_count = v_count where id = p_room_id;
end; $$;

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
    select jsonb_agg(jsonb_build_object('label', chr(64 + rn::int), 'answers', answers) order by rn) into v_responses
    from (select answers, row_number() over (order by updated_at) as rn from public.responses where room_id = v_room.id) t;
  end if;
  return jsonb_build_object(
    'id', v_room.id, 'code', v_room.code, 'question', v_room.question, 'category', v_room.category,
    'location_label', v_room.location_label, 'host_id', v_room.host_id, 'is_host', v_room.host_id = auth.uid(),
    'status', v_room.status, 'round', v_room.round, 'followups', to_jsonb(v_room.followups),
    'participant_count', v_room.participant_count, 'answered_count', v_room.answered_count,
    'my_answers', coalesce(v_mine.answers,'{}'::jsonb), 'my_round', coalesce(v_mine.answered_round,-1),
    'result', v_room.result, 'responses', v_responses);
end; $$;

create or replace function public.send_friend_request(p_username text)
returns void language plpgsql security definer set search_path = public as $$
declare v_target uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select id into v_target from public.profiles where username = lower(p_username);
  if v_target is null then raise exception 'user not found'; end if;
  if v_target = auth.uid() then raise exception 'cannot add yourself'; end if;
  insert into public.friendships (user_low, user_high, status, requested_by)
  values (least(auth.uid(), v_target), greatest(auth.uid(), v_target), 'pending', auth.uid()) on conflict do nothing;
end; $$;

create or replace function public.respond_friend_request(p_other uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_lo uuid := least(auth.uid(), p_other); v_hi uuid := greatest(auth.uid(), p_other);
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_accept then update public.friendships set status='accepted' where user_low=v_lo and user_high=v_hi and status='pending' and requested_by <> auth.uid();
  else delete from public.friendships where user_low=v_lo and user_high=v_hi and requested_by <> auth.uid(); end if;
end; $$;

create or replace function public.search_users(p_query text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if coalesce(trim(p_query),'') = '' then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'status',f.status,'requested_by',f.requested_by)), '[]'::jsonb) into v
  from public.profiles p
  left join public.friendships f on f.user_low = least(v_me,p.id) and f.user_high = greatest(v_me,p.id)
  where p.id <> v_me and p.username ilike (lower(p_query) || '%') limit 10;
  return v;
end; $$;

create or replace function public.get_social()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_friends jsonb; v_incoming jsonb; v_outgoing jsonb;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name) order by p.username),'[]'::jsonb) into v_friends
  from public.friendships f join public.profiles p on p.id = case when f.user_low=v_me then f.user_high else f.user_low end
  where (f.user_low=v_me or f.user_high=v_me) and f.status='accepted';
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name)),'[]'::jsonb) into v_incoming
  from public.friendships f join public.profiles p on p.id = f.requested_by
  where (f.user_low=v_me or f.user_high=v_me) and f.status='pending' and f.requested_by <> v_me;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name)),'[]'::jsonb) into v_outgoing
  from public.friendships f join public.profiles p on p.id = case when f.user_low=v_me then f.user_high else f.user_low end
  where (f.user_low=v_me or f.user_high=v_me) and f.status='pending' and f.requested_by = v_me;
  return jsonb_build_object('friends',v_friends,'incoming',v_incoming,'outgoing',v_outgoing);
end; $$;

create or replace function public.invite_to_room(p_room_id uuid, p_friend uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_room_participant(p_room_id) then raise exception 'not in room'; end if;
  insert into public.room_invites (room_id, invited_user, invited_by) values (p_room_id, p_friend, auth.uid()) on conflict do nothing;
end; $$;

create or replace function public.get_home()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_profile jsonb; v_invites jsonb; v_req int;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select jsonb_build_object('id',id,'username',username,'display_name',display_name,'is_pro',is_pro) into v_profile from public.profiles where id=v_me;
  select count(*) into v_req from public.friendships where (user_low=v_me or user_high=v_me) and status='pending' and requested_by<>v_me;
  select coalesce(jsonb_agg(jsonb_build_object('code',r.code,'question',r.question,'category',r.category,'inviter',ip.username)),'[]'::jsonb) into v_invites
  from public.room_invites ri join public.rooms r on r.id=ri.room_id and r.status<>'revealed' join public.profiles ip on ip.id=ri.invited_by
  where ri.invited_user=v_me and not public.is_room_participant(ri.room_id);
  return jsonb_build_object('profile',v_profile,'incoming_requests',v_req,'invites',v_invites);
end; $$;

-- ===== realtime (only these rows are broadcast; RLS-scoped) =====
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.friendships;
alter publication supabase_realtime add table public.room_invites;
```

Then in the Supabase dashboard: **Authentication → Email → turn OFF "Confirm email"** (instant signup), and add your site URL + `/auth/callback` to the redirect allowlist.

## 2. EDGE FUNCTION `reveal-decision` (Deno)

Folder `backend/supabase/functions/reveal-decision/` with pure-logic modules (unit-tested via `deno test`) + a handler.

**Flow:** verify JWT → caller must be `rooms.host_id`; if `revealed`, return existing `result` (idempotent). Set `status='revealing'`. Read `responses where ready=true` (service role). Build a labeled transcript `A. budget $$; style Japanese; avoid too spicy; note: …`. Call OpenAI. Then:
- **Split** → append `followup_question` to `rooms.followups`, `round=round+1`, `answered_count=0`, `status='open'`; return `{consensus:false, followup_question}`.
- **Consensus** → Google Places (Text Search, location-biased to lat/lng), pick best-rated open match → `venue {name,address,rating,price_level,photo_url,maps_url,walk_minutes}` (haversine ÷ 80 m/min; `null` if Places fails). Write `result {summary,cuisine,reasons[],ruled_out[],venue}` + `status='revealed'`.

**OpenAI** (`gpt-4o`, `response_format:{type:"json_object"}`, temp 0.4). **System prompt:**
```
You are Hunch. A group is privately deciding where to eat. Each line (A, B, C…) is one
person's private preferences: budget, cuisine style, things to avoid, and free notes.
Find the single restaurant TYPE the whole group is secretly happy with. Respect everyone's
budget and honor every "avoid". Find the overlap nobody said out loud.
Return ONLY strict JSON, one of two shapes:
If you can confidently pick:
{"consensus": true, "summary": "...", "cuisine": "...", "places_query": "google maps query",
 "reasons": ["2-4 reasons like '3 of 5 wanted comfort food'"], "ruled_out": ["e.g. '4 of 5 ruled out spicy'"]}
If genuinely split:
{"consensus": false, "followup_question": "ONE short question (max 12 words) to break the tie"}
Prefer consensus:true unless there is a real conflict.
```
**Places (New) call:** `POST https://places.googleapis.com/v1/places:searchText` with headers `X-Goog-Api-Key`, `X-Goog-FieldMask: places.displayName,places.formattedAddress,places.rating,places.priceLevel,places.googleMapsUri,places.location,places.photos`, body `{textQuery, openNow:true, maxResultCount:8, locationBias:{circle:{center:{latitude,longitude},radius:2000}}}`. Photo media URL: `https://places.googleapis.com/v1/<photo.name>/media?maxHeightPx=400&key=<key>`. priceLevel enum → 1–4.

Deploy: `supabase functions deploy reveal-decision` (keep `verify_jwt=true`); `supabase secrets set OPENAI_API_KEY=… GOOGLE_PLACES_API_KEY=…`.

## 3. FRONTEND FOUNDATION

**`lib/supabase/client.ts`** → `createBrowserClient(URL, ANON)`.
**`lib/supabase/server.ts`** → `await cookies()` + `createServerClient` with `getAll/setAll` (wrap `setAll` in try/catch).
**`lib/supabase/proxy.ts`** → `updateSession(req)`: if env missing return `NextResponse.next`; else `createServerClient` with request/response cookie plumbing + `await supabase.auth.getUser()`.
**`proxy.ts`** (root):
```ts
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
export async function proxy(request: NextRequest) { return updateSession(request); }
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.svg|.*\\.png$).*)"] };
```

**`app/globals.css`** — keep shadcn's `@theme inline`/`@custom-variant dark`, add `--font-display: var(--font-display)` and `--color-success`/`--color-success-bg`, and set tokens (light default; **default theme is dark**):
```css
:root{
  --background:#f6f6f7; --foreground:#111111; --card:#ffffff; --card-foreground:#111111;
  --popover:#ffffff; --popover-foreground:#111111; --primary:#7c5cff; --primary-foreground:#ffffff;
  --secondary:#f1f1f4; --secondary-foreground:#111111; --muted:#f1f1f4; --muted-foreground:#6d6d6d;
  --accent:#efe9ff; --accent-foreground:#5b3fc4; --destructive:#dc2626; --border:#e7e7e7; --input:#e7e7e7;
  --ring:#7c5cff; --success:#16a34a; --success-bg:#dcfce7; --radius:1rem;
}
.dark{
  --background:#0d0d12; --foreground:#f5f5f7; --card:#16161f; --card-foreground:#f5f5f7;
  --popover:#16161f; --popover-foreground:#f5f5f7; --primary:#8b6dff; --primary-foreground:#ffffff;
  --secondary:#1f1f2b; --secondary-foreground:#f5f5f7; --muted:#1f1f2b; --muted-foreground:#9aa0ac;
  --accent:#211d33; --accent-foreground:#c9b8ff; --destructive:#ff6b5e; --border:#262631; --input:#262631;
  --ring:#8b6dff; --success:#34d399; --success-bg:#10271d;
}
```

**`app/layout.tsx`** — `Plus_Jakarta_Sans` as `--font-sans`, `Fraunces` as `--font-display`; `<html suppressHydrationWarning className="<vars>">`; wrap children in a `next-themes` provider (`attribute="class" defaultTheme="dark" enableSystem={false}`); `<Toaster position="top-center"/>`. Add PWA `manifest.webmanifest` + `icon.svg`.

## 4. DESIGN SYSTEM (light + dark, purple primary, tucope-style)

- **Make the Button base `rounded-full`** (pills everywhere). Cards: `rounded-2xl/3xl bg-card border border-border shadow-sm`. Chips: `rounded-full border bg-card px-4 py-2 active:scale-95 hover:border-primary hover:text-primary`.
- Headers use `font-display` (Fraunces); body Plus Jakarta Sans. Mobile-first: `max-w-md` columns, `min-h-dvh`, large tap targets.
- A `ThemeToggle` (sun/moon, `useTheme`) in the home header.

## 5. AUTH (`/login`)

Tabs (Base UI): **Create account** (username + email + password; validate `^[a-z0-9_]{3,20}$`, pre-check `username_available`, then `supabase.auth.signUp({email,password,options:{data:{username,display_name:username}}})` → if `data.session` go to `next`, else "confirm email") and **Log in** (`signInWithPassword`). `app/auth/callback/route.ts` does `exchangeCodeForSession`.

## 6. HOME + CATEGORIES + PRO

`app/page.tsx` (server): if user, `get_home()` → `HomeDashboard`; else landing + "Get started". `HomeDashboard`: greeting `@username`, **category grid**, Friends button with incoming-request badge, room-invite list (tap → `/room/<code>`), theme toggle, sign out. Subscribe to `friendships` + `room_invites` realtime → re-fetch `get_home`.
**Categories** (`lib/categories.ts`): `eat` (free), `travel`/`watch`/`other` (Pro-locked). Locked cards show a "Pro" badge and open an "Upgrade to Pro — coming soon" dialog (no payments).

## 7. CREATE (`/create/[category]`)

Server guards auth + Pro (`profiles.is_pro` for locked categories). `CreateRoom`: question (default per category) + location (browser geolocation **or** typed → `GET /api/geocode?q=` → Google Geocoding → lat/lng before `create_room`). `create_room(question, category, label, lat, lng)` → `/room/<code>`.

## 8. ROOM — the conversational chat (the centerpiece)

`app/room/[code]/page.tsx` (server): auth guard, `join_room`, `get_room_state` → `RoomClient`. `RoomClient`: subscribe to the `rooms` row → on update re-fetch `get_room_state`. If `revealed` → `RevealCard`; else → `ChatRoom`. Header has Share (Web Share/copy) + host **Invite friends** dialog (`get_social` → `invite_to_room`).

**`ChatRoom`** — a private chat (AI bubbles left in a card, user bubbles right in primary, options as chips). Scripted food rounds:
- **R1 budget** → chips `$ · $$ · $$$`
- **R2 cuisine** → chips `🍜 Japanese · 🍔 Western · 🥟 Chinese · Surprise me` (+ free text)
- **R3 avoid** → chips `Too spicy · Too heavy · Nothing, I'm open` (+ free text)
- **R4 freestyle** → optional free text (Send or Skip)

Persist answers in local state; on finishing R4 call `submit_response({budget,style,avoid,freestyle}, ready=true)` (round 0). Derive shown history from `my_answers` + `rooms.followups`; `caughtUp = my_round >= round`. **Follow-up loop:** host taps **Find the yes** → `POST <SUPABASE_URL>/functions/v1/reveal-decision` with the user's access token. If `{consensus:false}` the realtime room update bumps `round` + appends a follow-up → every client shows the new AI question (free-text answer → `submit_response({followups:[…full…]}, ready=true)`). If consensus → `RevealCard`: the pick, real venue (photo, ★rating, "X min away", price, Open in Maps), ✓ reasons, and an expandable "what everyone said" from `state.responses`.

Domain types (`lib/types.ts`): `RoomState { id, code, question, category, location_label, host_id, is_host, status, round, followups[], participant_count, answered_count, my_answers:{budget?,style?,avoid?,freestyle?,followups?[]}, my_round, result, responses }`.

## 9. FRIENDS

`/friends` (`get_social`): your add-me link `<origin>/add-friend/<username>` (copy), username **search** (`search_users`) + Add (`send_friend_request`), **incoming requests** Accept/Decline (`respond_friend_request`), friends list. Subscribe to `friendships` realtime. `/add-friend/[username]` (server-guarded): look up the profile, button sends a request.

## ACCEPTANCE CRITERIA

- `npx tsc --noEmit` and `npm run build` pass; `deno test` for the edge function passes.
- Sign up → home → "Where to eat" → start a room → chat the 4 rounds; a 2nd account joins via link, both go "ready", **no answer text crosses Realtime before reveal** (RLS), host "Find the yes" → both see the same pick (+ venue when keys set), or a follow-up question appears and re-checks to a pick.
- Locked categories show the Pro dialog. Friends: search, request, accept, invite-to-room all work. Light/dark toggle works; default dark.

## KEY SNIPPETS (the gotchas)

```tsx
// Base UI render prop (NOT asChild)
<Button render={<Link href="/login" />}>Get started</Button>
<DialogTrigger render={<Button variant="secondary" size="sm" />}>Invite</DialogTrigger>

// server page reading async params (Next 16)
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params; /* … */
}

// host reveal call
const { data: { session } } = await supabase.auth.getSession();
await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/reveal-decision`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
  body: JSON.stringify({ room_id }),
});
```

Build it. Keep files small and focused. Verify after every phase.

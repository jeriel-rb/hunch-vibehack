# Hunch — Complete Project Plan & Spec

> Everyone already agrees. Hunch just finds it.
> AI group **food** decisions, minus the social pressure. A group answers privately in a guided chat; the AI surfaces the option everyone secretly agrees on and recommends a real nearby restaurant.

This single document is the full spec + build plan to recreate the app from scratch. Date: 2026-06-05.

---

## 1. Product

A mobile-first PWA. Core loop:

1. A signed-in **host** picks a category (only **Where to eat** is free; others are Pro-locked), names the question, sets a location, and shares a link (or invites friends).
2. Each participant signs in and goes through a **private guided chat** with "Hunch": budget → cuisine style → things to avoid → freestyle. Nobody sees anyone else's answers.
3. The host taps **Find the yes**. The AI reads everyone's pooled answers and returns **either** a consensus pick (a real restaurant via Google Places) **or** one tie-breaker question posted to everyone for another round.

Design pillars: privacy (answers hidden until reveal, enforced in the DB), conversational input (chat + quick-reply chips), and one-tap sharing.

### Scope
- **In:** accounts (email+password+username), friends (search + requests + add-me link), category home with a Pro gate, the conversational room (rounds + follow-up loop), AI reveal with a real venue, realtime progress, light + dark themes, PWA.
- **Out (future):** real data for non-food categories (movies/travel), payments for Pro, native apps, multi-host rooms.

---

## 2. Tech stack

- **Frontend:** Next.js 16 (App Router, TypeScript, Turbopack), React 19, Tailwind v4, shadcn/ui (on **Base UI** — composition uses a `render` prop, not `asChild`), `@supabase/ssr`, `next-themes`, `lucide-react`, `sonner`.
- **Backend:** hosted **Supabase** — Postgres + RLS + RPC + Realtime + one Deno **Edge Function**.
- **AI:** OpenAI `gpt-4o` (JSON mode). **Places:** Google Places API (New) Text Search + Geocoding API.
- **Hosting:** Vercel (frontend, root dir `frontend`), Supabase (backend).

> **Next.js 16 gotchas:** middleware is renamed to **`proxy.ts`** (export `proxy`, Node runtime); `cookies()`/`params`/`searchParams` are async; `images.domains` → `images.remotePatterns`. Read `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md` before touching framework files.

---

## 3. Repository structure

```
hunch-app/
├── frontend/                      # Next.js 16 app (deploy root on Vercel)
│   ├── app/
│   │   ├── layout.tsx             # fonts (Plus Jakarta Sans + Fraunces), ThemeProvider, metadata, PWA
│   │   ├── globals.css            # Tailwind v4 + light (:root) and dark (.dark) tokens
│   │   ├── page.tsx               # authed → HomeDashboard; logged-out → landing
│   │   ├── login/page.tsx         # signup/login tabs (email+password+username)
│   │   ├── auth/callback/route.ts # email-confirmation code exchange
│   │   ├── api/geocode/route.ts   # typed area → lat/lng (Google Geocoding)
│   │   ├── create/[category]/page.tsx   # auth + Pro gate → CreateRoom
│   │   ├── friends/page.tsx       # FriendsClient
│   │   ├── add-friend/[username]/page.tsx # add-me link target
│   │   └── room/[code]/
│   │       ├── page.tsx           # auth guard, join, initial get_room_state
│   │       └── room-client.tsx    # realtime + ChatRoom / RevealCard
│   ├── components/
│   │   ├── create-room.tsx        # title + location + create_room(category)
│   │   ├── category-grid.tsx      # category cards + Pro dialog
│   │   ├── home-dashboard.tsx     # greeting, categories, invites, friends badge, theme toggle
│   │   ├── chat-room.tsx          # the conversational room (rounds, chips, follow-up, host reveal)
│   │   ├── reveal-card.tsx        # the pick + venue + reasons + "what everyone said"
│   │   ├── friends-client.tsx     # search, requests, friends list, add-me link
│   │   ├── add-friend-button.tsx
│   │   ├── invite-friends.tsx     # host dialog: invite friends to a room
│   │   ├── share-button.tsx       # Web Share / copy link
│   │   ├── theme-toggle.tsx       # light/dark switch
│   │   └── ui/                    # shadcn (Base UI) primitives
│   ├── lib/
│   │   ├── supabase/{client,server,proxy}.ts
│   │   ├── types.ts               # domain types mirroring RPC/edge shapes
│   │   ├── rounds.ts              # the scripted food rounds
│   │   └── categories.ts          # category registry (eat free; others Pro)
│   ├── proxy.ts                   # Next 16 "middleware" → session refresh
│   ├── public/{manifest.webmanifest,icon.svg}
│   └── e2e/hunch.spec.ts
└── backend/
    └── supabase/
        ├── migrations/            # 0001..0008 (ordered)
        ├── schema.sql             # all migrations concatenated (paste into SQL editor)
        └── functions/reveal-decision/  # index + transcript/consensus/places/prompt + tests
```

---

## 4. Environment & accounts

**Supabase project:** create a dedicated project. Current one: ref `jdzcgsdtwsassowfooar`, region Tokyo (`aws-1-ap-northeast-1`).

| Var | Where | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `frontend/.env.local` + Vercel | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `frontend/.env.local` + Vercel | publishable key (`sb_publishable_…`) |
| `GOOGLE_PLACES_API_KEY` | `frontend/.env.local` + Vercel (server-only) | `/api/geocode`; enable **Geocoding API** |
| `OPENAI_API_KEY` | Supabase Edge Function secret | reveal synthesis (`sk-…`) |
| `GOOGLE_PLACES_API_KEY` | Supabase Edge Function secret | enable **Places API (New)** |
| `SUPABASE_DB_URL` | `backend/.env` (gitignored) | session pooler URI for `psql` migrations |

`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are injected into the edge function automatically.

**Supabase Auth config:** add Site URL (Vercel prod URL + `http://localhost:3000`) and `/auth/callback` to the redirect allowlist. For a smooth demo, **disable "Confirm email"** (Authentication → Email).

---

## 5. Data model (Postgres, schema `public`)

```
profiles
  id           uuid PK → auth.users.id (cascade)
  username     text UNIQUE NOT NULL  check ~ '^[a-z0-9_]{3,20}$'
  display_name text
  avatar_url   text
  is_pro       boolean NOT NULL default false
  created_at   timestamptz default now()

rooms
  id              uuid PK default gen_random_uuid()
  code            text UNIQUE              -- 6-char A–Z2–9 (no 0/O/1/I)
  host_id         uuid → auth.users.id
  question        text default 'Where should we eat?'
  category        text default 'eat'  check in ('eat','travel','watch','other')
  location_label  text
  lat, lng        double precision
  status          text default 'open' check in ('open','revealing','revealed')
  round           int  default 0           -- 0 = initial rounds; 1+ = follow-up rounds
  followups       text[] default '{}'      -- AI tie-breaker questions, indexed by round-1
  participant_count int default 0          -- denormalized (trigger)
  answered_count  int default 0            -- # participants ready for the current round
  result          jsonb                    -- reveal payload (see §8)
  created_at, revealed_at timestamptz

room_participants
  (room_id, user_id) PK         -- the "of N" denominator
  joined_at timestamptz

responses                       -- one private row per participant
  (room_id, user_id) PK
  answers       jsonb default '{}'   -- { budget, style, avoid, freestyle, followups: [] }
  ready         boolean default false
  answered_round int default -1      -- highest round this user has completed
  updated_at timestamptz

friendships                     -- canonical pair, user_low < user_high
  (user_low, user_high) PK
  status       text default 'pending' check in ('pending','accepted')
  requested_by uuid → auth.users.id
  created_at timestamptz

room_invites
  (room_id, invited_user) PK
  invited_by uuid → auth.users.id
  created_at timestamptz

answers (legacy v1, unused by the chat flow; kept harmless)
```

Triggers: `handle_new_user` (creates a profile from signup metadata, username fallback `user_<8hex>`); `bump_participant_count` on join; `bump_answer_count` (legacy). Counts are denormalized onto `rooms` so progress can be broadcast via Realtime **without sending answer content**.

---

## 6. Row Level Security (the privacy guarantee)

RLS is enabled on every table; all policies are `to authenticated`.

- **profiles:** read any (for friend search); update only self.
- **rooms:** read if `host_id = auth.uid()` OR you're a participant (`is_room_participant(id)`). No direct writes — only RPC (SECURITY DEFINER) and the service-role edge function.
- **room_participants:** read rows of your rooms; insert only your own row.
- **responses:** **own row only** for all operations. Other people's answers are *never* directly selectable; they're exposed solely via `get_room_state` (SECURITY DEFINER) and only when `status = 'revealed'`.
- **friendships:** read pairs you're in; writes via RPC only.
- **room_invites:** read if invited_user/invited_by is you or you're in the room.

`is_room_participant(room_id)` is a SECURITY DEFINER helper used inside policies to avoid recursion.

---

## 7. RPC functions (all SECURITY DEFINER, validate `auth.uid()`)

- `username_available(p_username) → boolean` — pre-signup check (callable by anon).
- `create_room(p_question, p_category, p_location_label, p_lat, p_lng) → rooms` — unique code, insert, auto-join host.
- `join_room(p_code) → rooms` — idempotent join by code.
- `submit_response(p_room_id, p_answers jsonb, p_ready boolean)` — merges `answers` (jsonb `||`), sets `answered_round = rooms.round` when ready, recomputes `rooms.answered_count = count(responses where answered_round >= rooms.round)`.
- `get_room_state(p_code) → jsonb` — room fields + `round` + `followups` + counts + `my_answers` + `my_round` + `result`; includes all participants' `responses` (labeled A,B,…) **only when revealed**.
- `search_users(p_query) → jsonb` — username prefix search, annotated with friendship status.
- `send_friend_request(p_username)` / `respond_friend_request(p_other, p_accept)` — request / accept|decline (only the recipient can respond).
- `get_social() → jsonb` — `{ friends, incoming, outgoing }` with profiles.
- `invite_to_room(p_room_id, p_friend)` — caller must be in the room.
- `get_home() → jsonb` — `{ profile, incoming_requests, invites }` (pending room invites not yet joined).

---

## 8. Edge Function `reveal-decision` (Deno)

Trigger: host POSTs `{ room_id }` with their JWT to `/functions/v1/reveal-decision`.

1. Verify JWT → user; confirm caller is `rooms.host_id`. If already `revealed`, return existing `result` (idempotent). Set `status = 'revealing'`.
2. Read all `responses` where `ready = true` (service role, bypasses RLS). If none → roll back to `open`, 400.
3. Build a labeled transcript: `A. budget $$; style Japanese; avoid too spicy; note: …`.
4. Call OpenAI (`gpt-4o`, JSON mode) with the consensus prompt. It returns ONE of:
   - **Consensus:** `{ consensus:true, summary, cuisine, places_query, reasons[], ruled_out[] }`
   - **Split:** `{ consensus:false, followup_question }`
5. **If split:** append `followup_question` to `rooms.followups`, `round = round+1`, `answered_count = 0`, `status = 'open'`. Clients see the new round and the chat asks the question. Host re-checks later.
6. **If consensus:** call Google Places (Text Search, location-biased to `lat/lng`), pick the best-rated open match → `{ name, address, rating, price_level, photo_url, maps_url, walk_minutes }` (haversine ÷ 80 m/min). If Places fails, `venue = null` (graceful). Write `result` + `status='revealed'` + `revealed_at`.

`result` jsonb: `{ summary, cuisine, reasons[], ruled_out[], venue|null }`.

**Pure-logic modules (unit-tested with `deno test`):** `buildResponsesTranscript`, `parseConsensus` (consensus/split branches), `selectBest`/`walkMinutes`/`haversineMeters`. Keep `OPENAI_API_KEY` and `GOOGLE_PLACES_API_KEY` as function secrets; default `verify_jwt = true`.

---

## 9. Realtime

Publication `supabase_realtime` includes `rooms`, `friendships`, `room_invites` (RLS-scoped delivery). Clients subscribe to:
- **Room:** the `rooms` row (`id=eq.<id>`) → on any update, re-fetch `get_room_state` (covers progress counts, round advance, and reveal). Answer content never crosses Realtime.
- **Home / Friends:** `friendships` + `room_invites` (no filter; RLS scopes to the user) → re-fetch `get_home` / `get_social`.

---

## 10. Frontend flows

1. **Auth** (`/login`): tabs for sign up (username + email + password, with `username_available` pre-check and `^[a-z0-9_]{3,20}$`) and log in. `signUp` → if session, go to `next`; else "confirm email". `/auth/callback` exchanges the confirmation code.
2. **Home** (`/`): authed → `HomeDashboard` (greeting, category grid, friends button with request badge, room invites, theme toggle, sign out). Logged-out → landing + "Get started".
3. **Category → create** (`/create/[category]`): server guards auth + Pro (locked categories need `is_pro`). `CreateRoom` collects question + location (geolocation or typed → `/api/geocode`) → `create_room` → `/room/[code]`.
4. **Room** (`/room/[code]`): server guards auth, `join_room`, loads `get_room_state` → `RoomClient` (realtime). Not revealed → `ChatRoom`; revealed → `RevealCard`. Host sees Invite + Share.
5. **Friends** (`/friends`): add-me link (`/add-friend/<username>`), username search + Add, incoming requests Accept/Decline, friends list. `/add-friend/[username]` sends a request.

---

## 11. The conversational room (`ChatRoom`)

Per-participant **private** chat, AI bubbles left / user bubbles right, options as quick-reply chips. Scripted food rounds (`lib/rounds.ts`):

- **R1 budget** — chips `$ · $$ · $$$`
- **R2 cuisine** — chips `🍜 Japanese · 🍔 Western · 🥟 Chinese · Surprise me` (+ free text)
- **R3 avoid** — chips `Too spicy · Too heavy · Nothing, I'm open` (+ free text)
- **R4 freestyle** — optional free text (Send or Skip)

On finishing R4, `submit_response(answers, ready=true)` (round 0). State derives the visible history from `my_answers` + `rooms.followups`; `caughtUp = my_round >= round`.

**Follow-up loop:** host taps **Find the yes** → edge function. If split, it bumps `rooms.round` and appends a `followup`; every client re-renders the new AI question (free-text answer → `submit_response({followups:[…]}, ready=true)` for that round). Host re-checks. If consensus → `RevealCard` (the pick, real venue, reasons, and an expandable "what everyone said").

---

## 12. Design system (tucope-derived; purple primary; light + dark)

Mirrors the tucope Flutter app's language, adapted to Tailwind/React. Primary stays **Hunch purple**.

- **Fonts:** body/UI **Plus Jakarta Sans** (`--font-sans`); display headers **Fraunces** (`--font-display`, used via `font-display`). (tucope uses Recoleta; Fraunces is the free stand-in.)
- **Spacing:** 4 / 8 / 16 / 24 / 32. **Radii:** cards `rounded-2xl/3xl` (~16–24), **buttons are pills** (`rounded-full`, set as the Button base). Cards: surface bg, hairline border, subtle shadow.
- **Chips:** `rounded-full border bg-card px-4 py-2`, hover → primary.
- **Tokens (CSS variables in `globals.css`):**

| token | light (`:root`) | dark (`.dark`, blackish) |
| --- | --- | --- |
| background | `#f6f6f7` | `#0d0d12` |
| card | `#ffffff` | `#16161f` |
| foreground | `#111111` | `#f5f5f7` |
| primary | `#7c5cff` | `#8b6dff` |
| muted-foreground | `#6d6d6d` | `#9aa0ac` |
| border / input | `#e7e7e7` | `#262631` |
| success / success-bg | `#16a34a` / `#dcfce7` | `#34d399` / `#10271d` |
| accent / accent-foreground | `#efe9ff` / `#5b3fc4` | `#211d33` / `#c9b8ff` |

`next-themes` (`attribute="class"`, default **dark**) toggles `.dark`; a `ThemeToggle` lives in the home header. Because components use semantic tokens, both themes work without per-component changes.

---

## 13. Build plan (phases to recreate)

> Use TDD where it fits (edge-function pure logic). Verify with `tsc --noEmit` + `next build` after each phase. Git optional.

**Phase 0 — Scaffold**
1. `npx create-next-app@latest frontend --typescript --tailwind --app --eslint --no-src-dir --import-alias "@/*" --use-npm --turbopack --disable-git --yes`
2. `npm i @supabase/supabase-js @supabase/ssr next-themes` ; `npm i -D @playwright/test`
3. `npx shadcn@latest init -d` ; `npx shadcn@latest add button input textarea card label sonner skeleton dialog tabs avatar badge`
4. `cd backend && supabase init`

**Phase 1 — Theme & shell**
5. `globals.css`: light `:root` + blackish `.dark` tokens (§12), `--font-display`, `bg-success-bg`. Make Button base `rounded-full`.
6. `layout.tsx`: Plus Jakarta Sans + Fraunces, `ThemeProvider`, metadata, PWA manifest + `icon.svg`.

**Phase 2 — Supabase backend** (migrations 0001–0008; apply via `psql -f schema.sql` or `supabase db push`)
7. profiles + `handle_new_user` + `username_available`.
8. rooms (+ category, round, followups, counts), room_participants, answers; count triggers.
9. RLS (§6) + `is_room_participant`.
10. RPCs (§7).
11. Realtime publication (`rooms`, `friendships`, `room_invites`).
12. friendships + room_invites + social RPCs.
13. responses + `submit_response` + new `get_room_state`.

**Phase 3 — Edge function** (`reveal-decision`)
14. TDD pure logic: transcript, consensus (consensus/split), places. Handler (§8). Deploy + secrets.

**Phase 4 — Frontend foundation**
15. supabase `client`/`server`/`proxy` + `proxy.ts` (Next 16). `lib/types.ts`, `lib/rounds.ts`, `lib/categories.ts`.
16. Auth (`/login`, `/auth/callback`).

**Phase 5 — App**
17. Home dashboard + category grid + Pro dialog + theme toggle.
18. `/create/[category]` + `CreateRoom` + `/api/geocode`.
19. Room: `page.tsx` (guard/join/state) + `room-client` (realtime) + `ChatRoom` + `RevealCard`.
20. Friends: `/friends` + `FriendsClient` + `/add-friend/[username]` + room `InviteFriends`.

**Phase 6 — Verify & deploy**
21. `tsc --noEmit`, `next build`, Playwright smoke. Vercel (root `frontend` + env). Supabase Auth redirect URLs; disable email confirmation.

---

## 14. Deployment

- **Frontend → Vercel:** Root Directory `frontend`; env `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `GOOGLE_PLACES_API_KEY`.
- **Backend → Supabase:** apply migrations (`supabase db push` linked, or `psql "$SUPABASE_DB_URL" -f backend/supabase/schema.sql`); `supabase functions deploy reveal-decision`; `supabase secrets set OPENAI_API_KEY=… GOOGLE_PLACES_API_KEY=…`. Helper: `backend/deploy.sh <PROJECT_REF>`.
- **Auth:** Site URL + `/auth/callback` allowlist; disable "Confirm email" for demos.

---

## 15. Testing

- **Edge function:** `deno test backend/supabase/functions/reveal-decision/` — transcript/consensus/places pure logic (no network).
- **Frontend:** `npx tsc --noEmit` + `npm run build`; Playwright happy-path (`e2e/hunch.spec.ts`).
- **Manual pre-demo:** two accounts → both chat the rounds → confirm no answer bodies in Realtime frames pre-reveal → host "Find the yes" → both see the same pick/venue. PWA install + Share sheet on a phone.

---

## 16. Known gaps / TODO

- Deploy `reveal-decision` + set `OPENAI_API_KEY` / `GOOGLE_PLACES_API_KEY` (reveal is otherwise inert).
- `GOOGLE_PLACES_API_KEY` in `frontend/.env.local` for the typed-area geocode.
- Disable "Confirm email" in Supabase for instant signup.
- Non-food categories are intentionally Pro-locked (no real data yet).
- Git not initialized yet.

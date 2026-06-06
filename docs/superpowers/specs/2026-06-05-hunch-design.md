# Hunch — Design Spec

**Date:** 2026-06-05
**Status:** Approved (pending final spec review)
**One-liner:** AI group food decisions, minus the social pressure. Everyone answers privately in plain words; the AI surfaces the option the whole group is secretly happy with and recommends a real nearby restaurant.

---

## 1. Goal & scope

Build a full-stack, mobile-first web app ("Hunch") for the **"where should we eat?"** use case (food is the wedge — general-purpose is out of scope for the MVP).

Core loop:
1. A host creates a room (one question, one location anchor) and shares a link.
2. Each participant signs in and answers privately in natural language. Nobody sees anyone else's answer.
3. The host reveals. The AI reads all answers, finds the hidden consensus, and recommends a **real** nearby restaurant that matches it, with reasoning ("3 of 5 wanted comfort food").

### In scope (MVP)
- Auth (every participant signs in — no anonymous access).
- Create room, join by link, submit one private answer (editable until reveal).
- Live "X of Y answered" progress via realtime.
- AI synthesis (OpenAI) + real venue recommendation (Google Places).
- Mobile-first UI matching the deck's dark theme; PWA-installable; shareable link.
- Deployed live: Next.js on Vercel, hosted Supabase project.

### Out of scope (MVP)
- Non-food decisions (movies, travel, team plans) — future expansion.
- Anonymous / no-account rooms (diverges from deck pitch by explicit user choice).
- Multi-round voting, chat, comments, re-rolls (a "try another" reroll is a possible fast-follow).
- Native mobile apps (PWA covers "feels like a mobile app").

---

## 2. Architecture

**Decision: Approach A — Postgres RPC for transactional CRUD + a single Edge Function for the complex reveal.**

- Simple, transactional operations (create room, join, submit answer, read state) → **Postgres RPC functions** (SECURITY DEFINER where needed), called from the Next.js client via the Supabase JS client.
- The complex reveal (gather answers → OpenAI → Google Places → write result) → a **Supabase Edge Function** (`reveal-decision`). Keeps API keys server-side and off the client.
- Realtime answer/participant counts → **Supabase Realtime** (postgres_changes) subscriptions, one channel per room.

```
hunch-app/
├── frontend/                      # Next.js 15 (App Router, TypeScript)
│   ├── app/
│   │   ├── page.tsx               # Landing + Create Room (host)
│   │   ├── login/page.tsx         # Magic-link sign in
│   │   ├── auth/callback/route.ts # Supabase auth code exchange
│   │   └── room/[code]/page.tsx   # Join → Answer → Live progress → Reveal
│   ├── components/
│   │   ├── create-room.tsx
│   │   ├── answer-form.tsx
│   │   ├── live-progress.tsx
│   │   ├── reveal-card.tsx
│   │   └── ui/                     # shadcn/ui primitives
│   ├── lib/
│   │   ├── supabase/client.ts      # browser client
│   │   ├── supabase/server.ts      # server client (RSC / route handlers)
│   │   └── types.ts                # shared types (incl. generated DB types)
│   ├── public/                     # PWA manifest, icons
│   └── ...config (tailwind, next, etc.)
├── backend/
│   └── supabase/
│       ├── migrations/             # schema, RLS policies, RPC functions
│       ├── functions/
│       │   └── reveal-decision/    # Deno edge function (OpenAI + Google Places)
│       └── config.toml
├── docs/superpowers/specs/         # this spec
└── README.md
```

> Frontend and backend are separate top-level folders per the requirement. The Supabase project is **hosted (production)** — migrations and the edge function are deployed to the remote project; there is no local Supabase stack in the workflow.

---

## 3. Data model (Postgres)

```
profiles
  id            uuid  PK → auth.users.id
  display_name  text
  avatar_url    text
  created_at    timestamptz default now()

rooms
  id             uuid  PK default gen_random_uuid()
  code           text  unique  (short, URL-safe, e.g. 6 chars)
  host_id        uuid  → auth.users.id
  question       text  default 'Where should we eat?'
  location_label text                 -- human readable, e.g. "Shibuya, Tokyo"
  lat            double precision
  lng            double precision
  status         text  default 'open' -- open | revealing | revealed
  result         jsonb                 -- written on reveal (see §6)
  created_at     timestamptz default now()
  revealed_at    timestamptz

room_participants
  room_id    uuid → rooms.id
  user_id    uuid → auth.users.id
  joined_at  timestamptz default now()
  PRIMARY KEY (room_id, user_id)        -- denominator for "X of Y"

answers
  room_id    uuid → rooms.id
  user_id    uuid → auth.users.id
  body       text  not null             -- the natural-language answer
  updated_at timestamptz default now()
  PRIMARY KEY (room_id, user_id)         -- one editable answer per person
```

A `handle_new_user` trigger creates a `profiles` row when a user signs up.

---

## 4. Security (RLS) — the privacy promise enforced in the DB

RLS is **enabled on every table**. Auth is required for all access.

- **profiles:** a user can read any participant profile they share a room with; can update only their own.
- **rooms:** readable by the host and by participants of that room. Insert via RPC only (host). Status transitions happen via RPC / edge function (service role), not direct client writes.
- **room_participants:** a user can read participant rows for rooms they belong to; can insert only their own row (join), via `join_room` RPC.
- **answers — the core guarantee:**
  - A user may `insert`/`update` **only their own** answer.
  - A user may `select` their own answer always.
  - A user may `select` **other** answers **only when** the room's `status = 'revealed'`.
  - => Before reveal, nobody — not even the host — can read another person's answer body. The "totally private input" promise is enforced at the database layer, not just hidden in the UI. Clients only ever learn the *count* of answers (via realtime), never the content.

The `reveal-decision` edge function uses the **service role key** to read all answers, but only after verifying the caller's JWT belongs to the room host.

---

## 5. RPC functions (Postgres)

All `SECURITY DEFINER`, validating `auth.uid()`:

- `create_room(question text, location_label text, lat float8, lng float8) returns rooms`
  Generates a unique short `code`, inserts the room with `host_id = auth.uid()`, auto-inserts the host into `room_participants`, returns the room.
- `join_room(p_code text) returns rooms`
  Looks up the room by code; inserts `(room_id, auth.uid())` into `room_participants` (idempotent — `on conflict do nothing`); returns the room. Errors if room not found or already revealed.
- `submit_answer(p_room_id uuid, p_body text) returns void`
  Upserts the caller's answer (`on conflict (room_id,user_id) do update`). Rejects if room is not `open`, or if caller is not a participant.
- `get_room_state(p_code text) returns jsonb`
  Returns room fields + `participant_count` + `answered_count` + whether the caller has answered + the caller's own answer body. Does **not** leak other answers unless `status = 'revealed'` (then includes the labeled answers for the reveal view).

---

## 6. The reveal — Edge Function `reveal-decision`

Trigger: host taps **"Reveal the yes."** The button is always enabled for the host, and visually highlighted once `answered_count == participant_count`.

The Next client invokes the edge function with the room id (Authorization: the user's JWT).

Steps inside the function (Deno):
1. **Auth & guard:** verify JWT; confirm caller is the room's `host_id`. If `status = 'revealed'` already, return the existing `result` (idempotent). Set `status = 'revealing'`.
2. **Gather answers** (service role) and build a labeled transcript:
   ```
   A. i want chicken
   B. craving noodles honestly
   C. nothing too spicy
   ...
   ```
3. **OpenAI call** (`gpt-4o`), JSON-mode, returns a strict object:
   ```json
   {
     "summary": "comfort food — warm, mild, affordable",
     "cuisine": "chicken noodle / ramen",
     "places_query": "chicken noodle soup restaurant",
     "reasons": ["3 of 5 wanted comfort food", "everyone open to chicken"],
     "ruled_out": ["4 of 5 ruled out spicy", "no hotpot"]
   }
   ```
   Prompt: "You are Hunch. From these private answers, find the single food option the whole group is secretly happy with. Identify overlaps and exclusions. Output strict JSON with the schema above. Keep reasons in the deck's voice ('3 of 5 wanted ...')."
4. **Google Places call:** Text Search using `places_query` biased to the room's `lat/lng` (location bias + radius). Pick the top open, well-rated match. Extract: name, address, rating, price level, a photo reference, a Google Maps link, and walking distance/ETA from the room point.
   - If Places returns nothing or errors, the result still includes the synthesized pick with `venue: null` (graceful degradation — the demo never hard-fails).
5. **Persist:** write the combined object to `rooms.result`, set `status = 'revealed'`, `revealed_at = now()`.
6. **Return** the result. Supabase Realtime pushes the `rooms` row update → every client flips to the reveal view.

`result` jsonb shape (written to `rooms.result`):
```json
{
  "summary": "...", "cuisine": "...",
  "reasons": ["..."], "ruled_out": ["..."],
  "venue": {
    "name": "Ippudo Ramen", "address": "...", "rating": 4.5,
    "price_level": 2, "photo_url": "...", "maps_url": "...",
    "walk_minutes": 4
  }
}
```

**Geocoding (typed area):** resolved at **create time, before `create_room`**, so the room always stores concrete `lat/lng` and the edge function never geocodes. If the host types an area, the Create flow calls a Next route handler (`/api/geocode`) → Google Geocoding API (same key) → `lat/lng`. The browser-geolocation path supplies `lat/lng` directly. Either way, `create_room` receives coordinates.

---

## 7. Frontend flows & UI

1. **Landing / Create (host):** headline + "Start a room." Inputs: the question (prefilled "Where should we eat?") and location (📍 "Use my location" button → browser geolocation, or a text field → geocoded). On submit → `create_room` → redirect to `/room/[code]` and surface a **Share** button (Web Share API / copy link).
2. **Join:** opening `/room/[code]` while logged out → redirect to `/login` (magic link), then back. Logged in → `join_room`.
3. **Answer:** a single textarea ("say what you feel like — nobody sees this but Hunch") + submit. Editable until reveal. After submit → waiting state.
4. **Live progress:** "3 of 5 answered ●●●○○" updating in realtime. Host sees the **Reveal** button.
5. **Reveal:** the `RevealCard` — synthesized consensus + ✓ reason bullets + the real restaurant card (photo, name, ★rating, "4 min away", open-in-Maps). A subtle "…and nobody had to say it first."

**Theme (from the deck):** dark bg `#0d0d12`, surface `#1a1a24`, primary purple `#7c5cff`, success green `#34d399`, coral accent `#ff6b5e`, muted text `#9ca3af`. Wired into `tailwind.config` + shadcn CSS variables. Large tap targets, sticky bottom CTA, safe-area insets, PWA manifest + icons for installability.

---

## 8. Auth

Supabase Auth, **email magic link (passwordless)** as the primary method — lowest friction on mobile, no password UI, minimal config. Google OAuth is a clean later add (requires Google Cloud OAuth setup) and is intentionally deferred. Auth callback handled at `/auth/callback`.

---

## 9. Deployment & configuration

- **Frontend:** Vercel. Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key). Site URL + `/auth/callback` registered in Supabase Auth redirect allowlist.
- **Backend:** hosted Supabase project. Migrations applied to the remote (SQL migrations). `reveal-decision` deployed to the project. Function **secrets:** `OPENAI_API_KEY`, `GOOGLE_PLACES_API_KEY` (Places + Geocoding enabled). `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are available to the function automatically.
- Realtime enabled on `rooms`, `room_participants`, `answers` (the publication).

---

## 10. Testing (pragmatic — no local stack)

- **Edge function (pure logic, no network):** unit-test transcript building from answers, OpenAI JSON parsing/validation, Places result selection, and graceful degradation when Places is empty. External calls mocked.
- **RPC functions:** verified against the hosted project with a smoke script (create → join → submit → state), asserting RLS hides other answers pre-reveal.
- **E2E:** a Playwright happy-path against the Vercel preview — create room, join as a second user, submit answers, reveal, assert the reveal card renders. (Kept lean — one golden path.)

---

## 11. Risks & mitigations

- **External API failure during live demo** → reveal degrades gracefully (Places-less result); OpenAI errors return a friendly retry, status rolls back to `open`.
- **Realtime not enabled / flaky** → `get_room_state` polling fallback every few seconds.
- **Cost/abuse** → reveal is host-only and idempotent (one paid synthesis per room); rate-reasonable for a demo.
- **Auth redirect misconfig on Vercel** → checklist item to register the exact production URL in Supabase before the demo.

---

## 12. Open items to confirm before/at implementation

- Magic-link vs. Google OAuth (default: magic link).
- Reroll / "show me another option" — deferred unless quick.
- Exact OpenAI model (`gpt-4o` default; `gpt-4o-mini` if cost matters).

---

## v2 — Accounts, Categories (freemium) & Friends

Scope change approved after v1: accounts with usernames, a category home, a Pro gate, and a friend system. Built in one pass.

### Auth
- **Email + password + username** signup (replaces magic link). Username is unique, lowercase `^[a-z0-9_]{3,20}$`, chosen at signup. Login via password. Email-confirmation link still routes through `/auth/callback`. (For a smooth demo, "Confirm email" can be disabled in Supabase Auth.)
- `profiles` gains `username` (unique, not null with a `user_xxxx` fallback in the trigger) and `is_pro boolean default false`.

### Home & categories (freemium)
- After login, `/` is the **home dashboard**: greeting, a category grid, friend-requests entry (with badge), and a list of room invites from friends. Logged-out `/` is a marketing landing → "Get started".
- Categories: **Where to eat** (active) · Where to travel · What to watch · Something else. Only `eat` is functional; the others render with a **Pro lock** and open an "Upgrade to Pro — coming soon" dialog (no payment integration).
- Selecting *Where to eat* → `/create/eat` → title + location → `create_room(category='eat')` → room. `rooms` gains `category` (`eat|travel|watch|other`, default `eat`).

### Friends
- `friendships` — canonical pair row `(user_low, user_high)` with `status` (`pending|accepted`) and `requested_by`. RLS: a user reads rows they're in; all writes go through SECURITY DEFINER RPCs.
- `room_invites` — `(room_id, invited_user, invited_by)`; invitees see pending invites on their home and tap to join.
- **Both** connection paths: username **search** (`search_users`) + request/accept (`send_friend_request`, `respond_friend_request`), and an **add-me link** `/add-friend/[username]` (sends a request) — your "friend code" is your `@username`.
- RPCs: `username_available`, `search_users`, `send_friend_request`, `respond_friend_request`, `get_social` (friends/incoming/outgoing), `get_home`, `invite_to_room`. `create_room`/`get_room_state` gain `category`.
- Realtime adds `friendships` + `room_invites` so requests/invites update live (alongside `rooms`).

### Frontend additions
- `app/login` (signup/login tabs), `app/page.tsx` (home dashboard vs landing), `app/create/[category]/page.tsx`, `app/friends/page.tsx`, `app/add-friend/[username]/page.tsx`, a shared **Pro** dialog, and a host **Invite friends** panel in the room. shadcn: dialog, tabs, avatar, badge.

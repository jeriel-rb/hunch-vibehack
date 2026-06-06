# Hunch Repo Recreation Prompt

Copy everything below this line into a coding agent in an empty folder. The goal is to recreate the current `hunch-app` repository as completely as possible, including the duplicated root/frontend app tree, Supabase backend, docs, tests, configs, and known quirks.

---

## Role

You are an expert full-stack engineer. Recreate the Hunch repo from scratch as a working monorepo.

Hunch is a mobile-first PWA for private group food decisions. A host creates a room, everyone signs in and answers privately through a guided chat, then the host asks Hunch to find the hidden consensus. The reveal uses OpenAI to synthesize preferences and Google Places to recommend a real nearby restaurant. The database, not just the UI, enforces that nobody can read another person's answer before reveal.

## Critical Framework Rule

This repo uses Next.js 16.2.7, React 19.2.4, Tailwind v4, and shadcn built on Base UI. This is not older Next.js.

After dependencies are installed, read the relevant local Next docs before editing framework files:

```bash
sed -n '1,260p' node_modules/next/dist/docs/01-app/index.md
sed -n '1,620p' node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md
```

Important Next 16 constraints:

- `middleware.ts` is now `proxy.ts`; export `proxy`.
- `cookies()` is async.
- Route `params` and page `searchParams` are async promises.
- `next dev` and `next build` use Turbopack by default.
- Use `images.remotePatterns`, not `images.domains`.
- `Node.js >= 20.9` is required.

Important shadcn/Base UI constraint:

- Components compose with a `render` prop, not Radix-style `asChild`.
- Examples: `<Button render={<Link href="/login" />}>Get started</Button>` and `<DialogTrigger render={<Button />}>Invite</DialogTrigger>`.

## Exact Stack

Create both root and `frontend/` package files with this dependency set:

```json
{
  "name": "frontend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint"
  },
  "dependencies": {
    "@base-ui/react": "^1.5.0",
    "@supabase/ssr": "^0.10.3",
    "@supabase/supabase-js": "^2.107.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^1.17.0",
    "next": "16.2.7",
    "next-themes": "^0.4.6",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "shadcn": "^4.10.0",
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.6.0",
    "tw-animate-css": "^1.4.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.60.0",
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.2.7",
    "tailwindcss": "^4",
    "typescript": "^5"
  }
}
```

The root app and `frontend/` app are mirrored. In the current repo, these pairs are identical:

- `app/` and `frontend/app/`
- `components/` and `frontend/components/`
- `lib/` and `frontend/lib/`
- `package.json` and `frontend/package.json`
- `next.config.ts` and `frontend/next.config.ts`
- `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `components.json`, `playwright.config.ts`, `proxy.ts`, `public/manifest.webmanifest`

The root `README.md` is the project README. `frontend/README.md` is the default create-next-app README. Recreate that mismatch if preserving the repo exactly; otherwise it is acceptable to replace `frontend/README.md` with a useful short duplicate.

## Environment Files

Create `.env.example` and `frontend/.env.example` with:

```env
# Supabase (frontend) - from your Supabase project: Settings -> API.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Server-only (used by /api/geocode). Google Cloud key with Geocoding API enabled.
GOOGLE_PLACES_API_KEY=
```

Do not commit real `.env.local` values. Edge Function secrets are set in Supabase:

```env
OPENAI_API_KEY=
GOOGLE_PLACES_API_KEY=
```

Supabase injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` into Edge Functions.

## Repository Structure To Recreate

```text
hunch-app/
  AGENTS.md
  CLAUDE.md
  README.md
  .env.example
  settings.json
  package.json
  package-lock.json
  next.config.ts
  tsconfig.json
  eslint.config.mjs
  postcss.config.mjs
  playwright.config.ts
  components.json
  proxy.ts
  app/
    add-friend/[username]/page.tsx
    api/geocode/route.ts
    auth/callback/route.ts
    create/[category]/page.tsx
    favicon.ico
    friends/page.tsx
    globals.css
    icon.svg
    layout.tsx
    login/page.tsx
    page.tsx
    room/[code]/page.tsx
    room/[code]/room-client.tsx
  components/
    add-friend-button.tsx
    aurora-background.tsx
    category-grid.tsx
    chat-room.tsx
    create-room.tsx
    friends-client.tsx
    home-dashboard.tsx
    hunch-logo.tsx
    invite-friends.tsx
    reveal-card.tsx
    share-button.tsx
    ui/avatar.tsx
    ui/badge.tsx
    ui/button.tsx
    ui/card.tsx
    ui/dialog.tsx
    ui/input.tsx
    ui/label.tsx
    ui/skeleton.tsx
    ui/sonner.tsx
    ui/tabs.tsx
    ui/textarea.tsx
  lib/
    categories.ts
    rounds.ts
    types.ts
    utils.ts
    supabase/client.ts
    supabase/proxy.ts
    supabase/server.ts
  public/
    manifest.webmanifest
    icon.svg
    file.svg
    globe.svg
    next.svg
    vercel.svg
    window.svg
  e2e/hunch.spec.ts
  frontend/
    # mirrored Next app tree and configs listed above
  backend/
    deploy.sh
    supabase/config.toml
    supabase/schema.sql
    supabase/migrations/20260605120001_profiles.sql
    supabase/migrations/20260605120002_rooms.sql
    supabase/migrations/20260605120003_counts_triggers.sql
    supabase/migrations/20260605120004_rls.sql
    supabase/migrations/20260605120005_rpc.sql
    supabase/migrations/20260605120006_realtime.sql
    supabase/migrations/20260605120007_social.sql
    supabase/migrations/20260605120008_conversational.sql
    supabase/functions/deno.json
    supabase/functions/_shared/edge-runtime.d.ts
    supabase/functions/reveal-decision/index.ts
    supabase/functions/reveal-decision/transcript.ts
    supabase/functions/reveal-decision/consensus.ts
    supabase/functions/reveal-decision/places.ts
    supabase/functions/reveal-decision/prompt.ts
    supabase/functions/reveal-decision/transcript.test.ts
    supabase/functions/reveal-decision/consensus.test.ts
    supabase/functions/reveal-decision/places.test.ts
    supabase/functions/consensus/index.ts
  docs/superpowers/
    BUILD_PROMPT.md
    HUNCH_PROJECT_PLAN.md
    specs/2026-06-05-hunch-design.md
    plans/2026-06-05-hunch.md
```

## Agent Instruction Files

Create `AGENTS.md` and `frontend/AGENTS.md`:

```md
<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes - APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
```

Create `CLAUDE.md` and `frontend/CLAUDE.md` containing:

```text
@AGENTS.md
```

## Frontend Product Behavior

### Core Flow

1. Logged-out `/` shows a landing page: Hunch logo, headline `Hunch.`, tagline `Everyone already agrees. Hunch just finds it.`, body copy about private AI group decisions, a primary `Get started` button linking to `/login`, and a shield/privacy note.
2. Logged-in `/` calls `get_home` and renders `HomeDashboard`.
3. `/login` has tabs for signup and login. Signup collects username, email, password. Username regex is `/^[a-z0-9_]{3,20}$/`, calls `username_available`, then Supabase `signUp` with metadata `{ username, display_name }`. Login uses email/password.
4. `/create/[category]` guards auth. `eat` is free; `travel`, `watch`, and `other` require `profiles.is_pro`. It renders `CreateRoom`.
5. `CreateRoom` collects question and, for `eat`, location. It supports browser geolocation or typed area geocoded through `/api/geocode?q=...`, then calls `create_room` with `p_question`, `p_category`, `p_location_label`, `p_lat`, `p_lng`, then routes to `/room/[code]`.
6. `/room/[code]` guards auth, idempotently calls `join_room`, calls `get_room_state`, then renders `RoomClient`.
7. `RoomClient` subscribes to the `rooms` row via Supabase Realtime. On every update, it re-fetches `get_room_state`. It shows `ChatRoom` until revealed, then `RevealCard`.
8. `ChatRoom` is private per participant. It builds visible chat history from `my_answers` and `followups`.
9. Host can tap `Find the yes (ready/total)`. The client fetches `${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/reveal-decision` with the user's JWT and `{ room_id }`.
10. If the edge function returns `{ consensus: false, followup_question }`, the room re-opens with a new follow-up round. If it returns a result, the room becomes revealed.
11. `RevealCard` shows the chosen restaurant or cuisine, reasons, venue image/details, Maps link, and an expandable "What everyone said (now revealed)" section.
12. Friends flow: `/friends` shows add-me link, username search, incoming requests, outgoing state, friends list. `/add-friend/[username]` lets an authed user send a friend request.

### Categories

Implement `lib/categories.ts`:

- `eat`: label `Where to eat`, sub `the daily one`, icon `Utensils`, default question `Where should we eat?`, `pro: false`.
- `travel`: label `Where to travel`, sub `the group-trip chat`, icon `Plane`, default question `Where should we travel?`, `pro: true`.
- `watch`: label `What to watch`, sub `movie-night standoff`, icon `Film`, default question `What should we watch?`, `pro: true`.
- `other`: label `Something else`, sub `any group call`, icon `Sparkles`, default question `What should we decide?`, `pro: true`.

Expose `getCategory(key: string)`.

### Scripted Food Rounds

Implement `lib/rounds.ts` with `EAT_ROUNDS`:

1. `budget`: prompt `First - what's the budget tonight?`, chips `$`, `$$`, `$$$`.
2. `style`: prompt `Any cuisine you're feeling?`, chips Japanese/Western/Chinese/Surprise me with values `Japanese`, `Western`, `Chinese`, `anything`; allow free text.
3. `avoid`: prompt `Anything you'd rather avoid?`, chips `Too spicy` -> `too spicy`, `Too heavy` -> `too heavy`, `Nothing, I'm open` -> `nothing`; allow free text.
4. `freestyle`: prompt `Last one - anything else on your mind? (optional)`, free text, optional.

### Domain Types

Implement `lib/types.ts` with these shapes:

```ts
export interface Venue {
  name: string;
  address: string;
  rating: number | null;
  price_level: number | null;
  photo_url: string | null;
  maps_url: string | null;
  walk_minutes: number | null;
}

export interface RevealResult {
  summary: string;
  cuisine: string;
  reasons: string[];
  ruled_out: string[];
  venue: Venue | null;
}

export type RoomStatus = "open" | "revealing" | "revealed";
export type Category = "eat" | "travel" | "watch" | "other";

export interface ResponseAnswers {
  budget?: string;
  style?: string;
  avoid?: string;
  freestyle?: string;
  followups?: string[];
}

export interface RoomState {
  id: string;
  code: string;
  question: string;
  category: Category;
  location_label: string | null;
  host_id: string;
  is_host: boolean;
  status: RoomStatus;
  round: number;
  followups: string[];
  participant_count: number;
  answered_count: number;
  my_answers: ResponseAnswers;
  my_round: number;
  result: RevealResult | null;
  responses: { label: string; answers: ResponseAnswers }[] | null;
}

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  is_pro: boolean;
}

export interface FriendUser {
  id: string;
  username: string;
  display_name: string | null;
  status?: "pending" | "accepted" | null;
  requested_by?: string | null;
}

export interface RoomInvite {
  code: string;
  question: string;
  category: Category;
  inviter: string;
}

export interface HomeData {
  profile: Profile;
  incoming_requests: number;
  invites: RoomInvite[];
}

export interface SocialData {
  friends: FriendUser[];
  incoming: FriendUser[];
  outgoing: FriendUser[];
}
```

Use untyped Supabase clients for now and cast RPC results to these domain types.

### Supabase Client Helpers

`lib/supabase/client.ts`:

- Export `createClient()`.
- Use `createBrowserClient` from `@supabase/ssr`.
- Read `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

`lib/supabase/server.ts`:

- Export async `createClient()`.
- Use `createServerClient`.
- `const cookieStore = await cookies();`
- `getAll` returns `cookieStore.getAll()`.
- `setAll` tries to set cookies and catches failures from Server Component render.

`lib/supabase/proxy.ts`:

- Export async `updateSession(request: NextRequest)`.
- If Supabase env vars are missing, return `NextResponse.next({ request })`.
- Otherwise build a server client with request cookies, call `supabase.auth.getUser()`, and return the response with updated cookies.

`proxy.ts`:

- Import `updateSession`.
- Export async `proxy(request: NextRequest)`.
- Export `config.matcher` excluding static assets, images, `favicon.ico`, `manifest.webmanifest`, `icon.svg`, and png files.

### Route Details

Implement these routes:

- `app/page.tsx`: server component. Try Supabase `getUser`; if user and `get_home` data exists, render `HomeDashboard`. Catch missing Supabase config and fall through to landing.
- `app/login/page.tsx`: client component wrapped in `Suspense` because it uses `useSearchParams`. Signup and login tabs. Check email confirmation state if `signUp` returns no session.
- `app/auth/callback/route.ts`: GET route. Exchange `code` for session and redirect to `next` or `/login`.
- `app/api/geocode/route.ts`: GET route. Validate `q`, require `GOOGLE_PLACES_API_KEY`, call `https://maps.googleapis.com/maps/api/geocode/json?address=...&key=...`, return `{ label, lat, lng }`.
- `app/create/[category]/page.tsx`: `params` is `Promise<{ category: string }>`; await it. Guard auth and pro. Render `CreateRoom`.
- `app/room/[code]/page.tsx`: `params` is `Promise<{ code: string }>`; await it. Guard auth, `join_room`, `get_room_state`, render `RoomClient`.
- `app/friends/page.tsx`: guard auth, load `get_social` and profile username, render `FriendsClient`.
- `app/add-friend/[username]/page.tsx`: await params, normalize username by removing leading `@` and lowercasing, guard auth, fetch profile, render `AddFriendButton` or missing-user state.

### UI Components

Create shadcn/Base UI primitives matching `components/ui/*`. Use `@base-ui/react`, `class-variance-authority`, `cn`, lucide icons, and the `render` prop where composition is needed. Include at least `button`, `input`, `textarea`, `label`, `card`, `badge`, `avatar`, `dialog`, `tabs`, `skeleton`, and `sonner`.

Component responsibilities:

- `HunchLogo`: inline SVG with a dark lens, four dots, one purple found dot, and a pulsing `logo-halo` class.
- `AuroraBackground`: fixed decorative background with three blurred radial gradients and inlined SVG grain. Keep it pointer-events-none and behind content.
- `HomeDashboard`: mobile max width, avatar initials, Hunch title, Friends button with request badge, sign out, `CategoryGrid`, and invite cards. Subscribe to `friendships` and `room_invites`.
- `CategoryGrid`: 2-column grid. Locked Pro cards dimmed with a Pro pill. Locked cards open a dialog saying non-food categories are coming soon. Free `eat` routes to `/create/eat`.
- `CreateRoom`: question input, optional location input plus geolocation icon button, `/api/geocode`, `create_room`, route to room.
- `ChatRoom`: private chat bubbles, quick reply chips, follow-up handling, ready state, revealing state, host reveal button, non-host waiting text.
- `InviteFriends`: Base UI dialog trigger with `render`; loads `get_social`, invites friends via `invite_to_room`, shows invited state.
- `ShareButton`: Web Share API fallback to clipboard, toast success.
- `FriendsClient`: add-me link copy, search users, send request, accept/decline, realtime refresh.
- `AddFriendButton`: sends `send_friend_request`, handles self link, routes to `/friends`.
- `RevealCard`: shows pick, venue image via `next/image` with `unoptimized`, reasons, Maps link, and revealed responses summary.

### Styling

Use Tailwind v4 in `app/globals.css`:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));
```

Define `@theme inline` variables for background, foreground, card, popover, primary, secondary, muted, accent, destructive, border, input, ring, success, success-bg, sidebar, chart colors, radius, `--font-display`, and font tokens.

Use these key color tokens:

Light:

- `--background: #f6f6f7`
- `--foreground: #111111`
- `--card: #ffffff`
- `--primary: #7c5cff`
- `--accent: #efe9ff`
- `--accent-foreground: #5b3fc4`
- `--success: #16a34a`
- `--success-bg: #dcfce7`

Dark:

- `--background: #0d0d12`
- `--foreground: #f5f5f7`
- `--card: #1a1a24`
- `--primary: #7c5cff`
- `--secondary: #1f1f2b`
- `--muted-foreground: #9ca3af`
- `--accent: #ff6b5e`
- `--success: #34d399`

Add animation utilities:

- `animate-fade-up`
- `animate-fade-in`
- `animate-pop`
- `animate-chip`
- `stagger > *` with increasing delays
- `lift`
- `glow-primary`
- `logo-halo`
- `shimmer`

Respect `prefers-reduced-motion`.

Use fonts in `app/layout.tsx`:

- `Plus_Jakarta_Sans` as `--font-sans`
- `Fraunces` as `--font-display` with weights `400`, `500`, `600`, `700`

`layout.tsx` metadata:

- title `Hunch - find the yes` or `Hunch - find the yes` with the current repo's punctuation if desired.
- description `AI group food decisions, minus the social pressure.`
- manifest `/manifest.webmanifest`
- viewport themeColor `#f6f6f7`, width device, initialScale 1, maximumScale 1, viewportFit cover.
- Render `AuroraBackground`, children, and `<Toaster position="top-center" />`.

### Next Config

`next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "places.googleapis.com" }],
  },
};

export default nextConfig;
```

Render Google Places photos with `unoptimized`.

### PWA Assets

`public/manifest.webmanifest` and `frontend/public/manifest.webmanifest`:

```json
{
  "name": "Hunch",
  "short_name": "Hunch",
  "description": "Find the yes the group already agrees on.",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0d0d12",
  "theme_color": "#0d0d12",
  "icons": [
    { "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" }
  ]
}
```

Create `app/icon.svg` as the Hunch lens mark and `public/icon.svg` as a 512x512 dark rounded rectangle with a green check. Include default create-next-app SVGs if preserving exact file inventory.

## Backend: Supabase

The backend is hosted Supabase: Postgres, RLS, RPC, Realtime, and Edge Functions. There is no required local Supabase stack for the intended workflow.

### Supabase Config

Create `backend/supabase/config.toml` from `supabase init` defaults with:

- `project_id = "backend"`
- API enabled on port 54321.
- DB major version 17.
- Realtime enabled.
- Auth enabled.
- `site_url = "http://127.0.0.1:3000"`.
- Email signup enabled.
- `enable_confirmations = false`.
- Minimum password length 6.

### Migrations

Create these ordered migrations. The migrations are authoritative.

Known repo quirk: the current `backend/supabase/schema.sql` is stale and stops after migration `20260605120007_social.sql`; it does not include `20260605120008_conversational.sql`, even though the app uses `responses`, `submit_response`, `round`, and `followups`. For a functional recreation, include migration 08 and preferably regenerate `schema.sql` to include it. If exact preservation matters, keep the stale `schema.sql` but note the quirk in README.

#### 20260605120001_profiles.sql

Create `profiles`:

- `id uuid primary key references auth.users(id) on delete cascade`
- `username text not null unique check (username ~ '^[a-z0-9_]{3,20}$')`
- `display_name text`
- `avatar_url text`
- `is_pro boolean not null default false`
- `created_at timestamptz not null default now()`

Enable RLS. Create `handle_new_user()` trigger to insert profile from `raw_user_meta_data.username`, fallback `user_` plus first 8 chars of user id. Create trigger `on_auth_user_created`. Create `username_available(p_username text) returns boolean` as SECURITY DEFINER stable SQL.

#### 20260605120002_rooms.sql

Create:

- `rooms`: `id`, `code`, `host_id`, `question`, `category`, `location_label`, `lat`, `lng`, `status`, `participant_count`, `answered_count`, `result`, `created_at`, `revealed_at`.
- `room_participants`: `(room_id, user_id)` primary key, `joined_at`.
- `answers`: legacy v1 table with `(room_id, user_id)`, `body`, `updated_at`; kept harmless.

Add indexes on `room_participants(user_id)` and `answers(room_id)`.

#### 20260605120003_counts_triggers.sql

Create triggers:

- `bump_participant_count()` increments `rooms.participant_count` on participant insert.
- `bump_answer_count()` increments `rooms.answered_count` on legacy `answers` insert.

#### 20260605120004_rls.sql

Enable RLS on `rooms`, `room_participants`, `answers`.

Create helper:

```sql
create or replace function public.is_room_participant(p_room_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.room_participants
    where room_id = p_room_id and user_id = auth.uid()
  );
$$;
```

Policies:

- `profiles_select`: authenticated users can read profiles.
- `profiles_update_self`: only update self.
- `rooms_select`: host or participant can read.
- `participants_select`: read participant rows for rooms you are in.
- `participants_insert_self`: insert only your own participant row.
- `answers_select`: read own always; read others only when room status is `revealed` and caller is participant.
- `answers_insert_self`: insert own answer only if participant.
- `answers_update_self`: update own answer.

#### 20260605120005_rpc.sql

Create SECURITY DEFINER RPCs:

- `create_room(p_question text, p_category text, p_location_label text, p_lat double precision, p_lng double precision) returns rooms`
  - require auth
  - generate 6-char uppercase code from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
  - insert room
  - auto-insert host into `room_participants`
- `join_room(p_code text) returns rooms`
  - require auth
  - uppercase code
  - idempotent participant insert
- `submit_answer(p_room_id uuid, p_body text) returns void`
  - legacy v1 answer flow, still present
- Initial `get_room_state(p_code text) returns jsonb`
  - legacy v1 shape. This is replaced by migration 08.

#### 20260605120006_realtime.sql

Add `public.rooms` to publication `supabase_realtime`.

#### 20260605120007_social.sql

Create:

- `friendships`: canonical pair `(user_low, user_high)`, status `pending|accepted`, `requested_by`, `created_at`, check `user_low < user_high`.
- `room_invites`: `(room_id, invited_user)`, `invited_by`, `created_at`.

Enable RLS. Policies:

- Friends rows selectable by either user.
- Room invites selectable by invited user, inviter, or room participant.

RPCs:

- `send_friend_request(p_username text)`
- `respond_friend_request(p_other uuid, p_accept boolean)`
- `search_users(p_query text) returns jsonb`
- `get_social() returns jsonb` as `{ friends, incoming, outgoing }`
- `invite_to_room(p_room_id uuid, p_friend uuid)`
- `get_home() returns jsonb` as `{ profile, incoming_requests, invites }`

Add `friendships` and `room_invites` to `supabase_realtime`.

#### 20260605120008_conversational.sql

This is the active app model.

Alter `rooms`:

- add `round int not null default 0`
- add `followups text[] not null default '{}'`

Create `responses`:

- `room_id uuid references rooms(id) on delete cascade`
- `user_id uuid references auth.users(id) on delete cascade`
- `answers jsonb not null default '{}'::jsonb`
- `ready boolean not null default false`
- `answered_round int not null default -1`
- `updated_at timestamptz not null default now()`
- primary key `(room_id, user_id)`

Enable RLS. Policy `responses_rw_self` allows authenticated users all operations only on their own row.

Create `submit_response(p_room_id uuid, p_answers jsonb, p_ready boolean) returns void`:

- require auth
- require caller is participant
- read current `rooms.round`
- upsert response
- merge JSON with `public.responses.answers || excluded.answers`
- set `ready = excluded.ready or public.responses.ready`
- if `p_ready`, set `answered_round = v_round`
- recompute `rooms.answered_count` as count of responses where `answered_round >= v_round`

Replace `get_room_state(p_code text) returns jsonb`:

- require auth
- find room by upper code
- require participant
- read caller's response into `v_mine`
- if room `status = 'revealed'`, include all responses ordered by `updated_at`, labeled `A`, `B`, `C`, as `{ label, answers }`
- return JSON with:
  - `id`, `code`, `question`, `category`, `location_label`, `host_id`, `is_host`, `status`
  - `round`, `followups`
  - `participant_count`, `answered_count`
  - `my_answers`, `my_round`
  - `result`, `responses`

### Edge Function: reveal-decision

Create `backend/supabase/functions/deno.json`:

```json
{
  "imports": {
    "openai": "npm:openai@4.104.0"
  },
  "compilerOptions": {
    "lib": ["deno.ns", "dom", "dom.iterable", "esnext"],
    "strict": true
  }
}
```

Create `_shared/edge-runtime.d.ts` so Deno/Edge types compile in the current editor environment.

#### reveal-decision/index.ts

Behavior:

1. CORS headers allow all origins, `authorization`, `x-client-info`, `apikey`, `content-type`, POST and OPTIONS.
2. OPTIONS returns `ok`.
3. Parse `{ room_id }`; 400 if missing.
4. Create user Supabase client from `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and request Authorization header.
5. `auth.getUser()`; 401 if unauthenticated.
6. Create admin client from `SUPABASE_SERVICE_ROLE_KEY`.
7. Load room. 404 if missing. 403 unless caller is `room.host_id`.
8. If already `revealed`, return existing `room.result`.
9. Set room status `revealing`.
10. Read ready rows from `responses`, selecting `answers, updated_at`, ordered by `updated_at`.
11. If no rows, set status `open` and return 400 `no answers yet`.
12. Build transcript with `buildResponsesTranscript`.
13. Call OpenAI via `callOpenAI`.
14. Parse with `parseConsensus`.
15. If `consensus:false`, update room:
    - `status: "open"`
    - `round: (room.round ?? 0) + 1`
    - `followups: [...(room.followups ?? []), consensus.followup_question]`
    - `answered_count: 0`
    - return `{ consensus:false, followup_question }`
16. If consensus, call `findVenue(consensus.places_query, room.lat, room.lng, GOOGLE_PLACES_API_KEY)`, swallowing Places errors to `venue = null`.
17. Write `result = { summary, cuisine, reasons, ruled_out, venue }`, `status = "revealed"`, `revealed_at = now`.
18. Return result. On synthesis failure, set status back to `open` and return 502.

#### reveal-decision/transcript.ts

Implement:

- Legacy `buildTranscript(answers: { body; updated_at }[])` that sorts by `updated_at`, trims body, labels `A.`, `B.`, etc.
- Active `buildResponsesTranscript(rows)` that summarizes each participant's JSON answers:
  - `budget X`
  - `style X`, except skip `anything`
  - `avoid X`, except skip `nothing`
  - `note: X`
  - `follow-up N: X`
  - fallback `(no strong preference)`

#### reveal-decision/consensus.ts

Implement `parseConsensus(raw: string)`:

- Parse JSON or throw.
- If `obj.consensus === false`, require a non-empty `followup_question`; return split branch with empty consensus fields.
- Otherwise require `cuisine` or `places_query`.
- `places_query` falls back to `cuisine`.
- Clamp `reasons` and `ruled_out` arrays to 4 strings each.

#### reveal-decision/places.ts

Implement:

- `haversineMeters`
- `walkMinutes(meters)` as `Math.max(1, Math.round(meters / 80))`
- `selectBest(places)` chooses highest rating if ratings exist, otherwise first, otherwise null
- `findVenue(query, lat, lng, apiKey)`
  - POST to `https://places.googleapis.com/v1/places:searchText`
  - body `{ textQuery, openNow: true, maxResultCount: 8 }`
  - if lat/lng, add `locationBias.circle.center` and radius 2000
  - use field mask `places.displayName,places.formattedAddress,places.rating,places.priceLevel,places.googleMapsUri,places.location,places.photos`
  - map Google price levels to 1..4
  - build photo URL as `https://places.googleapis.com/v1/${photo.name}/media?maxHeightPx=400&key=${apiKey}`
  - return `Venue | null`

#### reveal-decision/prompt.ts

Create `SYSTEM_PROMPT`:

- Persona: "You are Hunch. A group is privately deciding where to eat."
- Input lines A/B/C are private preferences.
- Return only strict JSON.
- Either:
  - consensus true with `summary`, `cuisine`, `places_query`, `reasons`, `ruled_out`
  - consensus false with one `followup_question` max 12 words
- Prefer consensus unless there is a real conflict.

`callOpenAI`:

- POST to `https://api.openai.com/v1/chat/completions`
- model `gpt-4o`
- temperature `0.4`
- `response_format: { type: "json_object" }`
- messages system prompt plus transcript.

#### reveal-decision tests

Create Deno tests:

- transcript labels legacy answers chronologically and trims.
- transcript handles single answer.
- response transcript summarizes per-round answers and skips `nothing`.
- consensus parses valid JSON, clamps arrays to 4.
- consensus falls back `places_query` to `cuisine`.
- consensus throws on non-JSON.
- consensus throws when cuisine and query missing.
- consensus handles follow-up branch.
- places: walk minutes min 1 and distance/80.
- places: haversine identical points is 0.
- places: selectBest highest rating, first unrated, null empty.

### Legacy Edge Function: consensus

Also create `backend/supabase/functions/consensus/index.ts`. This is a standalone legacy/experimental function not wired into the current frontend. It uses the OpenAI SDK import from deno.json.

Request body:

```ts
type RoomSubmission = {
  user_name: string;
  cuisine: string;
  location: string;
  pricing: string;
  custom_note: string;
};

type ConsensusRequestBody = {
  isPremium: boolean;
  roomHistoryMarkdown: string | null;
  currentRoomSubmissions: RoomSubmission[];
};
```

Response schema:

```ts
type ConsensusResponse = {
  status: "RESOLVED" | "FOLLOW_UP_REQUIRED";
  consensus_data: {
    verdict_title: string;
    cuisine_type: string;
    location_area: string;
    price_tier: string;
    reasoning_narrative: string;
    recommended_venues: string[];
  };
  follow_up_data: {
    target_users: string[];
    tailored_negotiation_question: string;
  };
};
```

It validates request shape, requires at least two users, rejects duplicate usernames, limits `custom_note` to 2000 chars, calls `openai.chat.completions.create` with model `OPENAI_CONSENSUS_MODEL ?? "gpt-4o-mini"`, temperature 0.2, and strict JSON schema response format. The system prompt is a Taipei food consensus engine with hard constraints, follow-up mechanics, premium history fairness, and exact output rules.

### Deploy Script

Create `backend/deploy.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="${1:?Usage: ./deploy.sh <PROJECT_REF>}"
: "${OPENAI_API_KEY:?export OPENAI_API_KEY first}"
: "${GOOGLE_PLACES_API_KEY:?export GOOGLE_PLACES_API_KEY first}"

cd "$(dirname "$0")"

supabase link --project-ref "$PROJECT_REF"
supabase db push
supabase secrets set OPENAI_API_KEY="$OPENAI_API_KEY" GOOGLE_PLACES_API_KEY="$GOOGLE_PLACES_API_KEY"
supabase functions deploy reveal-decision
supabase functions deploy consensus

echo "Done. Remember to set the frontend env vars and Supabase Auth redirect URLs."
```

Make it executable.

## Docs To Recreate

Root `README.md` should describe:

- Tagline: `Everyone already agrees. Hunch just finds it.`
- Stack: Next.js + Supabase + OpenAI + Google Places.
- Architecture: transactional CRUD via Postgres RPC, reveal via `reveal-decision`, RLS privacy, realtime progress via `rooms` row.
- Data model: `profiles`, `rooms`, `room_participants`, `answers` and active `responses`.
- Required secrets.
- Setup:
  - `cd frontend`, copy env, `npm install`, `npm run dev`
  - `cd backend`, `supabase link`, `supabase db push`, set secrets, deploy function
- Vercel deploy: root directory `frontend`.
- Tests:
  - `deno test backend/supabase/functions/reveal-decision/`
  - `cd frontend && npx tsc --noEmit && npm run build`
  - Playwright smoke.
- Pre-demo checklist for multi-user reveal.

Also recreate `docs/superpowers/BUILD_PROMPT.md`, `docs/superpowers/HUNCH_PROJECT_PLAN.md`, `docs/superpowers/specs/2026-06-05-hunch-design.md`, and `docs/superpowers/plans/2026-06-05-hunch.md` as planning documents. They can be concise but should include the product spec, architecture, data model, RPCs, reveal flow, realtime strategy, frontend flows, and implementation plan. Note that older docs may mention Next 15 or the legacy single-answer flow; the live app is Next 16 plus conversational `responses`.

## Config Files

`components.json`:

- schema `https://ui.shadcn.com/schema.json`
- style `base-nova`
- `rsc: true`, `tsx: true`
- Tailwind CSS `app/globals.css`, empty config, baseColor neutral, cssVariables true
- iconLibrary `lucide`
- aliases:
  - components `@/components`
  - utils `@/lib/utils`
  - ui `@/components/ui`
  - lib `@/lib`
  - hooks `@/hooks`

`tsconfig.json`:

- strict true
- noEmit true
- moduleResolution `bundler`
- jsx `react-jsx`
- path alias `"@/*": ["./*"]`
- include `.next/types/**/*.ts` and `.next/dev/types/**/*.ts`

`eslint.config.mjs`:

- `defineConfig`
- `eslint-config-next/core-web-vitals`
- `eslint-config-next/typescript`
- `globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"])`

`postcss.config.mjs`:

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

`playwright.config.ts`:

- `testDir: "./e2e"`
- base URL `process.env.E2E_BASE_URL ?? "http://localhost:3000"`
- if no E2E_BASE_URL, webServer command `npm run dev`, url localhost:3000, reuse existing, timeout 120000.

`settings.json` can preserve the current permissive Claude settings, but it is not needed for app behavior.

## Tests And Verification

After implementation:

```bash
npm run lint
npx tsc --noEmit
npm run build
deno test backend/supabase/functions/reveal-decision/
```

Then repeat from `frontend/` if you created duplicated package files:

```bash
cd frontend
npx tsc --noEmit
npm run build
```

Known current repo quirk: the Playwright test expects a landing button matching `/Start a room|Sign in to start/`, while the current landing button says `Get started`. For a passing recreation, update the test to click `Get started`. For exact preservation, keep the mismatch and document it.

## Acceptance Criteria

- Root and `frontend/` Next app trees both exist and mirror each other.
- The app builds under Next.js 16.2.7 with async `cookies()` and promise `params`.
- No `middleware.ts`; use `proxy.ts`.
- shadcn/Base UI components use `render`, not `asChild`.
- Logged-out landing works without Supabase env vars.
- Auth, create-room, room chat, reveal, friends, invites, share, and add-friend flows are implemented.
- Supabase migrations create the active conversational `responses` model and all RPCs used by the frontend.
- RLS prevents reading another user's `responses` row before reveal.
- Realtime subscriptions only broadcast room progress/status and social/invite row changes, never answer contents before reveal.
- `reveal-decision` supports both follow-up and consensus branches.
- Google Places failures degrade gracefully with `venue: null`.
- Deno unit tests for reveal pure logic pass.
- Vercel deploy root should be `frontend`.

## Build Order

1. Scaffold or create the Next app in `frontend/` first with the exact package versions.
2. Initialize shadcn with Base UI style and add the UI primitives.
3. Implement `frontend/app`, `frontend/components`, `frontend/lib`, configs, and public assets.
4. Copy/mirror `frontend` app/config files to the root app/config paths.
5. Implement Supabase migrations, schema file, config, deploy script, and Edge Functions.
6. Add docs and tests.
7. Run the verification commands and fix type/build/test issues.

Do not invent a different product or architecture. Prefer faithful recreation of the current repo, while calling out the two known stale artifacts: `schema.sql` missing migration 08 and the outdated Playwright button text.

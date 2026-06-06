# Hunch

> Everyone already agrees. Hunch just finds it.

AI group **food** decisions, minus the social pressure. A host opens a room and shares one link. Everyone signs in and answers privately in plain words — nobody sees anyone else's answer. The host reveals, and Hunch reads all the answers, surfaces the hidden consensus, and recommends a **real nearby restaurant** that matches it.

Mobile-first PWA · built with Next.js + Supabase + OpenAI + Google Places.

---

## Architecture

```
hunch-app/
├── frontend/   # Next.js 16 (App Router, TS) · Tailwind v4 · shadcn/ui · @supabase/ssr
└── backend/    # Supabase: Postgres + RLS + RPC + Realtime + one Edge Function
```

- **Transactional CRUD** (create room, join, submit answer, read state) → Postgres **RPC** functions.
- **The reveal** (the complex part) → a Supabase **Edge Function** `reveal-decision`: builds a labeled transcript → OpenAI synthesis → Google Places lookup → writes the result. API keys stay server-side.
- **Privacy is enforced in the database.** RLS hides every other person's answer until the room is `revealed` — not even the host can read them early. Realtime only broadcasts the `rooms` row (progress counts are denormalized onto it), so **no answer text ever crosses the wire** before reveal.
- **Realtime** progress: clients subscribe to the `rooms` row and re-fetch `get_room_state` on each update.

### Data model
- `profiles` — mirrors `auth.users`
- `rooms` — `code`, `host_id`, `question`, `location_label`, `lat/lng`, `status`, denormalized `participant_count`/`answered_count`, `result` jsonb
- `room_participants` — `(room_id, user_id)` → the "of N" denominator
- `answers` — `(room_id, user_id)`, one editable answer each

---

## What you need to supply

| Secret | Where it goes | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `frontend/.env.local` + Vercel | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `frontend/.env.local` + Vercel | the publishable/anon key |
| `GOOGLE_PLACES_API_KEY` | `frontend/.env.local` + Vercel (server-only) | used by `/api/geocode`; enable **Geocoding API** |
| `OPENAI_API_KEY` | Supabase Edge Function secret | for the synthesis |
| `GOOGLE_PLACES_API_KEY` | Supabase Edge Function secret | enable **Places API (New)** |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected into the function automatically.

---

## Setup

### Frontend
```bash
cd frontend
cp .env.example .env.local   # then fill in the values
npm install
npm run dev                  # http://localhost:3000
```

### Backend (hosted Supabase — no local stack)
```bash
cd backend
supabase link --project-ref <PROJECT_REF>

# Apply schema, RLS, RPC, realtime to the remote project:
supabase db push

# Set Edge Function secrets, then deploy the function:
supabase secrets set OPENAI_API_KEY=sk-... GOOGLE_PLACES_API_KEY=...
supabase functions deploy reveal-decision   # keep default verify_jwt=true

# (optional) regenerate strict DB types into the frontend:
supabase gen types typescript --project-id <PROJECT_REF> --schema public \
  > ../frontend/lib/database.types.ts
```

Or run `./backend/deploy.sh <PROJECT_REF>` after exporting `OPENAI_API_KEY` and `GOOGLE_PLACES_API_KEY`.

### Supabase Auth config
Add your URLs to **Authentication → URL Configuration**:
- Site URL: your Vercel production URL (and `http://localhost:3000` for dev)
- Redirect allowlist: `<site>/auth/callback`

---

## Deploy to Vercel
- **Root Directory:** `frontend`
- **Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `GOOGLE_PLACES_API_KEY`
- Then point Supabase Auth at the deployed URL (above).

---

## Tests
```bash
# Edge function pure logic (transcript / parsing / venue selection / walk math)
deno test backend/supabase/functions/reveal-decision/

# Frontend typecheck + build
cd frontend && npx tsc --noEmit && npm run build

# E2E smoke (host entry path)
cd frontend && npx playwright install --with-deps && npx playwright test
```

---

## Pre-demo checklist (full multi-user reveal)
1. Two browsers / two accounts. A creates a room; both open the link and sign in.
2. Both submit different answers — confirm "X of 2 answered" updates live.
3. In the Network tab, confirm **no answer bodies** appear in Realtime frames before reveal.
4. Host taps **Reveal the yes** → both see the same pick + a real venue card.
5. On a phone: confirm the PWA install prompt and the Share sheet work.

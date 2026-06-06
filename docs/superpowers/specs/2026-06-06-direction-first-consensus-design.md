# Direction-First Consensus Flow — Design

**Date:** 2026-06-06
**Status:** Implemented & deployed (2026-06-06)

## Problem

Today the room flow jumps straight to **specific restaurants** before the group
agrees on a **direction** (cuisine / vibe):

1. Round 0 scripted questions → host taps "Build the 3 picks" → `reveal-decision`
   returns 3 "compromise" restaurants → group votes → majority reveals; on a split
   it bumps the round and reopens the chat for a private follow-up.

This produces three concrete problems the user reported:

1. **Flow breaks after everyone picks a restaurant.** When all 3 vote differently
   (1‑1‑1), the room bounces back to a follow-up round and the experience falls
   apart (the follow-up question previously didn't even render).
2. **Vote UI isn't obvious.** After locking a vote, nothing visually signals the
   choice is made; non-selected options stay fully prominent.
3. **The flow is backwards.** With 2 people leaning Japanese and 1 leaning Western,
   the Western voter is shown 3 Japanese restaurants with no say. The group never
   agreed on a direction first.

## Goals

- Converge the room on **one shared direction** *before* showing any restaurant,
  using private follow-up questions (no literal vote — Hunch infers it).
- When someone leans differently, **probe them with a follow-up or two**, then
  commit warmly to the majority direction with picks tailored to win them over.
- **Announce the direction** ("Most of you are feeling Japanese tonight 🍜") and
  *then* show the picks.
- **Fully automatic:** once everyone answers a round, processing runs on its own —
  the host never taps a process button.
- Make the vote state obvious: dim non-selected options once a pick is locked.
- The flow is **strictly forward** and can never get stuck.

## Non-Goals (out of scope)

- A separate `direction` room status or a confirm-gate screen (rejected: Approach B).
- A literal cuisine vote (rejected: the group never explicitly votes on direction).
- A fully server-side auto-trigger via Postgres `pg_net` (noted as future hardening;
  we use a host-client trigger for now).

## New Flow

Strictly forward — never bounces back into chat once picks are shown:

```
open  (chat: scripted round 0 + capped private follow-ups to converge a direction)
  every round: when answered_count == participant_count → AUTO call reveal-decision
      → Hunch FOLLOW_UP  → new private question per participant (probe minority), stay in chat
      → Hunch OPTIONS    → locks a direction + 3 picks within it → status = choosing
choosing  (announce direction, then vote on the 3 picks)
      → majority (> half)                         → revealed
      → everyone voted, no majority → best-fit auto-pick → revealed   (no bounce-back)
```

`waiting`, `revealing`, and `revealed` statuses are unchanged. **No new status,
no new room columns.**

## Component Changes

### 1. AI contract — `backend/supabase/functions/reveal-decision/prompt.ts`

**Schema (`decisionSchema`, `DecisionPlan`):** add two fields:
- `direction: string` — short cuisine/vibe label, e.g. `"Japanese"`. Empty for FOLLOW_UP.
- `direction_copy: string` — warm, group-level announcement, e.g.
  `"Most of you are quietly leaning Japanese tonight 🍜"`. Never names individuals.

Both added to `required` (json_schema `strict: true` requires it); allowed to be
empty strings on a FOLLOW_UP response. `parseDecisionPlan` trims them, and when
`action === "OPTIONS"` it must reject a blank `direction`/`direction_copy`
(throw, same as the existing "must return 3 place queries" guard) so we never
reach `choosing` without an announcement.

**System prompt rewrite** — reframe Hunch's job as direction-first:
- First converge the room on **one shared direction** (a cuisine or vibe). Use
  private follow-ups to find it and to bring along anyone leaning differently —
  ask what would make the leading direction a genuine yes for them.
- Return `OPTIONS` **only** with a locked direction: exactly 3 real restaurants
  **all within that one direction**, ordered safe → cozy → standout, tailored so
  the minority still has a reason to say yes. Set `direction` and `direction_copy`.
- Keep all existing privacy rules (no labels/names leak; questions are private;
  reasons are anonymous and group-level).
- `direction_copy` is warm and group-level ("most of you…"), never per-person.

### 2. Orchestration — `backend/supabase/functions/reveal-decision/index.ts`

- **Follow-up cap.** Add `const MAX_FOLLOWUP_ROUNDS = 2` (tunable). When
  `room.round >= MAX_FOLLOWUP_ROUNDS`, append a hard instruction to the prompt:
  *"You MUST return OPTIONS now — commit to the majority direction."* This stops
  the loop. (Safety net: if the model still returns FOLLOW_UP at the cap, accept
  it rather than crash; in practice json_schema + the instruction comply.)
- **Store the announcement.** When writing the `choosing` result JSON (the
  `rooms.update({ status: "choosing", result: {...} })` block), add
  `direction: ai.plan.direction` and `direction_copy: ai.plan.direction_copy`.
  No DB migration — these ride inside the existing `result` jsonb.
- Restaurant options continue to be built from `ai.plan.place_queries`; the prompt
  guarantees they're all within `direction`.
- No other changes; the existing FOLLOW_UP branch (insert per-participant private
  prompts, round++, status `open`) stays as the convergence mechanism.

### 3. Final-vote resolution — new migration `…_autoresolve_place_vote.sql`

Redefine `public.vote_place_option`. Replace the current "everyone voted, no
majority → bump round + reopen chat" branch with **auto-resolve**:

- When `v_votes_cast >= v_total` and there is no majority winner, select the
  best-fit option ordered by **votes desc → `(venue->>'rating')::numeric` desc
  nulls last → `max(updated_at)` asc**, and reveal it (reuse the existing
  `status = 'revealed'` + `result` jsonb block, with a fitting summary).
- Remove the `room_private_prompts` insert and the `status = 'open'` reopen.

Result: once a direction is agreed, the group can never get stuck on the picks.
Update `backend/supabase/schema.sql` (generated snapshot) to match.

### 4. Auto-advance + chat — `frontend/components/chat-room.tsx`

- **Remove** the host "Build the 3 picks" / reveal button.
- **Auto-trigger (host only).** A `useRef<number|null>` tracks the last round we
  triggered. In an effect: if `state.is_host && state.status === "open" &&
  state.answered_count >= state.participant_count && triggeredRound.current !==
  state.round`, set `triggeredRound.current = state.round` and call `reveal()`.
  Fires once per round; the function flips status to `revealing` first and 409s
  duplicate calls, so concurrent refreshes are safe.
- **Passive status for everyone.** When caught up and everyone is in, show
  *"Everyone's in — Hunch is reading the room…"*. While still waiting, keep the
  *"Locked in — X of Y ready"* badge.
- **Error fallback (host only).** If `reveal()` errors, keep `triggeredRound`
  set (no auto-retry loop) and show a small *"Try again"* button that re-invokes
  `reveal()` for the current round. This is the only remaining manual button and
  appears only on error.
- The active follow-up question bubble (already added) continues to render the
  current round's private prompt.

### 5. Vote UI — `frontend/app/room/[code]/room-client.tsx` (`PlaceVoting`)

- **Direction announcement card** at the top of the choosing screen, styled like a
  Hunch message, showing `state.result?.direction_copy` (fallback:
  `result?.consensus_copy` → a generic "Here's the shortlist"). A slight stagger
  so it reads as "announce → picks".
- **Dim locked state.** Once `state.my_place_vote` is set, pass a `dimmed` prop to
  non-selected `PlaceOptionCard`s → `opacity-50` + reduced emphasis; the picked
  card stays full with its "Picked" badge. Voting remains switchable (tapping a
  dimmed card still works).

### 6. Types — `frontend/lib/types.ts`

Add `direction?: string` and `direction_copy?: string` to `RevealResult`.

## Data Flow

```
host client (realtime) sees answered_count == participant_count
  → POST reveal-decision (host JWT)
      → AI: FOLLOW_UP → room_private_prompts(round+1), rooms.status=open, round++
                         → clients refresh → chat shows new private question
      → AI: OPTIONS  → build venues, rooms.status=choosing,
                       result.{options, direction, direction_copy}
                         → clients refresh → PlaceVoting shows announcement + picks
participant taps a pick → vote_place_option (upsert)
  → majority           → rooms.status=revealed
  → all voted, no maj. → best-fit chosen → rooms.status=revealed
      → clients refresh → RevealCard
```

## Error Handling

- `reveal-decision` AI/places failures already revert `status` to `open`; the host
  client surfaces "Try again" (no silent retry loop).
- The follow-up cap guarantees the chat phase terminates.
- The vote tie-break guarantees the choosing phase terminates.
- Duplicate auto-triggers are absorbed by the `revealing` status guard (409).

## Testing

- **Deno unit tests** (`reveal-decision/*.test.ts`):
  - `parseDecisionPlan`: OPTIONS with `direction`/`direction_copy` parses; OPTIONS
    with blank direction throws; FOLLOW_UP with empty direction is allowed.
  - Existing consensus/transcript/places tests stay green.
- **SQL**: `vote_place_option` auto-resolve verified manually against the linked
  project (no DB unit-test harness): simulate a 1‑1‑1 split → room reveals the
  best-fit winner; a majority still reveals the majority pick.
- **Frontend**: manual verification (no component test harness) — round auto-advances
  with no button; follow-up renders; announcement card shows; non-selected cards dim
  after a vote.

## Resolved Decisions

- Direction is **AI-inferred privately** (not a vote).
- Minority is **probed, then committed warmly** to the majority direction.
- Transition is **announce-then-picks** (announcement card atop the choosing screen).
- Restaurant split on an agreed direction → **Hunch auto-picks best-fit** (not re-roll).
- Follow-up cap → **2 extra rounds** before forcing a direction.
- Auto-advance fires from the **host client**; server-side trigger deferred.

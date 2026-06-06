import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { findVenues, type Venue } from "./places.ts";
import { callOpenAI, type DecisionPlan, type PlacePlan } from "./prompt.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

interface ParticipantRow {
  user_id: string;
  joined_at: string;
}

interface ResponseRow {
  user_id: string;
  answers: Record<string, unknown>;
  updated_at: string;
  answered_round: number;
}

interface OptionRow {
  id: string;
  option_index: number;
  cuisine: string;
  rationale: string;
  venue: Venue;
}

interface VoteRow {
  user_id: string;
  option_id: string;
}

const labelFor = (index: number) => String.fromCharCode(65 + index);

function summarizeAnswers(answers: Record<string, unknown>): string {
  const parts: string[] = [];
  if (answers.budget) parts.push(`budget=${answers.budget}`);
  if (answers.style && answers.style !== "anything") parts.push(`style=${answers.style}`);
  if (answers.avoid && answers.avoid !== "nothing") parts.push(`avoid=${answers.avoid}`);
  if (answers.freestyle) parts.push(`note=${answers.freestyle}`);
  const followups = Array.isArray(answers.followups) ? answers.followups.filter(Boolean) : [];
  followups.forEach((answer, index) => parts.push(`private_followup_${index + 1}=${answer}`));
  return parts.join("; ") || "no strong preference";
}

function buildDecisionPrompt({
  room,
  participants,
  responses,
  previousOptions,
  previousVotes,
}: {
  room: Record<string, unknown>;
  participants: ParticipantRow[];
  responses: ResponseRow[];
  previousOptions: OptionRow[];
  previousVotes: VoteRow[];
}) {
  const responseByUser = new Map(responses.map((row) => [row.user_id, row]));
  const labels = new Map(participants.map((participant, index) => [participant.user_id, labelFor(index)]));
  const optionById = new Map(previousOptions.map((option) => [option.id, option]));

  const lines = participants.map((participant, index) => {
    const response = responseByUser.get(participant.user_id);
    return `${labelFor(index)}. ${summarizeAnswers(response?.answers ?? {})}`;
  });

  const voteLines = previousVotes.length
    ? previousVotes.map((vote) => {
      const option = optionById.get(vote.option_id);
      return `${labels.get(vote.user_id) ?? "?"} privately picked option ${option?.option_index ?? "?"}: ${option?.venue?.name ?? "unknown"}`;
    })
    : [];

  return [
    `Room question: ${room.question ?? "Where should we eat?"}`,
    `Location label: ${room.location_label ?? "not specified"}`,
    `Round: ${room.round ?? 0}`,
    "",
    "Private participant inputs:",
    ...lines,
    "",
    previousOptions.length ? "Previous place options:" : "",
    ...previousOptions.map((option) =>
      `${option.option_index}. ${option.venue.name} (${option.cuisine}) — ${option.rationale}`
    ),
    voteLines.length ? "" : "",
    voteLines.length ? "Private vote split from the last shortlist:" : "",
    ...voteLines,
    "",
    "Important: participant labels are only for private follow-up routing.",
    "Do not create one option per participant or reveal whose preference inspired an option.",
    "If returning OPTIONS, every option must be a whole-room compromise candidate.",
    "The three OPTIONS should be different compromise angles, not personal representatives.",
    "If you cannot find hidden overlap yet, return FOLLOW_UP and ask private compromise-discovery questions.",
    "",
    "Return FOLLOW_UP only if a fair 3-option shortlist is not possible yet.",
    "Return OPTIONS when you can produce exactly 3 distinct search plans for Google Places.",
  ].filter((line) => line !== "").join("\n");
}

function followupFor(label: string, plan: DecisionPlan): string | null {
  const question = plan.private_followups.find((followup) => followup.participant_label === label)?.question.trim();
  return question || null;
}

async function buildVenueOptions({
  plans,
  locationLabel,
  lat,
  lng,
  apiKey,
}: {
  plans: PlacePlan[];
  locationLabel: string | null;
  lat: number | null;
  lng: number | null;
  apiKey: string;
}) {
  const picked: Array<{ plan: PlacePlan; venue: Venue }> = [];
  const seen = new Set<string>();

  for (const plan of plans) {
    const query = [plan.search_query, locationLabel].filter(Boolean).join(" ");
    const venues = await findVenues(query, lat, lng, apiKey, 3);
    const venue = venues.find((candidate) => {
      const key = `${candidate.name}|${candidate.address}`.toLowerCase();
      return !seen.has(key);
    });
    if (!venue) continue;
    seen.add(`${venue.name}|${venue.address}`.toLowerCase());
    picked.push({ plan, venue });
  }

  if (picked.length < 3) {
    const fallbackQuery = ["restaurants", locationLabel].filter(Boolean).join(" ");
    const venues = await findVenues(fallbackQuery, lat, lng, apiKey, 8);
    for (const venue of venues) {
      const key = `${venue.name}|${venue.address}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push({
        plan: {
          cuisine: "Group-friendly pick",
          search_query: fallbackQuery,
          rationale: "A strong fallback that keeps the group close to a decision.",
          reasons: ["Easy for the group to compare", "Close enough to keep momentum"],
          ruled_out: [],
        },
        venue,
      });
      if (picked.length === 3) break;
    }
  }

  if (picked.length !== 3) throw new Error("could not find three venue options");
  return picked.slice(0, 3);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { room_id } = await req.json();
    if (!room_id) return json({ error: "room_id required" }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthenticated" }, 401);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: room } = await admin.from("rooms").select("*").eq("id", room_id).single();
    if (!room) return json({ error: "room not found" }, 404);
    if (room.host_id !== user.id) return json({ error: "only the host can reveal" }, 403);
    if (room.status === "revealed") return json(room.result); // idempotent
    if (room.status === "waiting") return json({ error: "waiting for invited members" }, 409);
    if (room.status !== "open") return json({ error: "room is not open" }, 409);

    const { data: participants } = await admin
      .from("room_participants")
      .select("user_id, joined_at")
      .eq("room_id", room_id)
      .order("joined_at", { ascending: true });

    if (!participants?.length) return json({ error: "no participants" }, 400);

    const { data: rows } = await admin
      .from("responses")
      .select("user_id, answers, updated_at, answered_round")
      .eq("room_id", room_id)
      .gte("answered_round", room.round ?? 0)
      .order("updated_at", { ascending: true });

    const answeredUsers = new Set((rows ?? []).map((row: ResponseRow) => row.user_id));
    if (participants.some((participant: ParticipantRow) => !answeredUsers.has(participant.user_id))) {
      return json({ error: "waiting for everyone to answer" }, 409);
    }

    await admin.from("rooms").update({ status: "revealing" }).eq("id", room_id);

    const { data: previousOptions } = await admin
      .from("room_place_options")
      .select("id, option_index, cuisine, rationale, venue")
      .eq("room_id", room_id)
      .lt("round", room.round ?? 0)
      .order("round", { ascending: false })
      .order("option_index", { ascending: true })
      .limit(3);

    const { data: previousVotes } = await admin
      .from("room_place_votes")
      .select("user_id, option_id")
      .eq("room_id", room_id);

    const { data: aiSession } = await admin
      .from("room_ai_sessions")
      .select("openai_response_id")
      .eq("room_id", room_id)
      .maybeSingle();

    let ai;
    try {
      ai = await callOpenAI(
        buildDecisionPrompt({
          room,
          participants: participants as ParticipantRow[],
          responses: (rows ?? []) as ResponseRow[],
          previousOptions: (previousOptions ?? []) as OptionRow[],
          previousVotes: (previousVotes ?? []) as VoteRow[],
        }),
        Deno.env.get("OPENAI_API_KEY")!,
        aiSession?.openai_response_id ?? null,
      );
    } catch (_e) {
      await admin.from("rooms").update({ status: "open" }).eq("id", room_id);
      return json({ error: "synthesis failed, try again" }, 502);
    }

    await admin.from("room_ai_sessions").upsert({
      room_id,
      openai_response_id: ai.id,
      round: room.round ?? 0,
      last_action: ai.plan.action,
      updated_at: new Date().toISOString(),
    });

    if (ai.plan.action === "FOLLOW_UP") {
      const nextRound = (room.round ?? 0) + 1;
      const promptRows = (participants as ParticipantRow[]).map((participant, index) => {
        const label = labelFor(index);
        return {
          room_id,
          user_id: participant.user_id,
          round: nextRound,
          prompt: followupFor(label, ai.plan) ??
            "What would make a group compromise genuinely good for you, and what are you quietly willing to trade off?",
        };
      });

      await admin.from("room_private_prompts").upsert(promptRows);
      await admin
        .from("rooms")
        .update({
          status: "open",
          round: nextRound,
          answered_count: 0,
        })
        .eq("id", room_id);
      return json({ consensus: false, followups: promptRows.length });
    }

    let options;
    try {
      options = await buildVenueOptions({
        plans: ai.plan.place_queries,
        locationLabel: room.location_label ?? null,
        lat: room.lat,
        lng: room.lng,
        apiKey: Deno.env.get("GOOGLE_PLACES_API_KEY")!,
      });
    } catch (_e) {
      await admin.from("rooms").update({ status: "open" }).eq("id", room_id);
      return json({ error: "places failed, try again" }, 502);
    }

    await admin.from("room_place_votes").delete().eq("room_id", room_id);
    await admin.from("room_place_options").delete().eq("room_id", room_id).eq("round", room.round ?? 0);

    const optionRows = options.map((option, index) => ({
      room_id,
      option_index: index + 1,
      round: room.round ?? 0,
      cuisine: option.plan.cuisine,
      rationale: option.plan.rationale,
      reasons: option.plan.reasons,
      ruled_out: option.plan.ruled_out.length ? option.plan.ruled_out : ai.plan.ruled_out,
      venue: option.venue,
    }));

    const { data: insertedOptions, error: insertError } = await admin
      .from("room_place_options")
      .insert(optionRows)
      .select("id, option_index, cuisine, rationale, reasons, ruled_out, venue")
      .order("option_index", { ascending: true });

    if (insertError || !insertedOptions) {
      await admin.from("rooms").update({ status: "open" }).eq("id", room_id);
      return json({ error: "failed to save options" }, 500);
    }

    await admin
      .from("rooms")
      .update({
        status: "choosing",
        answered_count: 0,
        result: {
          summary: ai.plan.room_summary,
          cuisine: "Consensus shortlist",
          reasons: ai.plan.anonymous_reasons,
          ruled_out: ai.plan.ruled_out,
          venue: null,
          options: insertedOptions,
          consensus_copy: ai.plan.consensus_copy,
          success_copy: ai.plan.success_copy,
        },
      })
      .eq("id", room_id);

    return json({ consensus: true, options: insertedOptions });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

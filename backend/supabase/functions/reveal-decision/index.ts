import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildResponsesTranscript } from "./transcript.ts";
import { parseConsensus } from "./consensus.ts";
import { findVenue } from "./places.ts";
import { callOpenAI } from "./prompt.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

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

    await admin.from("rooms").update({ status: "revealing" }).eq("id", room_id);

    const { data: rows } = await admin
      .from("responses")
      .select("answers, updated_at")
      .eq("room_id", room_id)
      .eq("ready", true)
      .order("updated_at", { ascending: true });

    if (!rows || rows.length === 0) {
      await admin.from("rooms").update({ status: "open" }).eq("id", room_id);
      return json({ error: "no answers yet" }, 400);
    }

    let consensus;
    try {
      const raw = await callOpenAI(buildResponsesTranscript(rows), Deno.env.get("OPENAI_API_KEY")!);
      consensus = parseConsensus(raw);
    } catch (_e) {
      await admin.from("rooms").update({ status: "open" }).eq("id", room_id);
      return json({ error: "synthesis failed, try again" }, 502);
    }

    // Split group → post one follow-up question and re-open for another round.
    if (!consensus.consensus) {
      await admin
        .from("rooms")
        .update({
          status: "open",
          round: (room.round ?? 0) + 1,
          followups: [...(room.followups ?? []), consensus.followup_question],
          answered_count: 0,
        })
        .eq("id", room_id);
      return json({ consensus: false, followup_question: consensus.followup_question });
    }

    // Consensus → find a real venue (graceful if Places fails) and reveal.
    let venue = null;
    try {
      venue = await findVenue(
        consensus.places_query,
        room.lat,
        room.lng,
        Deno.env.get("GOOGLE_PLACES_API_KEY")!,
      );
    } catch (_e) {
      venue = null;
    }

    const result = {
      summary: consensus.summary,
      cuisine: consensus.cuisine,
      reasons: consensus.reasons,
      ruled_out: consensus.ruled_out,
      venue,
    };
    await admin
      .from("rooms")
      .update({ status: "revealed", result, revealed_at: new Date().toISOString() })
      .eq("id", room_id);

    return json(result);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

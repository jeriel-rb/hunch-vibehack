import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseDecisionPlan, SYSTEM_PROMPT } from "./prompt.ts";

const option = (rationale: string) => ({
  cuisine: "Comfort noodles",
  search_query: "comfort noodle restaurant",
  rationale,
  reasons: ["Warm, flexible, and easy to share"],
  ruled_out: [],
});

Deno.test("prompt forbids one option per participant", () => {
  assert(SYSTEM_PROMPT.includes("Never create one option per participant"));
  assert(SYSTEM_PROMPT.includes("Every place option must be a whole-room compromise"));
});

Deno.test("rejects follow-up plans with no usable private question", () => {
  assertThrows(() =>
    parseDecisionPlan(JSON.stringify({
      action: "FOLLOW_UP",
      room_summary: "",
      consensus_copy: "",
      success_copy: "",
      anonymous_reasons: [],
      ruled_out: [],
      place_queries: [],
      private_followups: [{ participant_label: "A", question: "   " }],
    }))
  );
});

Deno.test("sanitizes participant-leaking option rationales", () => {
  const plan = parseDecisionPlan(JSON.stringify({
    action: "OPTIONS",
    room_summary: "Compromise lane",
    consensus_copy: "Three real group options.",
    success_copy: "Consensus unlocked.",
    anonymous_reasons: ["The group has enough overlap"],
    ruled_out: [],
    place_queries: [
      option("A's ramen pick, but cheaper."),
      option("Participant B wanted something cozy."),
      option("A shared comfort option that keeps the group flexible."),
    ],
    private_followups: [],
  }));

  assertEquals(plan.place_queries[0].rationale.includes("A"), false);
  assertEquals(plan.place_queries[1].rationale.includes("Participant B"), false);
  assertEquals(plan.place_queries[2].rationale, "A shared comfort option that keeps the group flexible.");
});

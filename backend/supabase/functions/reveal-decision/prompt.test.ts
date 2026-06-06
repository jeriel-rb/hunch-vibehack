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

Deno.test("prompt is direction-first", () => {
  assert(SYSTEM_PROMPT.includes("direction"));
  assert(SYSTEM_PROMPT.includes("FOLLOW_UP"));
  assert(SYSTEM_PROMPT.includes("OPTIONS"));
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

const optionsPlan = (overrides: Record<string, unknown> = {}) => ({
  action: "OPTIONS",
  room_summary: "Compromise lane",
  consensus_copy: "Three real group options.",
  success_copy: "Consensus unlocked.",
  direction: "Japanese",
  direction_copy: "Most of you are quietly leaning Japanese tonight 🍜",
  anonymous_reasons: ["The group has enough overlap"],
  ruled_out: [],
  place_queries: [
    option("A safe overlap pick."),
    option("A warm comfort pick."),
    option("A shared comfort option that keeps the group flexible."),
  ],
  private_followups: [],
  ...overrides,
});

Deno.test("sanitizes participant-leaking option rationales", () => {
  const plan = parseDecisionPlan(JSON.stringify(optionsPlan({
    place_queries: [
      option("A's ramen pick, but cheaper."),
      option("Participant B wanted something cozy."),
      option("A shared comfort option that keeps the group flexible."),
    ],
  })));

  assertEquals(plan.place_queries[0].rationale.includes("A"), false);
  assertEquals(plan.place_queries[1].rationale.includes("Participant B"), false);
  assertEquals(plan.place_queries[2].rationale, "A shared comfort option that keeps the group flexible.");
});

Deno.test("OPTIONS returns the locked direction and announcement", () => {
  const plan = parseDecisionPlan(JSON.stringify(optionsPlan()));
  assertEquals(plan.direction, "Japanese");
  assert(plan.direction_copy.includes("Japanese"));
});

Deno.test("OPTIONS without a direction is rejected", () => {
  assertThrows(() => parseDecisionPlan(JSON.stringify(optionsPlan({ direction: "   " }))));
});

Deno.test("OPTIONS derives announcement copy when missing", () => {
  const plan = parseDecisionPlan(JSON.stringify(optionsPlan({ direction_copy: "" })));
  assert(plan.direction_copy.toLowerCase().includes("japanese"));
});

Deno.test("FOLLOW_UP allows empty direction fields", () => {
  const plan = parseDecisionPlan(JSON.stringify({
    action: "FOLLOW_UP",
    room_summary: "",
    consensus_copy: "",
    success_copy: "",
    direction: "",
    direction_copy: "",
    anonymous_reasons: [],
    ruled_out: [],
    place_queries: [],
    private_followups: [{ participant_label: "A", question: "What would make Japanese a yes tonight?" }],
  }));
  assertEquals(plan.action, "FOLLOW_UP");
  assertEquals(plan.direction, "");
});

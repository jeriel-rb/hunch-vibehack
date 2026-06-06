export interface PlacePlan {
  cuisine: string;
  search_query: string;
  rationale: string;
  reasons: string[];
  ruled_out: string[];
}

export interface PrivateFollowup {
  participant_label: string;
  question: string;
}

export interface DecisionPlan {
  action: "FOLLOW_UP" | "OPTIONS";
  room_summary: string;
  consensus_copy: string;
  success_copy: string;
  anonymous_reasons: string[];
  ruled_out: string[];
  place_queries: PlacePlan[];
  private_followups: PrivateFollowup[];
}

export const SYSTEM_PROMPT =
  `You are Hunch, a private group consensus engine for deciding where to eat.

The app gives you anonymized participant inputs labeled A, B, C, etc. Users must not see
each other's private answers before the final reveal. You may use all inputs, but your
outputs must preserve privacy.

Your job each round:
- Respect hard constraints first: allergies, dietary rules, strict budgets, transport limits, and avoid lists.
- Prefer a practical compromise that gives every participant a meaningful reason to say yes.
- If there is enough overlap, return OPTIONS with exactly 3 distinct restaurant search plans.
- If there is not enough overlap, return FOLLOW_UP with private, targeted follow-up questions.

Privacy rules:
- Never quote one participant's private answer to another participant.
- Follow-up questions must be private and addressed by participant label only.
- Final reasons must be anonymous, aggregated, and group-level.

Tone:
- Fun, sharp, kind, and confident.
- No moralizing. No bland "based on preferences" filler.
- Success copy should feel celebratory: the group escaped decision chaos.

Return only JSON matching the schema.`;

const decisionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "action",
    "room_summary",
    "consensus_copy",
    "success_copy",
    "anonymous_reasons",
    "ruled_out",
    "place_queries",
    "private_followups",
  ],
  properties: {
    action: { type: "string", enum: ["FOLLOW_UP", "OPTIONS"] },
    room_summary: { type: "string" },
    consensus_copy: { type: "string" },
    success_copy: { type: "string" },
    anonymous_reasons: {
      type: "array",
      maxItems: 4,
      items: { type: "string" },
    },
    ruled_out: {
      type: "array",
      maxItems: 4,
      items: { type: "string" },
    },
    place_queries: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["cuisine", "search_query", "rationale", "reasons", "ruled_out"],
        properties: {
          cuisine: { type: "string" },
          search_query: { type: "string" },
          rationale: { type: "string" },
          reasons: {
            type: "array",
            maxItems: 4,
            items: { type: "string" },
          },
          ruled_out: {
            type: "array",
            maxItems: 4,
            items: { type: "string" },
          },
        },
      },
    },
    private_followups: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["participant_label", "question"],
        properties: {
          participant_label: { type: "string" },
          question: { type: "string" },
        },
      },
    },
  },
} as const;

function extractOutputText(json: Record<string, unknown>): string {
  if (typeof json.output_text === "string") return json.output_text;

  const output = Array.isArray(json.output) ? json.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown }).content)
      ? (item as { content: unknown[] }).content
      : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") return text;
    }
  }

  return "";
}

function parseDecisionPlan(raw: string): DecisionPlan {
  const obj = JSON.parse(raw) as DecisionPlan;
  const placeQueries = Array.isArray(obj.place_queries) ? obj.place_queries : [];
  const privateFollowups = Array.isArray(obj.private_followups) ? obj.private_followups : [];

  if (obj.action === "OPTIONS" && placeQueries.length !== 3) {
    throw new Error("model must return exactly 3 place queries");
  }
  if (obj.action === "FOLLOW_UP" && privateFollowups.length === 0) {
    throw new Error("model missing private follow-ups");
  }

  return {
    action: obj.action,
    room_summary: obj.room_summary ?? "",
    consensus_copy: obj.consensus_copy ?? "",
    success_copy: obj.success_copy ?? "",
    anonymous_reasons: (obj.anonymous_reasons ?? []).slice(0, 4),
    ruled_out: (obj.ruled_out ?? []).slice(0, 4),
    place_queries: placeQueries.slice(0, 3).map((query) => ({
      cuisine: query.cuisine ?? "",
      search_query: query.search_query ?? query.cuisine ?? "restaurants",
      rationale: query.rationale ?? "",
      reasons: (query.reasons ?? []).slice(0, 4),
      ruled_out: (query.ruled_out ?? obj.ruled_out ?? []).slice(0, 4),
    })),
    private_followups: privateFollowups.map((followup) => ({
      participant_label: followup.participant_label?.trim().toUpperCase() ?? "",
      question: followup.question ?? "",
    })),
  };
}

export async function callOpenAI(
  prompt: string,
  apiKey: string,
  previousResponseId?: string | null,
): Promise<{ id: string | null; plan: DecisionPlan }> {
  const body: Record<string, unknown> = {
    model: Deno.env.get("OPENAI_MODEL") ?? "gpt-4o",
    store: true,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "hunch_decision_plan",
        strict: true,
        schema: decisionSchema,
      },
    },
  };

  if (previousResponseId) body.previous_response_id = previousResponseId;

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as Record<string, unknown>;
  const raw = extractOutputText(json);
  if (!raw) throw new Error("empty model output");

  return {
    id: typeof json.id === "string" ? json.id : null,
    plan: parseDecisionPlan(raw),
  };
}

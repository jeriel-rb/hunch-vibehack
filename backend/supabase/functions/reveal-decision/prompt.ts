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
  direction: string;
  direction_copy: string;
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

Work in two stages — direction first, restaurants second:

STAGE 1 — Find one shared direction.
- Your first job is to converge the whole room on a single direction: one cuisine or vibe
  everyone can be happy with tonight (e.g. "Japanese", "cozy comfort food", "casual Western").
- Respect hard constraints first: allergies, dietary rules, strict budgets, transport limits, and avoid lists.
- Find the hidden overlap: the direction everyone can secretly enjoy or feel good accepting.
- If someone is leaning a different way, point your private follow-up at the LEADING (majority)
  direction with a concrete accommodation — e.g. "the group's leaning Japanese tonight — want me to
  find a lighter, less-heavy one?" Ask about the direction you will actually deliver. NEVER ask about
  their diverging cuisine and then serve another (do not ask "is Western ok?" then return Japanese).
  Never pressure, never reveal that the room is split.
- If there is not yet one clear shared direction, return FOLLOW_UP with private, targeted questions.

STAGE 2 — Only once a single shared direction is clear, return OPTIONS.
- Set "direction" to the agreed direction label (e.g. "Japanese").
- Set "direction_copy" to a short, warm, group-level announcement of it, e.g.
  "Most of you are quietly leaning Japanese tonight 🍜". Never name or imply specific individuals.
- Return exactly 3 real restaurant search plans, ALL within that one direction
  (three angles: safest overlap, warm comfort, interesting-but-safe stretch).
- Tailor the picks so anyone who leaned differently still has a genuine reason to say yes.

Consensus quality rules:
- Never create one option per participant. The shortlist is not "A's pick, B's pick, C's pick".
- Every place option must be a whole-room compromise candidate within the one direction, not a personal representative.
- Each option should satisfy all hard constraints and combine at least two compatible private signals.
- Participant labels are routing labels for private follow-up questions only. Never put labels or names in place queries, rationales, reasons, direction copy, or reveal copy.
- If you cannot yet name one shared direction, return FOLLOW_UP instead of OPTIONS.

Follow-up rules:
- When returning FOLLOW_UP, ask each participant a private question whenever possible.
- Each private question should uncover what shared direction they'd enjoy, what they are quietly
  willing to trade off, or whether the leading direction would work for them.
- If the room is already leaning one way, aim every follow-up at THAT leading direction, and the
  direction you commit to in OPTIONS must match what your follow-ups asked about.
- Never ask about one cuisine and serve another (no direction bait-and-switch).
- Do not ask generic "what do you want?" questions.

Privacy rules:
- Never quote one participant's private answer to another participant.
- Follow-up questions must be private and addressed by participant label only.
- Final reasons and direction copy must be anonymous, aggregated, and group-level.

Tone:
- Fun, sharp, kind, and confident.
- No moralizing. No bland "based on preferences" filler.
- Success and direction copy should feel celebratory: the group quietly already agreed.

Return only JSON matching the schema. For FOLLOW_UP, "direction", "direction_copy", and
"place_queries" may be empty.`;

const PRIVATE_LABEL_PATTERN =
  /\b(?:participant|person|user)\s+[A-Z]\b|\b[A-Z]'s\b|\bfor\s+[A-Z]\b|\b[A-Z]\s+(?:wanted|asked|picked|prefers|likes|needs|avoids)\b/i;

const RATIONALE_FALLBACKS = [
  "Balanced group compromise built from the strongest shared signals.",
  "Flexible middle lane that keeps the room close to a real yes.",
  "Group-friendly stretch that stays inside the room's hard constraints.",
];

function compactText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function safeOptionText(value: unknown, fallback: string): string {
  const text = compactText(value);
  if (!text || PRIVATE_LABEL_PATTERN.test(text)) return fallback;
  return text;
}

const decisionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "action",
    "direction",
    "direction_copy",
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
    direction: { type: "string" },
    direction_copy: { type: "string" },
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

export function parseDecisionPlan(raw: string): DecisionPlan {
  const obj = JSON.parse(raw) as DecisionPlan;
  const placeQueries = Array.isArray(obj.place_queries) ? obj.place_queries : [];
  const privateFollowups = Array.isArray(obj.private_followups)
    ? obj.private_followups
      .map((followup) => ({
        participant_label: compactText(followup.participant_label).toUpperCase(),
        question: compactText(followup.question),
      }))
      .filter((followup) => followup.participant_label && followup.question)
    : [];

  const direction = compactText(obj.direction);
  const directionCopy = safeOptionText(obj.direction_copy, "") ||
    (direction ? `Most of you are leaning ${direction} tonight` : "");

  if (obj.action === "OPTIONS" && placeQueries.length !== 3) {
    throw new Error("model must return exactly 3 place queries");
  }
  if (obj.action === "OPTIONS" && !direction) {
    throw new Error("model must return a direction for OPTIONS");
  }
  if (obj.action === "FOLLOW_UP" && privateFollowups.length === 0) {
    throw new Error("model missing private follow-ups");
  }

  return {
    action: obj.action,
    direction,
    direction_copy: directionCopy,
    room_summary: obj.room_summary ?? "",
    consensus_copy: obj.consensus_copy ?? "",
    success_copy: obj.success_copy ?? "",
    anonymous_reasons: (obj.anonymous_reasons ?? []).slice(0, 4),
    ruled_out: (obj.ruled_out ?? []).slice(0, 4),
    place_queries: placeQueries.slice(0, 3).map((query, index) => ({
      cuisine: safeOptionText(query.cuisine, "Group-friendly compromise"),
      search_query: safeOptionText(query.search_query, query.cuisine ?? "group-friendly restaurants"),
      rationale: safeOptionText(query.rationale, RATIONALE_FALLBACKS[index] ?? RATIONALE_FALLBACKS[0]),
      reasons: (query.reasons ?? [])
        .slice(0, 4)
        .map((reason, reasonIndex) =>
          safeOptionText(reason, reasonIndex === 0 ? "It keeps multiple private signals in play." : "It avoids turning the shortlist into personal picks.")
        ),
      ruled_out: (query.ruled_out ?? obj.ruled_out ?? []).slice(0, 4),
    })),
    private_followups: privateFollowups,
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

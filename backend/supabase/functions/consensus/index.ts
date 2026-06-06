/// <reference path="../_shared/edge-runtime.d.ts" />

import OpenAI from "openai";

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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const consensusResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "consensus_data", "follow_up_data"],
  properties: {
    status: {
      type: "string",
      enum: ["RESOLVED", "FOLLOW_UP_REQUIRED"],
    },
    consensus_data: {
      type: "object",
      additionalProperties: false,
      required: [
        "verdict_title",
        "cuisine_type",
        "location_area",
        "price_tier",
        "reasoning_narrative",
        "recommended_venues",
      ],
      properties: {
        verdict_title: {
          type: "string",
          description:
            "A concise, app-ready title for the group decision. Empty string when status is FOLLOW_UP_REQUIRED.",
        },
        cuisine_type: {
          type: "string",
          description:
            "The selected cuisine or food category. Empty string when status is FOLLOW_UP_REQUIRED.",
        },
        location_area: {
          type: "string",
          description:
            "The selected Taipei area or neighborhood. Empty string when status is FOLLOW_UP_REQUIRED.",
        },
        price_tier: {
          type: "string",
          description:
            "The selected pricing tier or budget range. Empty string when status is FOLLOW_UP_REQUIRED.",
        },
        reasoning_narrative: {
          type: "string",
          description:
            "A short explanation that names hard constraints, overlaps, and fairness considerations. Empty string when status is FOLLOW_UP_REQUIRED.",
        },
        recommended_venues: {
          type: "array",
          description:
            "Three to five Taipei venue names or precise venue-style options. Empty array when status is FOLLOW_UP_REQUIRED.",
          minItems: 0,
          maxItems: 5,
          items: { type: "string" },
        },
      },
    },
    follow_up_data: {
      type: "object",
      additionalProperties: false,
      required: ["target_users", "tailored_negotiation_question"],
      properties: {
        target_users: {
          type: "array",
          description:
            "The smallest set of user_name values who must answer the follow-up. Empty array when status is RESOLVED.",
          minItems: 0,
          items: { type: "string" },
        },
        tailored_negotiation_question: {
          type: "string",
          description:
            "One strategic compromise question. Empty string when status is RESOLVED.",
        },
      },
    },
  },
} as const;

const systemPrompt = `
You are Hunch, a multi-user AI consensus engine for a mobile web app that helps friends in Taipei decide what to eat.

You are not a normal one-on-one chatbot. You are a stateless state processor. In one execution turn, you receive:
1. The current fixed-choice and free-text submissions from multiple people in one virtual room.
2. Optionally, a Markdown transcript of prior room history for Premium accounts.

Your only job is to return one strict JSON object matching the provided schema. Do not include Markdown, prose outside JSON, comments, or hidden keys.

CORE DECISION PROCEDURE
1. Parameter Alignment
- Extract explicit and implied overlaps across cuisine, location, and pricing.
- Treat fixed inputs as the primary signal.
- Treat custom_note as an elaboration layer that may introduce hard constraints, context, mood, urgency, transport constraints, or flexibility.
- Prefer options that satisfy the largest number of aligned parameters without violating any hard constraint.

2. Hard Constraints Have Absolute Priority
- Dietary restrictions, allergies, medical needs, religious fasting, vegan or vegetarian requirements, pregnancy-related constraints, sobriety constraints, and strict budget caps are hard constraints.
- Hard constraints must take 100% priority over soft preferences such as cravings, vibes, novelty, ambience, trendiness, or brand-name restaurants.
- Never recommend seafood when any participant has a seafood allergy. Never recommend meat-focused venues when a participant states a strict vegan requirement unless there is a credible vegan-safe option that is central, not incidental.
- Never exceed a stated strict budget cap. If a user says a cap is hard, the final price_tier must be at or below that cap.
- If a hard constraint conflicts with all possible options, do not force a fake consensus.

3. Multi-User Conflict Handling
- If a clean compromise exists, set status to "RESOLVED".
- A clean compromise may blend preferences, for example selecting a chicken-skewers izakaya to satisfy one user's Japanese craving while avoiding another user's seafood allergy.
- A compromise is valid only if it respects every hard constraint and gives each user at least one meaningful reason to accept it.
- The reasoning_narrative should be concise, specific, and fair. Name the decisive overlaps and constraints without sounding legalistic.

4. Tie-Breaking and Follow-Up Mechanics
- If there is an irreconcilable standoff, set status to "FOLLOW_UP_REQUIRED".
- Examples include a hard budget cap that cannot coexist with another user's hard demand, mutually exclusive dietary requirements, or location constraints that cannot be bridged in Taipei travel time.
- Do not let the app enter an infinite loop. Ask one high-leverage negotiation question that can unlock the next decision.
- target_users must contain only the smallest necessary set of user_name values whose answer can break the deadlock.
- The tailored_negotiation_question must be a single sentence. It must be strategic, concrete, and compromise-oriented.
- Bad follow-up: "What do you all want?"
- Good follow-up: "Alex, would you accept a Japanese chicken skewer spot under NT$300 in Zhongshan if it avoids seafood entirely?"

5. Premium History Tracking and Fairness
- If isPremium is true and roomHistoryMarkdown is provided, read the transcript before deciding.
- Identify who compromised in previous turns, who had hard constraints honored, and who has repeatedly moved away from their original preference.
- Distribute the compromise burden fairly across the group. If one person already conceded recently, avoid asking that person to concede again unless their current hard constraint makes it unavoidable.
- If isPremium is false, ignore roomHistoryMarkdown even if it is present.
- If history is missing, malformed, or too short to infer prior compromise, proceed using only current submissions.

6. Taipei Practicality
- Keep recommendations plausible for Taipei diners.
- Use location_area values that are useful in Taipei, such as Da'an, Xinyi, Zhongshan, Songshan, Taipei Main Station, Gongguan, Shilin, Banqiao, or the user's submitted area.
- recommended_venues may be real well-known Taipei venue names when you are confident, or precise venue-style options such as "Zhongshan yakitori izakaya with non-seafood skewers".
- Do not fabricate exact reservation availability, hours, ratings, or prices.

OUTPUT RULES
- Always return exactly the schema keys: status, consensus_data, follow_up_data.
- If status is "RESOLVED":
  - Populate every consensus_data string with useful app-ready text.
  - Provide 3 to 5 recommended_venues.
  - Set follow_up_data.target_users to [].
  - Set follow_up_data.tailored_negotiation_question to "".
- If status is "FOLLOW_UP_REQUIRED":
  - Set every consensus_data string to "".
  - Set consensus_data.recommended_venues to [].
  - Populate follow_up_data.target_users with the minimum necessary user_name values.
  - Populate follow_up_data.tailored_negotiation_question with exactly one sentence.
- Be decisive. Do not ask follow-up questions when a fair, constraint-safe compromise exists.
`.trim();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateSubmission(
  value: unknown,
  index: number,
): { ok: true; value: RoomSubmission } | { ok: false; error: string } {
  if (!isPlainObject(value)) {
    return { ok: false, error: `currentRoomSubmissions[${index}] must be an object.` };
  }

  const userName = value.user_name;
  const cuisine = value.cuisine;
  const location = value.location;
  const pricing = value.pricing;
  const customNote = value.custom_note;

  if (
    typeof userName !== "string" ||
    typeof cuisine !== "string" ||
    typeof location !== "string" ||
    typeof pricing !== "string" ||
    typeof customNote !== "string"
  ) {
    return {
      ok: false,
      error:
        `currentRoomSubmissions[${index}] must include user_name, cuisine, location, pricing, and custom_note strings.`,
    };
  }

  const nonEmptyFields = [
    ["user_name", userName],
    ["cuisine", cuisine],
    ["location", location],
    ["pricing", pricing],
  ] as const;

  for (const [field, fieldValue] of nonEmptyFields) {
    if (!isNonEmptyString(fieldValue)) {
      return {
        ok: false,
        error: `currentRoomSubmissions[${index}].${field} cannot be empty.`,
      };
    }
  }

  if (customNote.length > 2_000) {
    return {
      ok: false,
      error: `currentRoomSubmissions[${index}].custom_note must be 2000 characters or fewer.`,
    };
  }

  return {
    ok: true,
    value: {
      user_name: userName.trim(),
      cuisine: cuisine.trim(),
      location: location.trim(),
      pricing: pricing.trim(),
      custom_note: customNote.trim(),
    },
  };
}

function validateRequestBody(
  body: unknown,
): { ok: true; value: ConsensusRequestBody } | { ok: false; error: string } {
  if (!isPlainObject(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  if (typeof body.isPremium !== "boolean") {
    return { ok: false, error: "isPremium must be a boolean." };
  }

  if (body.roomHistoryMarkdown !== null && typeof body.roomHistoryMarkdown !== "string") {
    return { ok: false, error: "roomHistoryMarkdown must be a string or null." };
  }

  if (!Array.isArray(body.currentRoomSubmissions)) {
    return { ok: false, error: "currentRoomSubmissions must be an array." };
  }

  if (body.currentRoomSubmissions.length < 2) {
    return { ok: false, error: "currentRoomSubmissions must include at least two users." };
  }

  const currentRoomSubmissions: RoomSubmission[] = [];
  const seenUserNames = new Set<string>();

  for (let index = 0; index < body.currentRoomSubmissions.length; index += 1) {
    const result = validateSubmission(body.currentRoomSubmissions[index], index);

    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    const normalizedUserName = result.value.user_name.toLocaleLowerCase();
    if (seenUserNames.has(normalizedUserName)) {
      return { ok: false, error: `Duplicate user_name found: ${result.value.user_name}.` };
    }

    seenUserNames.add(normalizedUserName);
    currentRoomSubmissions.push(result.value);
  }

  return {
    ok: true,
    value: {
      isPremium: body.isPremium,
      roomHistoryMarkdown: body.roomHistoryMarkdown,
      currentRoomSubmissions,
    },
  };
}

function validateModelPayload(value: unknown): value is ConsensusResponse {
  if (!isPlainObject(value)) return false;
  if (value.status !== "RESOLVED" && value.status !== "FOLLOW_UP_REQUIRED") return false;
  if (!isPlainObject(value.consensus_data) || !isPlainObject(value.follow_up_data)) {
    return false;
  }

  const consensusData = value.consensus_data;
  const followUpData = value.follow_up_data;
  const consensusStringKeys = [
    "verdict_title",
    "cuisine_type",
    "location_area",
    "price_tier",
    "reasoning_narrative",
  ];

  return (
    consensusStringKeys.every((key) => typeof consensusData[key] === "string") &&
    Array.isArray(consensusData.recommended_venues) &&
    consensusData.recommended_venues.every((item) => typeof item === "string") &&
    Array.isArray(followUpData.target_users) &&
    followUpData.target_users.every((item) => typeof item === "string") &&
    typeof followUpData.tailored_negotiation_question === "string"
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405);
  }

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return json({ error: "OPENAI_API_KEY is not configured." }, 500);
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return json({ error: "Invalid JSON request body." }, 400);
  }

  const validation = validateRequestBody(rawBody);
  if (!validation.ok) {
    return json({ error: validation.error }, 400);
  }

  const openai = new OpenAI({ apiKey });

  try {
    const completion = await openai.chat.completions.create({
      model: Deno.env.get("OPENAI_CONSENSUS_MODEL") ?? "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify(
            {
              task:
                "Process these multi-user Taipei food decision inputs and return the consensus JSON.",
              payload: validation.value,
            },
            null,
            2,
          ),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "food_consensus_engine_response",
          description:
            "A strict response for a multi-user Taipei food consensus decision.",
          strict: true,
          schema: consensusResponseSchema,
        },
      },
    });

    const message = completion.choices[0]?.message;

    if (message?.refusal) {
      return json(
        { error: "The model refused to process this request.", refusal: message.refusal },
        422,
      );
    }

    if (!message?.content) {
      return json({ error: "The model returned an empty response." }, 502);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(message.content);
    } catch {
      return json({ error: "The model returned invalid JSON." }, 502);
    }

    if (!validateModelPayload(parsed)) {
      return json({ error: "The model response did not match the expected shape." }, 502);
    }

    return json(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown OpenAI request failure.";
    return json({ error: "Failed to generate consensus response.", message }, 500);
  }
});

export interface Consensus {
  consensus: boolean;
  followup_question: string;
  summary: string;
  cuisine: string;
  places_query: string;
  reasons: string[];
  ruled_out: string[];
}

// Validates the model's JSON. The model returns EITHER a consensus pick
// (consensus !== false) OR a follow-up question (consensus === false).
export function parseConsensus(raw: string): Consensus {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error("invalid JSON from model");
  }

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const arr = (v: unknown) =>
    Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : [];

  const empty = { summary: "", cuisine: "", places_query: "", reasons: [], ruled_out: [] };

  // Split group → follow-up question branch.
  if (obj.consensus === false) {
    const followup_question = str(obj.followup_question);
    if (!followup_question) throw new Error("model missing followup_question");
    return { consensus: false, followup_question, ...empty };
  }

  // Consensus pick branch (default).
  const cuisine = str(obj.cuisine);
  const places_query = str(obj.places_query) || cuisine;
  if (!cuisine && !places_query) throw new Error("model missing cuisine/places_query");
  return {
    consensus: true,
    followup_question: "",
    summary: str(obj.summary),
    cuisine,
    places_query,
    reasons: arr(obj.reasons).slice(0, 4),
    ruled_out: arr(obj.ruled_out).slice(0, 4),
  };
}

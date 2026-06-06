export const SYSTEM_PROMPT =
  `You are Hunch. A group is privately deciding where to eat. Each line (A, B, C…) is one
person's private preferences: budget, cuisine style, things to avoid, and free notes.

Find the single restaurant TYPE the whole group is secretly happy with. Respect everyone's
budget and honor every "avoid". Find the overlap nobody said out loud.

Return ONLY strict JSON, one of two shapes:

If you can confidently pick:
{
  "consensus": true,
  "summary": "short phrase describing the consensus mood",
  "cuisine": "the concrete dish or cuisine to eat",
  "places_query": "a Google Maps search query to find a matching restaurant",
  "reasons": ["2-4 short reasons in the deck's voice, e.g. '3 of 5 wanted comfort food'"],
  "ruled_out": ["1-3 things the group avoided, e.g. '4 of 5 ruled out spicy'"]
}

If the group is genuinely split and you can't pick fairly:
{
  "consensus": false,
  "followup_question": "ONE short question (max 12 words) that would break the tie"
}

Prefer consensus:true unless there is a real conflict.`;

// Calls OpenAI Chat Completions in JSON mode and returns the raw content string.
export async function callOpenAI(transcript: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Here is everyone's input:\n\n${transcript}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

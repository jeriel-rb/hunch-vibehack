export interface AnswerRow {
  body: string;
  updated_at: string;
}

// Compiles answers into a labeled transcript (A. … B. …) in chronological order,
// matching the deck's reveal slide and giving the model stable references.
export function buildTranscript(answers: AnswerRow[]): string {
  return answers
    .slice()
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
    .map((a, i) => `${String.fromCharCode(65 + i)}. ${a.body.trim()}`)
    .join("\n");
}

export interface ResponseRow {
  answers: Record<string, unknown>;
  updated_at?: string;
}

// Summarizes each participant's per-round answers into one labeled line.
export function buildResponsesTranscript(rows: ResponseRow[]): string {
  return rows
    .map((r, i) => {
      const a = r.answers ?? {};
      const parts: string[] = [];
      if (a.budget) parts.push(`budget ${a.budget}`);
      if (a.style && a.style !== "anything") parts.push(`style ${a.style}`);
      if (a.avoid && a.avoid !== "nothing") parts.push(`avoid ${a.avoid}`);
      if (a.freestyle) parts.push(`note: ${a.freestyle}`);
      const f = Array.isArray(a.followups) ? (a.followups as unknown[]).filter(Boolean) : [];
      f.forEach((ans, k) => parts.push(`follow-up ${k + 1}: ${ans}`));
      return `${String.fromCharCode(65 + i)}. ${parts.join("; ") || "(no strong preference)"}`;
    })
    .join("\n");
}

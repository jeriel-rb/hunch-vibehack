import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildTranscript, buildResponsesTranscript } from "./transcript.ts";

Deno.test("labels answers A,B,C in chronological order and trims", () => {
  const out = buildTranscript([
    { body: "craving chicken", updated_at: "2026-06-05T10:00:02Z" },
    { body: "  nothing spicy ", updated_at: "2026-06-05T10:00:01Z" },
  ]);
  assertEquals(out, "A. nothing spicy\nB. craving chicken");
});

Deno.test("handles a single answer", () => {
  assertEquals(buildTranscript([{ body: "ramen", updated_at: "x" }]), "A. ramen");
});

Deno.test("responses transcript summarizes per-round answers, skipping 'nothing'", () => {
  const out = buildResponsesTranscript([
    { answers: { budget: "$$", style: "Japanese", avoid: "too spicy", freestyle: "something warm" } },
    { answers: { budget: "$", style: "anything", avoid: "nothing", followups: ["soup"] } },
  ]);
  assertEquals(
    out,
    "A. budget $$; style Japanese; avoid too spicy; note: something warm\n" +
      "B. budget $; follow-up 1: soup",
  );
});

import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseConsensus } from "./consensus.ts";

Deno.test("parses valid model JSON and clamps arrays to 4", () => {
  const c = parseConsensus(
    JSON.stringify({
      summary: "comfort food",
      cuisine: "chicken noodle",
      places_query: "chicken noodle soup",
      reasons: ["3 of 5 wanted comfort food", "a", "b", "c", "d"],
      ruled_out: ["4 of 5 ruled out spicy"],
    }),
  );
  assertEquals(c.cuisine, "chicken noodle");
  assertEquals(c.places_query, "chicken noodle soup");
  assertEquals(c.reasons.length, 4);
  assertEquals(c.ruled_out, ["4 of 5 ruled out spicy"]);
});

Deno.test("falls back places_query to cuisine when missing", () => {
  const c = parseConsensus(JSON.stringify({ cuisine: "ramen" }));
  assertEquals(c.places_query, "ramen");
});

Deno.test("throws on non-JSON", () => {
  assertThrows(() => parseConsensus("not json"));
});

Deno.test("throws when cuisine and query both missing", () => {
  assertThrows(() => parseConsensus(JSON.stringify({ summary: "x" })));
});

Deno.test("follow-up branch when consensus is false", () => {
  const c = parseConsensus(JSON.stringify({ consensus: false, followup_question: "Soup or rice?" }));
  assertEquals(c.consensus, false);
  assertEquals(c.followup_question, "Soup or rice?");
});

Deno.test("throws when split but no followup question", () => {
  assertThrows(() => parseConsensus(JSON.stringify({ consensus: false })));
});

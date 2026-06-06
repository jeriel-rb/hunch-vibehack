import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { haversineMeters, selectBest, walkMinutes, type PlaceResult } from "./places.ts";

Deno.test("walkMinutes ~ distance/80, min 1", () => {
  assertEquals(walkMinutes(0), 1);
  assertEquals(walkMinutes(320), 4);
});

Deno.test("haversine is ~0 for identical points", () => {
  assertEquals(Math.round(haversineMeters(35.66, 139.7, 35.66, 139.7)), 0);
});

Deno.test("selectBest prefers highest rating", () => {
  const places: PlaceResult[] = [
    { displayName: { text: "A" }, formattedAddress: "a", rating: 4.1, location: { latitude: 0, longitude: 0 } },
    { displayName: { text: "B" }, formattedAddress: "b", rating: 4.8, location: { latitude: 0, longitude: 0 } },
  ];
  assertEquals(selectBest(places)?.displayName.text, "B");
});

Deno.test("selectBest falls back to first when none rated", () => {
  const places: PlaceResult[] = [
    { displayName: { text: "A" }, formattedAddress: "a", location: { latitude: 0, longitude: 0 } },
  ];
  assertEquals(selectBest(places)?.displayName.text, "A");
});

Deno.test("selectBest returns null on empty", () => {
  assertEquals(selectBest([]), null);
});

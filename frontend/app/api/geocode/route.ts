import { NextResponse } from "next/server";

// Resolves a location to coordinates + a readable label at create time, so rooms
// always store concrete lat/lng and the edge function never geocodes. Supports
// forward (?q=area) and reverse (?lat=..&lng=..) lookups — the latter turns the
// creator's device coordinates into a clean area label.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = params.get("q")?.trim();
  const lat = params.get("lat");
  const lng = params.get("lng");

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return NextResponse.json({ error: "geocoding not configured" }, { status: 503 });

  const reverse = Boolean(lat && lng);
  if (!reverse && !q) return NextResponse.json({ error: "q or lat/lng required" }, { status: 400 });

  const query = reverse
    ? `latlng=${encodeURIComponent(`${lat},${lng}`)}`
    : `address=${encodeURIComponent(q!)}`;
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${query}&key=${key}`);
  const data = await res.json();
  const results = (data.results ?? []) as Array<{
    formatted_address: string;
    types?: string[];
    geometry: { location: { lat: number; lng: number } };
  }>;

  // For reverse lookups, prefer a city/neighborhood result over a precise street address.
  const r = reverse
    ? results.find((x) => (x.types ?? []).some((t) => t === "locality" || t === "sublocality")) ?? results[0]
    : results[0];
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({
    label: r.formatted_address,
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
  });
}

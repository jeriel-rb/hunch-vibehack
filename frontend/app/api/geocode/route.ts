import { NextResponse } from "next/server";

// Resolves a typed area (e.g. "Shibuya, Tokyo") to coordinates at create time,
// so rooms always store concrete lat/lng and the edge function never geocodes.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "q required" }, { status: 400 });

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return NextResponse.json({ error: "geocoding not configured" }, { status: 503 });

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${key}`;
  const res = await fetch(url);
  const data = await res.json();
  const r = data.results?.[0];
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({
    label: r.formatted_address as string,
    lat: r.geometry.location.lat as number,
    lng: r.geometry.location.lng as number,
  });
}

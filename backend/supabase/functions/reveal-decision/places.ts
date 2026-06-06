export interface PlaceResult {
  displayName: { text: string };
  formattedAddress: string;
  rating?: number;
  priceLevel?: string; // e.g. "PRICE_LEVEL_MODERATE"
  googleMapsUri?: string;
  location: { latitude: number; longitude: number };
  photos?: { name: string }[];
}

export interface Venue {
  name: string;
  address: string;
  rating: number | null;
  price_level: number | null;
  photo_url: string | null;
  maps_url: string | null;
  walk_minutes: number | null;
}

export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function walkMinutes(meters: number): number {
  return Math.max(1, Math.round(meters / 80)); // ~80 m/min walking pace
}

export function selectBest(places: PlaceResult[]): PlaceResult | null {
  if (!places.length) return null;
  const rated = places.filter((p) => typeof p.rating === "number");
  if (rated.length) return rated.slice().sort((a, b) => b.rating! - a.rating!)[0];
  return places[0];
}

export function selectTop(places: PlaceResult[], count: number): PlaceResult[] {
  const scored = places.slice().sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  return scored.slice(0, count);
}

const PRICE: Record<string, number> = {
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

function toVenue(best: PlaceResult, lat: number | null, lng: number | null, apiKey: string): Venue {
  const meters =
    lat != null && lng != null
      ? haversineMeters(lat, lng, best.location.latitude, best.location.longitude)
      : null;
  const photo = best.photos?.[0]?.name
    ? `https://places.googleapis.com/v1/${best.photos[0].name}/media?maxHeightPx=400&key=${apiKey}`
    : null;

  return {
    name: best.displayName.text,
    address: best.formattedAddress,
    rating: best.rating ?? null,
    price_level: best.priceLevel ? PRICE[best.priceLevel] ?? null : null,
    photo_url: photo,
    maps_url: best.googleMapsUri ?? null,
    walk_minutes: meters != null ? walkMinutes(meters) : null,
  };
}

async function searchPlaces(
  query: string,
  lat: number | null,
  lng: number | null,
  apiKey: string,
  maxResultCount = 8,
): Promise<PlaceResult[]> {
  const body: Record<string, unknown> = { textQuery: query, openNow: true, maxResultCount };
  if (lat != null && lng != null) {
    body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 2000 } };
  }

  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.displayName,places.formattedAddress,places.rating,places.priceLevel,places.googleMapsUri,places.location,places.photos",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`places ${res.status}`);

  const data = (await res.json()) as { places?: PlaceResult[] };
  return data.places ?? [];
}

// Queries Google Places (New) Text Search and maps the best match to a Venue.
export async function findVenue(
  query: string,
  lat: number | null,
  lng: number | null,
  apiKey: string,
): Promise<Venue | null> {
  const places = await searchPlaces(query, lat, lng, apiKey);
  const best = selectBest(places);
  if (!best) return null;

  return toVenue(best, lat, lng, apiKey);
}

export async function findVenues(
  query: string,
  lat: number | null,
  lng: number | null,
  apiKey: string,
  count = 3,
): Promise<Venue[]> {
  const places = await searchPlaces(query, lat, lng, apiKey, Math.max(8, count));
  return selectTop(places, count).map((place) => toVenue(place, lat, lng, apiKey));
}

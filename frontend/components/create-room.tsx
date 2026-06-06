"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin } from "lucide-react";
import { toast } from "sonner";
import type { Category } from "@/lib/types";

export function CreateRoom({
  category,
  defaultQuestion,
  needsLocation = true,
}: {
  category: Category;
  defaultQuestion: string;
  needsLocation?: boolean;
}) {
  const router = useRouter();
  const [question, setQuestion] = useState(defaultQuestion);
  const [area, setArea] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(false);

  function useMyLocation() {
    if (!navigator.geolocation) return toast.error("Geolocation not available");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setArea("My current location");
        toast.success("Location set");
      },
      () => toast.error("Couldn't get your location — type an area instead"),
    );
  }

  async function start() {
    setLoading(true);

    let lat = coords?.lat ?? null;
    let lng = coords?.lng ?? null;
    let label = area.trim() || null;

    if (needsLocation && lat == null && area.trim()) {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(area)}`);
      if (r.ok) {
        const g = await r.json();
        lat = g.lat;
        lng = g.lng;
        label = g.label;
      } else {
        setLoading(false);
        return toast.error("Couldn't find that area — try a different spelling");
      }
    }

    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_room", {
      p_question: question,
      p_category: category,
      p_location_label: label,
      p_lat: lat,
      p_lng: lng,
    });
    setLoading(false);

    if (error || !data) return toast.error(error?.message ?? "Failed to create room");
    router.push(`/room/${data.code}`);
  }

  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-border/60 bg-card p-5 shadow-sm ring-1 ring-foreground/3">
      <label className="text-[15px] text-muted-foreground">The question</label>
      <Input value={question} onChange={(e) => setQuestion(e.target.value)} />

      {needsLocation && (
        <>
          <label className="mt-1 text-[15px] text-muted-foreground">Where are you eating?</label>
          <div className="flex gap-2">
            <Input
              placeholder="e.g. Shibuya, Tokyo"
              value={area}
              onChange={(e) => {
                setArea(e.target.value);
                setCoords(null);
              }}
            />
            <Button type="button" variant="secondary" size="icon" className="size-12 shrink-0 rounded-xl" aria-label="Use my location" onClick={useMyLocation}>
              <MapPin className="size-4" />
            </Button>
          </div>
        </>
      )}

      <Button className="mt-2 h-12 text-base glow-primary" onClick={start} disabled={loading}>
        {loading ? "Starting…" : "Start the room"}
      </Button>
    </div>
  );
}

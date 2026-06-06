"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, MapPin, Sparkles, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import type { Category, FriendUser, SocialData } from "@/lib/types";

function initials(user: FriendUser) {
  return (user.display_name || user.username).slice(0, 2).toUpperCase();
}

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
  const [friends, setFriends] = useState<FriendUser[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [launching, setLaunching] = useState<{ code: string; count: number } | null>(null);

  const selectedMembers = useMemo(
    () => friends.filter((friend) => selected.has(friend.id)),
    [friends, selected],
  );
  const memberCount = selectedMembers.length + 1;

  useEffect(() => {
    let cancelled = false;
    async function loadFriends() {
      const supabase = createClient();
      const { data } = await supabase.rpc("get_social");
      if (cancelled) return;
      const social = data as unknown as SocialData | null;
      setFriends(social?.friends ?? []);
      setLoadingFriends(false);
    }
    loadFriends();
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleFriend(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
      p_member_ids: selectedMembers.map((member) => member.id),
    });

    if (error || !data) {
      setLoading(false);
      return toast.error(error?.message ?? "Failed to create room");
    }

    setLaunching({ code: data.code, count: memberCount });
    setTimeout(() => router.push(`/room/${data.code}`), 1250);
  }

  return (
    <>
      {launching && <RoomLaunchSplash code={launching.code} count={launching.count} />}

      <div className="flex flex-col gap-4 rounded-3xl border border-border/60 bg-card p-5 shadow-sm ring-1 ring-foreground/3">
        <div className="flex flex-col gap-3">
          <label className="text-[15px] text-muted-foreground">The question</label>
          <Input value={question} onChange={(e) => setQuestion(e.target.value)} />
        </div>

        {needsLocation && (
          <div className="flex flex-col gap-3">
            <label className="text-[15px] text-muted-foreground">Where are you eating?</label>
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
          </div>
        )}

        <section className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-secondary/40 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-xl bg-primary/10 text-primary">
                <Users className="size-4" />
              </span>
              <div className="leading-tight">
                <p className="font-semibold">Members first</p>
                <p className="text-[13px] text-muted-foreground">
                  {selectedMembers.length === 0 ? "Solo room" : `${selectedMembers.length} invite${selectedMembers.length === 1 ? "" : "s"} to accept`}
                </p>
              </div>
            </div>
            <Button variant="secondary" size="sm" render={<Link href="/friends" />}>
              <UserPlus className="size-4" />
              Add
            </Button>
          </div>

          {loadingFriends ? (
            <div className="grid grid-cols-3 gap-2">
              <span className="h-16 rounded-2xl shimmer" />
              <span className="h-16 rounded-2xl shimmer" />
              <span className="h-16 rounded-2xl shimmer" />
            </div>
          ) : friends.length === 0 ? (
            <p className="rounded-2xl bg-card/70 px-3 py-2.5 text-[14px] leading-snug text-muted-foreground">
              Add friends first, or start solo and share the room code after entry.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {friends.map((friend) => {
                const picked = selected.has(friend.id);
                return (
                  <button
                    key={friend.id}
                    type="button"
                    onClick={() => toggleFriend(friend.id)}
                    className={`lift flex items-center gap-2 rounded-2xl border p-2 text-left transition ${
                      picked
                        ? "border-primary/40 bg-primary/10 text-foreground shadow-sm shadow-primary/10"
                        : "border-border/70 bg-card/70 text-muted-foreground"
                    }`}
                  >
                    <Avatar className="size-8">
                      <AvatarFallback className="bg-linear-to-br from-primary to-[#9b7bff] text-xs font-semibold text-primary-foreground">
                        {initials(friend)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">@{friend.username}</span>
                    {picked && <Check className="size-4 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <Button className="h-12 text-base glow-primary" onClick={start} disabled={loading || launching !== null}>
          {loading
            ? "Creating…"
            : selectedMembers.length === 0
              ? "Start solo"
              : `Invite ${selectedMembers.length} and wait`}
        </Button>
      </div>
    </>
  );
}

function RoomLaunchSplash({ code, count }: { code: string; count: number }) {
  return (
    <div className="room-launch" role="status" aria-live="polite">
      <div className="room-launch-grid" aria-hidden="true" />
      <div className="room-launch-core">
        <div className="launch-dots" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-primary">Waiting room</p>
        <h2 className="font-display text-4xl font-semibold tracking-tight">{code}</h2>
        <p className="text-sm text-muted-foreground">
          {count === 1 ? "Solo room opening" : `${count - 1} invite${count === 2 ? "" : "s"} sent`}
        </p>
        <div className="launch-bar" aria-hidden="true" />
      </div>
      <Sparkles className="room-launch-spark room-launch-spark-a" aria-hidden="true" />
      <Sparkles className="room-launch-spark room-launch-spark-b" aria-hidden="true" />
    </div>
  );
}

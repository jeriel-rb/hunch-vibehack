"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CategoryGrid } from "@/components/category-grid";
import { JoinRoomCode } from "@/components/join-room-code";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  ArrowRight,
  BellRing,
  Clock3,
  Loader2,
  LockKeyhole,
  LogOut,
  Ticket,
  Users,
  X,
} from "lucide-react";
import { getCategory } from "@/lib/categories";
import type { HomeData, RoomHistoryItem } from "@/lib/types";
import { toast } from "sonner";

export function HomeDashboard({ initial }: { initial: HomeData }) {
  const router = useRouter();
  const [home, setHome] = useState<HomeData>(initial);
  const [supabase] = useState(() => createClient());
  const [decliningInvite, setDecliningInvite] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data } = await supabase.rpc("get_home");
    if (data) setHome(data as unknown as HomeData);
  }, [supabase]);

  useEffect(() => {
    // RLS scopes realtime delivery to this user's own rows.
    const channel = supabase
      .channel("home")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "friendships",
      }, () => refresh())
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "room_invites",
      }, () => refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, refresh]);

  async function signOut() {
    await supabase.auth.signOut();
    router.refresh();
  }

  async function declineInvite(roomId: string) {
    setDecliningInvite(roomId);
    const { error } = await supabase.rpc("respond_room_invite", {
      p_room_id: roomId,
      p_accept: false,
    });
    setDecliningInvite(null);

    if (error) return toast.error(error.message);

    setHome((current) => ({
      ...current,
      invites: current.invites.filter((invite) => invite.room_id !== roomId),
    }));
    toast.success("Invite declined");
    refresh();
  }

  return (
    <main className="stagger mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar className="size-10">
            <AvatarFallback className="bg-linear-to-br from-primary to-[#9b7bff] text-sm font-semibold text-primary-foreground">
              {home.profile.username.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="leading-tight">
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              Hunch<span className="text-primary">.</span>
            </h1>
            <p className="text-[15px] text-muted-foreground">
              Hey @{home.profile.username}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="relative rounded-full"
            onClick={() => router.push("/friends")}
          >
            <Users className="size-4" />
            Friends
            {home.incoming_requests > 0 && (
              <Badge className="absolute -right-1.5 -top-1.5 size-5 justify-center rounded-full bg-accent p-0 text-accent-foreground">
                {home.incoming_requests}
              </Badge>
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label="Sign out"
            onClick={signOut}
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </header>

      {home.invites.length > 0 && (
        <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-card p-4 shadow-sm ring-1 ring-primary/10">
          <span className="pointer-events-none absolute -right-10 -top-14 size-32 rounded-full border border-primary/20" />
          <span className="pointer-events-none absolute -right-4 -top-8 size-20 rounded-full border border-primary/30 animate-pulse" />
          <div className="relative flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                <BellRing className="size-5" />
              </span>
              <div className="min-w-0 leading-tight">
                <h2 className="font-display text-lg font-semibold">
                  You&apos;re invited
                </h2>
                <p className="truncate text-sm text-muted-foreground">
                  Accept before the room starts
                </p>
              </div>
            </div>
            <Badge className="shrink-0 rounded-full bg-primary/10 text-primary hover:bg-primary/10">
              {home.invites.length}
            </Badge>
          </div>
          <div className="relative mt-3 flex flex-col gap-2">
            {home.invites.map((inv) => {
              const cat = getCategory(inv.category);
              const declining = decliningInvite === inv.room_id;
              return (
                <div
                  key={inv.code}
                  className="flex items-center gap-2 rounded-2xl border border-border/60 bg-background/70 p-2"
                >
                  <button
                    type="button"
                    onClick={() => router.push(`/room/${inv.code}`)}
                    className="lift flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl p-1.5 text-left transition hover:text-primary"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {inv.question}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        @{inv.inviter} · {cat?.label ?? inv.category}
                      </span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                      <Ticket className="size-3.5" />
                      {inv.code}
                      <ArrowRight className="size-3.5" />
                    </span>
                  </button>
                  <Button
                    variant="destructive"
                    size="icon"
                    className="size-9 shrink-0 rounded-xl"
                    aria-label={`Decline invite ${inv.code}`}
                    disabled={decliningInvite !== null}
                    onClick={() => declineInvite(inv.room_id)}
                  >
                    {declining
                      ? <Loader2 className="size-4 animate-spin" />
                      : <X className="size-4" />}
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold">
          What are we deciding?
        </h2>
        <CategoryGrid isPro={home.profile.is_pro} />
        <JoinRoomCode />
      </section>

      <RoomHistory
        history={home.history ?? []}
        isPro={home.profile.is_pro}
        onOpen={(code) => router.push(`/room/${code}`)}
      />
    </main>
  );
}

function RoomHistory({
  history,
  isPro,
  onOpen,
}: {
  history: RoomHistoryItem[];
  isPro: boolean;
  onOpen: (code: string) => void;
}) {
  return (
    <section className="flex flex-col gap-3 pb-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Room history</h2>
          <p className="text-sm text-muted-foreground">
            {isPro
              ? "Jump back into recent rooms."
              : "Upgrade to reopen past rooms."}
          </p>
        </div>
        {!isPro && (
          <Badge className="shrink-0 rounded-full bg-primary/10 text-primary hover:bg-primary/10">
            <LockKeyhole className="size-3.5" />
            Pro
          </Badge>
        )}
      </div>

      {history.length === 0
        ? (
          <div className="rounded-3xl border border-border/60 bg-card p-4 text-[15px] text-muted-foreground">
            Your rooms will appear here after you start deciding.
          </div>
        )
        : (
          <div className="flex flex-col gap-2">
            {history.map((room) => (
              <RoomHistoryCard
                key={room.room_id}
                room={room}
                locked={!isPro}
                onOpen={() => onOpen(room.code)}
              />
            ))}
          </div>
        )}
    </section>
  );
}

function RoomHistoryCard({
  room,
  locked,
  onOpen,
}: {
  room: RoomHistoryItem;
  locked: boolean;
  onOpen: () => void;
}) {
  const cat = getCategory(room.category);
  const title = room.venue_name ?? room.summary ?? room.question;
  const when = formatHistoryDate(room.revealed_at ?? room.created_at);
  const statusLabel = room.status === "revealed" ? "Revealed" : room.status;

  return (
    <button
      type="button"
      disabled={locked}
      onClick={locked ? undefined : onOpen}
      className={`flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card p-3 text-left transition ${
        locked
          ? "cursor-not-allowed opacity-75"
          : "lift hover:border-primary/35"
      }`}
    >
      <span className="min-w-0">
        <span className="block truncate font-medium">{title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>{cat?.label ?? room.category}</span>
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5" />
            {room.participant_count}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock3 className="size-3.5" />
            {when}
          </span>
        </span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
        {locked
          ? <LockKeyhole className="size-3.5" />
          : <Ticket className="size-3.5" />}
        {locked ? "Locked" : statusLabel}
      </span>
    </button>
  );
}

function formatHistoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
    .format(date);
}

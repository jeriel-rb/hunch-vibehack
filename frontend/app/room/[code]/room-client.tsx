"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { RoomMember, RoomState } from "@/lib/types";
import { ChatRoom } from "@/components/chat-room";
import { RevealCard } from "@/components/reveal-card";
import { ShareButton } from "@/components/share-button";
import { InviteFriends } from "@/components/invite-friends";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { BellRing, CheckCircle2, ChevronLeft, Clock3, Link2, Loader2, LockKeyhole, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";

export function RoomClient({ initial, userId }: { initial: RoomState; userId: string }) {
  const [state, setState] = useState<RoomState>(initial);
  const [supabase] = useState(() => createClient());
  const [accepting, setAccepting] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await supabase.rpc("get_room_state", { p_code: initial.code });
    if (data) setState(data as unknown as RoomState);
  }, [supabase, initial.code]);

  useEffect(() => {
    const channel = supabase
      .channel(`room:${initial.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${initial.id}` },
        () => refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_invites", filter: `room_id=eq.${initial.id}` },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, initial.id, refresh]);

  async function acceptInvite() {
    setAccepting(true);
    const { error } = await supabase.rpc("respond_room_invite", { p_room_id: state.id, p_accept: true });
    setAccepting(false);
    if (error) return toast.error(error.message);
    toast.success("You're in");
    refresh();
  }

  const revealed = state.status === "revealed" && state.result;
  const waiting = state.status === "waiting";

  return (
    <main className="mx-auto flex h-dvh max-w-md flex-col p-5">
      <header className="flex items-center justify-between gap-3 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/"
            aria-label="Home"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-card text-muted-foreground ring-1 ring-border transition-colors hover:text-foreground"
          >
            <ChevronLeft className="size-5" />
          </Link>
          <h2 className="truncate font-display text-lg font-semibold">{state.question}</h2>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
          <Link2 className="size-3" />
          {state.code}
        </span>
      </header>

      {!waiting && (
        <div className={`grid gap-2 pb-3 ${state.is_host && !revealed ? "grid-cols-2" : "grid-cols-1"}`}>
          {state.is_host && !revealed && <InviteFriends roomId={state.id} className="w-full" />}
          <ShareButton code={state.code} className="w-full" />
        </div>
      )}

      {waiting ? (
        <WaitingRoom state={state} userId={userId} accepting={accepting} onAccept={acceptInvite} />
      ) : revealed ? (
        <div className="flex-1 overflow-y-auto">
          <RevealCard result={state.result!} responses={state.responses ?? []} />
        </div>
      ) : (
        <ChatRoom state={state} onRefresh={refresh} />
      )}
    </main>
  );
}

function initials(member: RoomMember) {
  return (member.display_name || member.username).slice(0, 2).toUpperCase();
}

function statusTone(status: RoomMember["status"]) {
  if (status === "accepted") {
    return {
      label: "In",
      className: "bg-success-bg text-success",
      icon: CheckCircle2,
    };
  }

  if (status === "declined") {
    return {
      label: "Declined",
      className: "bg-destructive/10 text-destructive",
      icon: LockKeyhole,
    };
  }

  return {
    label: "Pending",
    className: "bg-primary/10 text-primary",
    icon: Clock3,
  };
}

function WaitingRoom({
  state,
  userId,
  accepting,
  onAccept,
}: {
  state: RoomState;
  userId: string;
  accepting: boolean;
  onAccept: () => void;
}) {
  const members = state.members ?? [];
  const acceptedCount = members.filter((member) => member.status === "accepted").length;
  const pendingCount = members.filter((member) => member.status === "pending").length;
  const total = members.length || state.participant_count;
  const host = members.find((member) => member.role === "host");
  const me = members.find((member) => member.id === userId);
  const isPendingInvite = state.invite_status === "pending" && !state.is_host;

  const title = isPendingInvite
    ? "You're invited"
    : state.is_host
      ? "Waiting for everyone"
      : "You're in";
  const subtitle = isPendingInvite
    ? `@${host?.username ?? "the host"} invited you to decide together.`
    : pendingCount > 0
      ? `${acceptedCount}/${total} accepted. Chat opens when everyone is in.`
      : "Everyone accepted. Opening the room...";

  return (
    <section className="relative flex min-h-0 flex-1 flex-col gap-4 overflow-hidden rounded-3xl border border-border/70 bg-card p-4 shadow-sm ring-1 ring-foreground/3">
      <div className="pointer-events-none absolute -right-16 -top-20 size-48 rounded-full border border-primary/20" />
      <div className="pointer-events-none absolute -right-8 -top-12 size-32 rounded-full border border-primary/30 animate-pulse" />

      <div className="relative flex items-start gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary shadow-inner">
          {isPendingInvite ? <BellRing className="size-5" /> : <Users className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Waiting room</p>
          <h3 className="font-display text-2xl font-semibold tracking-tight">{title}</h3>
          <p className="mt-1 text-[15px] leading-snug text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      {isPendingInvite && (
        <Button className="relative h-12 w-full rounded-2xl text-base glow-primary" disabled={accepting} onClick={onAccept}>
          {accepting ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          Accept invite
        </Button>
      )}

      {state.is_host && (
        <div className="relative grid grid-cols-2 gap-2">
          <InviteFriends roomId={state.id} className="h-11 w-full rounded-2xl" label="Add people" />
          <ShareButton code={state.code} className="h-11 w-full rounded-2xl" />
        </div>
      )}

      <div className="relative grid grid-cols-3 gap-2 rounded-2xl border border-border/60 bg-secondary/50 p-2">
        <div className="rounded-xl bg-card/80 px-3 py-2">
          <p className="text-lg font-semibold">{total}</p>
          <p className="text-xs text-muted-foreground">Invited</p>
        </div>
        <div className="rounded-xl bg-card/80 px-3 py-2">
          <p className="text-lg font-semibold text-success">{acceptedCount}</p>
          <p className="text-xs text-muted-foreground">Accepted</p>
        </div>
        <div className="rounded-xl bg-card/80 px-3 py-2">
          <p className="text-lg font-semibold text-primary">{pendingCount}</p>
          <p className="text-xs text-muted-foreground">Waiting</p>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 space-y-2 overflow-y-auto">
        {members.map((member) => {
          const tone = statusTone(member.status);
          const Icon = tone.icon;
          return (
            <div
              key={member.id}
              className={`flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/70 p-3 ${
                member.id === me?.id ? "ring-1 ring-primary/25" : ""
              }`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <Avatar className="size-9">
                  <AvatarFallback className="bg-linear-to-br from-primary to-[#9b7bff] text-xs font-semibold text-primary-foreground">
                    {initials(member)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 leading-tight">
                  <p className="truncate font-semibold">@{member.username}</p>
                  <p className="text-xs text-muted-foreground">
                    {member.role === "host" ? "Host" : member.is_current_user ? "You" : "Member"}
                  </p>
                </div>
              </div>
              <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${tone.className}`}>
                <Icon className="size-3.5" />
                {tone.label}
              </span>
            </div>
          );
        })}
      </div>

      {!isPendingInvite && (
        <div className="relative flex items-center justify-center gap-2 rounded-2xl bg-primary/10 px-3 py-2.5 text-sm font-semibold text-primary">
          <Sparkles className="size-4 animate-pulse" />
          {pendingCount > 0 ? "Holding the room before chat starts" : "Starting together"}
        </div>
      )}
    </section>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { PlaceOption, RoomMember, RoomState } from "@/lib/types";
import { ChatRoom } from "@/components/chat-room";
import { RevealCard } from "@/components/reveal-card";
import { ShareButton } from "@/components/share-button";
import { InviteFriends } from "@/components/invite-friends";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  BellRing,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  Link2,
  Loader2,
  LockKeyhole,
  MapPin,
  Sparkles,
  Star,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

export function RoomClient(
  { initial, userId }: { initial: RoomState; userId: string },
) {
  const [state, setState] = useState<RoomState>(initial);
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [voting, setVoting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data } = await supabase.rpc("get_room_state", {
      p_code: initial.code,
    });
    if (data) setState(data as unknown as RoomState);
  }, [supabase, initial.code]);

  useEffect(() => {
    const channel = supabase
      .channel(`room:${initial.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${initial.id}`,
        },
        () => refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_invites",
          filter: `room_id=eq.${initial.id}`,
        },
        () => refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_place_options",
          filter: `room_id=eq.${initial.id}`,
        },
        () => refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_place_votes",
          filter: `room_id=eq.${initial.id}`,
        },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, initial.id, refresh]);

  async function acceptInvite() {
    setAccepting(true);
    const { error } = await supabase.rpc("respond_room_invite", {
      p_room_id: state.id,
      p_accept: true,
    });
    setAccepting(false);
    if (error) return toast.error(error.message);
    toast.success("You're in");
    refresh();
  }

  async function declineInvite() {
    setDeclining(true);
    const { error } = await supabase.rpc("respond_room_invite", {
      p_room_id: state.id,
      p_accept: false,
    });
    setDeclining(false);
    if (error) return toast.error(error.message);
    toast.success("Invite declined");
    router.push("/");
  }

  async function vote(optionId: string) {
    setVoting(optionId);
    const { error } = await supabase.rpc("vote_place_option", {
      p_option_id: optionId,
    });
    setVoting(null);
    if (error) return toast.error(error.message);
    toast.success("Your pick is locked");
    refresh();
  }

  const revealed = state.status === "revealed" && state.result;
  const waiting = state.status === "waiting";
  const choosing = state.status === "choosing";

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
          <h2 className="truncate font-display text-lg font-semibold">
            {state.question}
          </h2>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
          <Link2 className="size-3" />
          {state.code}
        </span>
      </header>

      {!waiting && (
        <div className="pb-3">
          <ParticipantsDialog state={state} />
        </div>
      )}

      {waiting
        ? (
          <WaitingRoom
            state={state}
            userId={userId}
            accepting={accepting}
            declining={declining}
            onAccept={acceptInvite}
            onDecline={declineInvite}
          />
        )
        : choosing
        ? <PlaceVoting state={state} voting={voting} onVote={vote} />
        : revealed
        ? (
          <div className="flex-1 overflow-y-auto">
            <RevealCard
              result={state.result!}
              responses={state.responses ?? []}
            />
          </div>
        )
        : <ChatRoom state={state} onRefresh={refresh} />}
    </main>
  );
}

function PlaceVoting({
  state,
  voting,
  onVote,
}: {
  state: RoomState;
  voting: string | null;
  onVote: (optionId: string) => void;
}) {
  const options = state.place_options ?? [];
  const selected = state.my_place_vote;
  const locked = Boolean(selected);
  const directionCopy =
    state.result?.direction_copy ?? state.result?.consensus_copy ?? "Here's the shortlist everyone can say yes to.";

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-4">
      <div className="animate-fade-up rounded-3xl border border-primary/20 bg-card p-4 shadow-sm ring-1 ring-primary/10">
        <div className="mb-1 flex items-center gap-1 text-xs font-medium text-primary">
          <Sparkles className="size-3.5" /> Hunch
        </div>
        <h3 className="font-display text-2xl font-semibold leading-tight tracking-tight">
          {directionCopy}
        </h3>
        <p className="mt-1.5 text-[15px] leading-snug text-muted-foreground">
          Here are three spots that fit. Your vote is private until consensus lands.
        </p>
        <div className="mt-3 rounded-2xl bg-primary/10 px-3 py-2 text-sm font-semibold text-primary">
          {locked
            ? `${state.votes_cast} of ${state.participant_count} locked in. Waiting for the room.`
            : "Choose one — Hunch lands on the spot everyone can say yes to."}
        </div>
      </div>

      {options.length === 0
        ? (
          <div className="grid flex-1 place-items-center rounded-3xl border border-border bg-card p-6 text-center text-muted-foreground">
            <div>
              <Sparkles className="mx-auto mb-2 size-5 animate-pulse text-primary" />
              Hunch is setting the table...
            </div>
          </div>
        )
        : (
          <div className="flex flex-col gap-3">
            {options.map((option) => (
              <PlaceOptionCard
                key={option.id}
                option={option}
                selected={selected === option.id}
                dimmed={locked && selected !== option.id}
                disabled={voting !== null}
                loading={voting === option.id}
                onVote={() => onVote(option.id)}
              />
            ))}
          </div>
        )}
    </section>
  );
}

function PlaceOptionCard({
  option,
  selected,
  dimmed,
  disabled,
  loading,
  onVote,
}: {
  option: PlaceOption;
  selected: boolean;
  dimmed: boolean;
  disabled: boolean;
  loading: boolean;
  onVote: () => void;
}) {
  const venue = option.venue;

  return (
    <article
      className={`overflow-hidden rounded-3xl border bg-card shadow-sm ring-1 transition ${
        selected
          ? "border-primary/45 ring-primary/25 shadow-primary/10"
          : "border-border/70 ring-foreground/3"
      } ${dimmed ? "opacity-50 hover:opacity-100" : ""}`}
    >
      {venue.photo_url && (
        <Image
          src={venue.photo_url}
          alt={venue.name}
          width={640}
          height={300}
          unoptimized
          className="h-36 w-full object-cover"
        />
      )}
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Option {option.option_index}
            </p>
            <h4 className="mt-1 truncate font-display text-xl font-semibold">
              {venue.name}
            </h4>
            <p className="mt-1 text-sm text-muted-foreground">
              {option.cuisine}
            </p>
          </div>
          {selected && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
              <CheckCircle2 className="size-3.5" />
              Picked
            </span>
          )}
        </div>

        <p className="text-[15px] leading-snug text-muted-foreground">
          {option.rationale}
        </p>

        <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          {venue.walk_minutes != null && (
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1">
              <MapPin className="size-3.5" />
              {venue.walk_minutes} min
            </span>
          )}
          {venue.rating != null && (
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1">
              <Star className="size-3.5 fill-current" />
              {venue.rating}
            </span>
          )}
          {venue.price_level != null && (
            <span className="rounded-full bg-secondary px-2.5 py-1">
              {"$".repeat(venue.price_level)}
            </span>
          )}
        </div>

        <Button
          variant={dimmed ? "secondary" : "default"}
          className="h-11 w-full rounded-2xl glow-primary"
          disabled={disabled}
          onClick={onVote}
        >
          {loading
            ? <Loader2 className="size-4 animate-spin" />
            : selected
            ? <CheckCircle2 className="size-4" />
            : <Sparkles className="size-4" />}
          {selected ? "Your private pick" : dimmed ? "Switch to this" : "Pick this place"}
        </Button>
      </div>
    </article>
  );
}

function ParticipantsDialog({ state }: { state: RoomState }) {
  const members = state.members ?? [];
  const acceptedMembers = members.filter((member) =>
    member.status === "accepted"
  );
  const visibleMembers = acceptedMembers.length > 0 ? acceptedMembers : members;

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="secondary"
            className="h-11 w-full justify-between rounded-2xl px-3"
          />
        }
      >
        <span className="inline-flex items-center gap-2">
          <Users className="size-4 text-primary" />
          Participants
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="flex -space-x-2">
            {visibleMembers.slice(0, 3).map((member) => (
              <Avatar
                key={member.id}
                className="size-6 border-2 border-secondary"
              >
                <AvatarFallback className="bg-linear-to-br from-primary to-[#9b7bff] text-[10px] font-semibold text-primary-foreground">
                  {initials(member)}
                </AvatarFallback>
              </Avatar>
            ))}
          </span>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            {visibleMembers.length}
          </span>
        </span>
      </DialogTrigger>
      <DialogContent className="gap-3">
        <DialogHeader>
          <DialogTitle>Participants</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
          {visibleMembers.map((member) => {
            const tone = statusTone(member.status);
            const Icon = tone.icon;
            return (
              <div
                key={member.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card p-3"
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
                      {member.role === "host"
                        ? "Host"
                        : member.is_current_user
                        ? "You"
                        : "Participant"}
                    </p>
                  </div>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${tone.className}`}
                >
                  <Icon className="size-3.5" />
                  {member.role === "host" ? "Host" : tone.label}
                </span>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
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
  declining,
  onAccept,
  onDecline,
}: {
  state: RoomState;
  userId: string;
  accepting: boolean;
  declining: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const members = state.members ?? [];
  const acceptedCount =
    members.filter((member) => member.status === "accepted").length;
  const pendingCount =
    members.filter((member) => member.status === "pending").length;
  const declinedCount =
    members.filter((member) => member.status === "declined").length;
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
          {isPendingInvite
            ? <BellRing className="size-5" />
            : <Users className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Waiting room
          </p>
          <h3 className="font-display text-2xl font-semibold tracking-tight">
            {title}
          </h3>
          <p className="mt-1 text-[15px] leading-snug text-muted-foreground">
            {subtitle}
          </p>
        </div>
      </div>

      {isPendingInvite && (
        <div className="relative grid grid-cols-[1fr_auto] gap-2">
          <Button
            className="h-12 rounded-2xl text-base glow-primary"
            disabled={accepting || declining}
            onClick={onAccept}
          >
            {accepting
              ? <Loader2 className="size-4 animate-spin" />
              : <CheckCircle2 className="size-4" />}
            Accept invite
          </Button>
          <Button
            variant="destructive"
            size="icon"
            className="size-12 rounded-2xl"
            aria-label="Decline invite"
            disabled={accepting || declining}
            onClick={onDecline}
          >
            {declining
              ? <Loader2 className="size-4 animate-spin" />
              : <X className="size-4" />}
          </Button>
        </div>
      )}

      {state.is_host && (
        <div className="relative grid grid-cols-2 gap-2">
          <InviteFriends
            roomId={state.id}
            className="h-11 w-full rounded-2xl"
            label="Add people"
          />
          <ShareButton code={state.code} className="h-11 w-full rounded-2xl" />
        </div>
      )}

      <div className="relative grid grid-cols-2 gap-2 rounded-2xl border border-border/60 bg-secondary/50 p-2 sm:grid-cols-4">
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
        <div className="rounded-xl bg-card/80 px-3 py-2">
          <p className="text-lg font-semibold text-destructive">{declinedCount}</p>
          <p className="text-xs text-muted-foreground">Declined</p>
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
                    {member.role === "host"
                      ? "Host"
                      : member.is_current_user
                      ? "You"
                      : "Member"}
                  </p>
                </div>
              </div>
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${tone.className}`}
              >
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
          {pendingCount > 0
            ? "Holding the room before chat starts"
            : "Starting together"}
        </div>
      )}
    </section>
  );
}

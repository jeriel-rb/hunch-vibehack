"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { RoomState } from "@/lib/types";
import { ChatRoom } from "@/components/chat-room";
import { RevealCard } from "@/components/reveal-card";
import { ShareButton } from "@/components/share-button";
import { InviteFriends } from "@/components/invite-friends";
import { ChevronLeft, Link2 } from "lucide-react";

export function RoomClient({ initial, userId }: { initial: RoomState; userId: string }) {
  const [state, setState] = useState<RoomState>(initial);
  const [supabase] = useState(() => createClient());

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
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, initial.id, refresh]);

  const revealed = state.status === "revealed" && state.result;

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

      <div className={`grid gap-2 pb-3 ${state.is_host && !revealed ? "grid-cols-2" : "grid-cols-1"}`}>
        {state.is_host && !revealed && <InviteFriends roomId={state.id} className="w-full" />}
        <ShareButton code={state.code} className="w-full" />
      </div>

      {revealed ? (
        <div className="flex-1 overflow-y-auto">
          <RevealCard result={state.result!} responses={state.responses ?? []} />
        </div>
      ) : (
        <ChatRoom state={state} onRefresh={refresh} />
      )}
    </main>
  );
}

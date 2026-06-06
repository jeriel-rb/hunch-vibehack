"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { UserPlus, Check } from "lucide-react";
import { toast } from "sonner";
import type { FriendUser, SocialData } from "@/lib/types";

export function InviteFriends({ roomId }: { roomId: string }) {
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState<FriendUser[] | null>(null);
  const [invited, setInvited] = useState<Set<string>>(new Set());

  async function load() {
    const supabase = createClient();
    const { data } = await supabase.rpc("get_social");
    const s = data as unknown as SocialData | null;
    setFriends(s?.friends ?? []);
  }

  async function invite(u: FriendUser) {
    const supabase = createClient();
    const { error } = await supabase.rpc("invite_to_room", { p_room_id: roomId, p_friend: u.id });
    if (error) return toast.error(error.message);
    setInvited((prev) => new Set(prev).add(u.id));
    toast.success(`Invited @${u.username}`);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && friends === null) load();
      }}
    >
      <DialogTrigger render={<Button variant="secondary" size="sm" />}>
        <UserPlus className="size-4" />
        Invite
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite friends</DialogTitle>
        </DialogHeader>
        {friends === null ? (
          <p className="text-[15px] text-muted-foreground">Loading…</p>
        ) : friends.length === 0 ? (
          <p className="text-[15px] text-muted-foreground">
            No friends yet.{" "}
            <Link className="text-primary" href="/friends">
              Add some →
            </Link>
          </p>
        ) : (
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {friends.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card p-2.5">
                <div className="flex items-center gap-2.5">
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-linear-to-br from-primary to-[#9b7bff] text-xs font-semibold text-primary-foreground">
                      {(u.display_name || u.username).slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="font-medium">@{u.username}</span>
                </div>
                {invited.has(u.id) ? (
                  <span className="inline-flex items-center gap-1 text-sm text-success">
                    <Check className="size-4" /> Invited
                  </span>
                ) : (
                  <Button size="sm" onClick={() => invite(u)}>
                    Invite
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

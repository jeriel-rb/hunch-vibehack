"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ChevronLeft, Copy, Check, UserPlus } from "lucide-react";
import { toast } from "sonner";
import type { FriendUser, SocialData } from "@/lib/types";

function initials(u: FriendUser) {
  return (u.display_name || u.username).slice(0, 2).toUpperCase();
}

function Row({ user, right }: { user: FriendUser; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card p-3 shadow-sm ring-1 ring-foreground/3">
      <div className="flex items-center gap-3">
        <Avatar className="size-9">
          <AvatarFallback className="bg-linear-to-br from-primary to-[#9b7bff] text-xs font-semibold text-primary-foreground">
            {initials(user)}
          </AvatarFallback>
        </Avatar>
        <div className="leading-tight">
          <p className="font-medium">@{user.username}</p>
          {user.display_name && user.display_name !== user.username && (
            <p className="text-sm text-muted-foreground">{user.display_name}</p>
          )}
        </div>
      </div>
      {right}
    </div>
  );
}

export function FriendsClient({ initial, username }: { initial: SocialData; username: string }) {
  const [social, setSocial] = useState<SocialData>(initial);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FriendUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [copied, setCopied] = useState(false);
  const [supabase] = useState(() => createClient());

  const refresh = useCallback(async () => {
    const { data } = await supabase.rpc("get_social");
    if (data) setSocial(data as unknown as SocialData);
  }, [supabase]);

  useEffect(() => {
    const channel = supabase
      .channel("friends")
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, () => refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, refresh]);

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    const { data } = await supabase.rpc("search_users", { p_query: query.trim() });
    setSearching(false);
    setResults((data as unknown as FriendUser[]) ?? []);
  }

  async function addFriend(u: FriendUser) {
    const { error } = await supabase.rpc("send_friend_request", { p_username: u.username });
    if (error) return toast.error(error.message);
    toast.success(`Request sent to @${u.username}`);
    setResults((rs) => rs.map((r) => (r.id === u.id ? { ...r, status: "pending", requested_by: "me" } : r)));
    refresh();
  }

  async function respond(u: FriendUser, accept: boolean) {
    const { error } = await supabase.rpc("respond_friend_request", { p_other: u.id, p_accept: accept });
    if (error) return toast.error(error.message);
    toast.success(accept ? `You and @${u.username} are now friends` : "Declined");
    refresh();
  }

  async function copyLink() {
    const url = `${location.origin}/add-friend/${username}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Add-me link copied");
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main className="stagger mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-6">
      <header className="flex items-center gap-2">
        <Link
          href="/"
          aria-label="Back"
          className="grid size-9 place-items-center rounded-full bg-card text-muted-foreground ring-1 ring-border transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="font-display text-xl font-semibold">Friends</h1>
      </header>

      {/* Your add-me code/link */}
      <section className="flex flex-col gap-2 rounded-3xl border border-border/60 bg-card p-4 shadow-sm ring-1 ring-foreground/3">
        <p className="text-[15px] text-muted-foreground">Your friend code</p>
        <div className="flex items-center justify-between">
          <span className="text-lg font-semibold text-primary">@{username}</span>
          <Button variant="secondary" size="sm" onClick={copyLink}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            Copy add-me link
          </Button>
        </div>
      </section>

      {/* Search */}
      <section className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Input
            placeholder="Search by username"
            autoCapitalize="none"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
          />
          <Button className="h-12 shrink-0 rounded-xl" onClick={search} disabled={searching || !query.trim()}>
            Search
          </Button>
        </div>
        {results.length > 0 && (
          <div className="flex flex-col gap-2">
            {results.map((u) => (
              <Row
                key={u.id}
                user={u}
                right={
                  u.status === "accepted" ? (
                    <span className="text-[15px] text-muted-foreground">Friends</span>
                  ) : u.status === "pending" ? (
                    <span className="text-[15px] text-muted-foreground">Pending</span>
                  ) : (
                    <Button size="sm" onClick={() => addFriend(u)}>
                      <UserPlus className="size-4" /> Add
                    </Button>
                  )
                }
              />
            ))}
          </div>
        )}
      </section>

      {/* Incoming requests */}
      {social.incoming.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-lg font-semibold">Requests</h2>
          {social.incoming.map((u) => (
            <Row
              key={u.id}
              user={u}
              right={
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => respond(u, true)}>Accept</Button>
                  <Button size="sm" variant="secondary" onClick={() => respond(u, false)}>Decline</Button>
                </div>
              }
            />
          ))}
        </section>
      )}

      {/* Friends list */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Your friends</h2>
        {social.friends.length === 0 ? (
          <p className="text-[15px] text-muted-foreground">No friends yet — search above or share your add-me link.</p>
        ) : (
          social.friends.map((u) => <Row key={u.id} user={u} />)
        )}
      </section>
    </main>
  );
}

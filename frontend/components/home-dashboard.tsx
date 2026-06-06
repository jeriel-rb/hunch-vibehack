"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CategoryGrid } from "@/components/category-grid";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Users, LogOut } from "lucide-react";
import { getCategory } from "@/lib/categories";
import type { HomeData } from "@/lib/types";

export function HomeDashboard({ initial }: { initial: HomeData }) {
  const router = useRouter();
  const [home, setHome] = useState<HomeData>(initial);
  const [supabase] = useState(() => createClient());

  const refresh = useCallback(async () => {
    const { data } = await supabase.rpc("get_home");
    if (data) setHome(data as unknown as HomeData);
  }, [supabase]);

  useEffect(() => {
    // RLS scopes realtime delivery to this user's own rows.
    const channel = supabase
      .channel("home")
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "room_invites" }, () => refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, refresh]);

  async function signOut() {
    await supabase.auth.signOut();
    router.refresh();
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
            <p className="text-[15px] text-muted-foreground">Hey @{home.profile.username}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" className="relative rounded-full" onClick={() => router.push("/friends")}>
            <Users className="size-4" />
            Friends
            {home.incoming_requests > 0 && (
              <Badge className="absolute -right-1.5 -top-1.5 size-5 justify-center rounded-full bg-accent p-0 text-accent-foreground">
                {home.incoming_requests}
              </Badge>
            )}
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full" aria-label="Sign out" onClick={signOut}>
            <LogOut className="size-4" />
          </Button>
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold">What are we deciding?</h2>
        <CategoryGrid isPro={home.profile.is_pro} />
      </section>

      {home.invites.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-lg font-semibold">Invited by friends</h2>
          {home.invites.map((inv) => {
            const cat = getCategory(inv.category);
            return (
              <button
                key={inv.code}
                onClick={() => router.push(`/room/${inv.code}`)}
                className="lift flex items-center justify-between gap-3 rounded-3xl border border-border/60 bg-card p-4 text-left shadow-sm ring-1 ring-foreground/3 hover:shadow-md"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{inv.question}</span>
                  <span className="block text-sm text-muted-foreground">
                    @{inv.inviter} · {cat?.label ?? inv.category}
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">
                  Join →
                </span>
              </button>
            );
          })}
        </section>
      )}
    </main>
  );
}

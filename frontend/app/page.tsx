import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { HomeDashboard } from "@/components/home-dashboard";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";
import { HunchLogo } from "@/components/hunch-logo";
import type { HomeData } from "@/lib/types";

export default async function Home() {
  let user = null;
  try {
    const supabase = await createClient();
    ({
      data: { user },
    } = await supabase.auth.getUser());

    if (user) {
      const { data } = await supabase.rpc("get_home");
      if (data) return <HomeDashboard initial={data as unknown as HomeData} />;
    }
  } catch {
    // Supabase not configured yet — fall through to the landing.
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-7 p-6">
      <div className="stagger flex flex-col gap-6">
        <HunchLogo className="size-16 drop-shadow-[0_10px_22px_rgba(124,92,255,0.35)]" />

        <header>
          <h1 className="font-display text-6xl font-semibold tracking-tight">
            Hunch<span className="text-primary">.</span>
          </h1>
          <p className="mt-3 text-lg text-muted-foreground">
            Everyone already agrees. Hunch just finds it.
          </p>
        </header>

        <p className="text-muted-foreground">
          AI group decisions, minus the social pressure. Everyone answers privately — Hunch finds the
          option you already agree on.
        </p>

        <Button className="h-12 text-base glow-primary" render={<Link href="/login" />}>
          Get started
        </Button>

        <p className="inline-flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
          <ShieldCheck className="size-3.5 text-success" />
          Private by design — nobody sees your answer before the reveal.
        </p>
      </div>
    </main>
  );
}

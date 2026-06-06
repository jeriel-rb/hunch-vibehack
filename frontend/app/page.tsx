import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { HomeDashboard } from "@/components/home-dashboard";
import { Button } from "@/components/ui/button";
import { ArrowRight, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { HunchLogo } from "@/components/hunch-logo";
import type { HomeData } from "@/lib/types";

export default async function Home() {
  let user = null;
  let homeData: HomeData | null = null;

  try {
    const supabase = await createClient();
    ({
      data: { user },
    } = await supabase.auth.getUser());

    if (user) {
      const { data } = await supabase.rpc("get_home");
      if (data) homeData = data as unknown as HomeData;
    }
  } catch {
    // Supabase not configured yet — fall through to the landing.
  }

  if (homeData) return <HomeDashboard initial={homeData} />;

  return (
    <main className="relative isolate flex min-h-dvh overflow-hidden p-6">
      <div className="landing-atmosphere" aria-hidden="true">
        <span className="ambient-grid" />
        <span className="ambient-sweep" />
        <span className="ambient-ring ambient-ring-a" />
        <span className="ambient-ring ambient-ring-b" />
        <span className="ambient-thread ambient-thread-a" />
        <span className="ambient-thread ambient-thread-b" />
      </div>

      <section className="stagger relative z-10 mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-md flex-col justify-center gap-7">
        <div className="flex items-center justify-between">
          <HunchLogo className="size-16 drop-shadow-[0_12px_26px_rgba(124,92,255,0.45)]" />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary shadow-sm shadow-primary/10">
            <Sparkles className="size-3.5" />
            Live room
          </span>
        </div>

        <header className="flex flex-col gap-3">
          <h1 className="font-display text-6xl font-semibold tracking-tight">
            Hunch<span className="text-primary">.</span>
          </h1>
          <p className="max-w-[18rem] text-xl leading-tight text-muted-foreground">
            Everyone already agrees. Hunch just finds it.
          </p>
        </header>

        <p className="max-w-sm text-[17px] leading-7 text-muted-foreground">
          Start a private room, pass the link around, and let the group answer without pressure.
          Hunch turns the hidden overlap into a real pick.
        </p>

        <div className="flex flex-col gap-3">
          <Button className="h-12 text-base glow-primary" render={<Link href="/login?next=/create/eat" />}>
            Start a room
            <ArrowRight className="size-4" />
          </Button>
          <Button variant="secondary" className="h-12 text-base" render={<Link href="/login" />}>
            Log in
          </Button>
        </div>

        <div className="privacy-badge">
          <span className="privacy-icon">
            <LockKeyhole className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">Private until reveal</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[13px] leading-snug text-muted-foreground">
              <ShieldCheck className="size-3.5 text-success" />
              Nobody sees your answer while the room is deciding.
            </span>
          </span>
        </div>
      </section>
    </main>
  );
}

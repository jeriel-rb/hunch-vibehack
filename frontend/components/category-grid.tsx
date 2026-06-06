"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES } from "@/lib/categories";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Lock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function CategoryGrid({ isPro, hasCredits }: { isPro: boolean; hasCredits: boolean }) {
  const router = useRouter();
  const [proOpen, setProOpen] = useState(false);

  function pick(key: string, proLocked: boolean, creditLocked: boolean) {
    if (creditLocked) {
      toast.error("You're out of credits");
      return;
    }

    if (proLocked) {
      setProOpen(true);
      return;
    }
    router.push(`/create/${key}`);
  }

  return (
    <>
      <div className="stagger grid grid-cols-2 gap-3">
        {CATEGORIES.map((c) => {
          const proLocked = c.pro && !isPro;
          const creditLocked = !hasCredits;
          const locked = proLocked || creditLocked;
          const Icon = c.icon;
          return (
            <button
              key={c.key}
              onClick={() => pick(c.key, proLocked, creditLocked)}
              className="lift group relative flex flex-col items-start overflow-hidden rounded-3xl border border-border/60 bg-card p-4 text-left shadow-sm ring-1 ring-foreground/3 hover:shadow-md"
            >
              {locked && (
                <span className="absolute right-2.5 top-2.5 z-10 inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-semibold text-primary ring-1 ring-primary/20">
                  <Lock className="size-3" />
                  {creditLocked ? "0 credits" : "Pro"}
                </span>
              )}
              <span
                className={cn(
                  "flex flex-col items-start gap-2.5 transition-all duration-300",
                  locked && "opacity-55 saturate-50",
                )}
              >
                <span
                  className={cn(
                    "grid size-11 place-items-center rounded-2xl ring-1 transition-transform duration-300 group-hover:scale-105",
                    locked
                      ? "bg-muted text-muted-foreground ring-border"
                      : "bg-linear-to-br from-primary/20 to-primary/5 text-primary ring-primary/15",
                  )}
                >
                  <Icon className="size-5" />
                </span>
                <span className="font-semibold leading-tight">{c.label}</span>
                <span className="text-sm text-muted-foreground">{c.sub}</span>
              </span>
            </button>
          );
        })}
      </div>

      <Dialog open={proOpen} onOpenChange={setProOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <span className="mb-1 grid size-12 place-items-center rounded-2xl bg-linear-to-br from-primary to-[#9b7bff] text-primary-foreground shadow-md glow-primary">
              <Sparkles className="size-6" />
            </span>
            <DialogTitle className="text-lg">Unlock with Hunch Pro</DialogTitle>
            <DialogDescription>
              Travel plans, movie nights, and any group call — coming soon. For now, “Where to eat”
              is free for everyone.
            </DialogDescription>
          </DialogHeader>
          <Button
            className="h-12 text-base glow-primary"
            onClick={() => {
              setProOpen(false);
              toast("We’ll let you know when Pro is live ✨");
            }}
          >
            Notify me
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

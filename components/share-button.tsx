"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Share2 } from "lucide-react";
import { toast } from "sonner";

export function ShareButton({
  code,
  className,
  label = "Share link",
}: {
  code: string;
  className?: string;
  label?: string;
}) {
  async function share() {
    const url = `${location.origin}/room/${code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Hunch", text: "Help us decide on Hunch", url });
        return;
      } catch {
        // user cancelled the share sheet — fall through to copy
      }
    }
    await navigator.clipboard.writeText(url);
    toast.success("Link copied");
  }

  return (
    <Button variant="secondary" size="sm" className={cn("h-11 rounded-2xl", className)} onClick={share}>
      <Share2 className="size-4" />
      {label}
    </Button>
  );
}

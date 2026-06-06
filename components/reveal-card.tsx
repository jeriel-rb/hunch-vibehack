import Image from "next/image";
import { Check, MapPin, Sparkles, Star, Trophy } from "lucide-react";
import type { RevealResult, ResponseAnswers } from "@/lib/types";

export function RevealCard({
  result,
}: {
  result: RevealResult;
  responses: { label: string; answers: ResponseAnswers }[];
}) {
  const v = result.venue;

  return (
    <div className="flex flex-col gap-4 pb-6">
      <div className="animate-pop relative overflow-hidden rounded-3xl border border-success/40 bg-card p-5 shadow-lg shadow-success/10 ring-1 ring-success/10">
        <div className="pointer-events-none absolute -right-8 -top-10 size-28 rounded-full border border-success/25 animate-pulse" />
        <div className="pointer-events-none absolute right-10 top-8 text-primary/25">
          <Sparkles className="size-8 animate-pulse" />
        </div>

        <p className="inline-flex items-center gap-1.5 rounded-full bg-success-bg px-3 py-1 text-xs font-semibold uppercase tracking-wide text-success">
          <Trophy className="size-3.5" />
          {result.success_title ?? "Consensus unlocked"}
        </p>
        <h3 className="mt-1 font-display text-3xl font-semibold leading-tight">
          {v?.name ?? result.cuisine}
        </h3>
        <p className="mt-1 text-[15px] leading-snug text-muted-foreground">
          {result.success_copy ?? result.consensus_copy ?? "Everyone found the yes. The group chat may now rest."}
        </p>

        {v ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
            {v.walk_minutes != null && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" />
                {v.walk_minutes} min away
              </span>
            )}
            {v.rating != null && (
              <span className="inline-flex items-center gap-1">
                <Star className="size-3.5 fill-current" />
                {v.rating}
              </span>
            )}
            {v.price_level != null && <span>{"$".repeat(v.price_level)}</span>}
          </p>
        ) : (
          <p className="mt-1 text-muted-foreground">{result.summary}</p>
        )}

        {v?.photo_url && (
          <Image
            src={v.photo_url}
            alt={v.name}
            width={600}
            height={320}
            unoptimized
            className="mt-3 h-40 w-full rounded-2xl object-cover"
          />
        )}

        <ul className="stagger mt-4 flex flex-col gap-2">
          {result.reasons.map((r) => (
            <li key={r} className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-success" />
              <span>{r}</span>
            </li>
          ))}
        </ul>

        {v?.maps_url && (
          <a
            href={v.maps_url}
            target="_blank"
            rel="noreferrer"
            className="lift glow-primary mt-4 block rounded-full bg-primary py-3 text-center font-medium text-primary-foreground"
          >
            Open in Maps
          </a>
        )}

        <p className="mt-4 text-[15px] italic text-muted-foreground">Hunch found the overlap. Nobody had to campaign for it.</p>
      </div>

      {result.options && result.options.length > 1 && (
        <div className="rounded-3xl border border-border bg-card p-4">
          <h4 className="font-display text-lg font-semibold">The three contenders</h4>
          <div className="mt-3 flex flex-col gap-2">
            {result.options.map((option) => (
              <div
                key={option.id}
                className={`flex items-center justify-between gap-3 rounded-2xl border p-3 ${
                  option.id === result.selected_option_id ? "border-primary/40 bg-primary/10" : "border-border/60 bg-background/70"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{option.venue.name}</span>
                  <span className="block truncate text-sm text-muted-foreground">{option.cuisine}</span>
                </span>
                {option.id === result.selected_option_id && (
                  <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
                    Winner
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

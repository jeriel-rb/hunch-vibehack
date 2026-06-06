import Image from "next/image";
import { Check, MapPin, Star } from "lucide-react";
import type { RevealResult, ResponseAnswers } from "@/lib/types";

function summarize(a: ResponseAnswers): string {
  const parts: string[] = [];
  if (a.budget) parts.push(a.budget);
  if (a.style && a.style !== "anything") parts.push(a.style);
  if (a.avoid && a.avoid !== "nothing") parts.push(`no ${a.avoid}`);
  if (a.freestyle) parts.push(`"${a.freestyle}"`);
  (a.followups ?? []).filter(Boolean).forEach((f) => parts.push(`"${f}"`));
  return parts.join(" · ") || "no strong preference";
}

export function RevealCard({
  result,
  responses,
}: {
  result: RevealResult;
  responses: { label: string; answers: ResponseAnswers }[];
}) {
  const v = result.venue;

  return (
    <div className="flex flex-col gap-4 pb-6">
      <div className="animate-pop rounded-3xl border border-success/40 bg-card p-5 shadow-lg shadow-success/10 ring-1 ring-success/10">
        <p className="text-xs font-semibold uppercase tracking-wide text-success">The pick</p>
        <h3 className="mt-1 font-display text-3xl font-semibold leading-tight">
          {v?.name ?? result.cuisine}
        </h3>

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

        <p className="mt-4 text-[15px] italic text-muted-foreground">…and nobody had to say it first.</p>
      </div>

      {responses.length > 0 && (
        <details className="rounded-3xl border border-border bg-card p-4">
          <summary className="cursor-pointer text-[15px] text-muted-foreground">
            What everyone said (now revealed)
          </summary>
          <ul className="mt-3 flex flex-col gap-2">
            {responses.map((r) => (
              <li key={r.label} className="text-[15px]">
                <span className="font-semibold text-primary">{r.label}.</span> {summarize(r.answers)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

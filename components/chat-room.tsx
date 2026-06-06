"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, Send, Check } from "lucide-react";
import { toast } from "sonner";
import { EAT_ROUNDS, type ScriptedRound } from "@/lib/rounds";
import type { RoomState, ResponseAnswers } from "@/lib/types";

const VALUE_LABELS: Record<string, string> = {
  anything: "Surprise me",
  nothing: "Nothing, I'm open",
};
const labelFor = (v?: string) => (v ? VALUE_LABELS[v] ?? v : "");

interface Bubble {
  from: "ai" | "me";
  text: string;
}

export function ChatRoom({ state, onRefresh }: { state: RoomState; onRefresh: () => void }) {
  const stateKey = `${state.id}:${state.round}:${state.my_round}`;
  const [draft, setDraft] = useState<{ key: string; answers: ResponseAnswers }>(() => ({
    key: stateKey,
    answers: state.my_answers ?? {},
  }));
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const answers = draft.key === stateKey ? draft.answers : state.my_answers ?? {};

  const caughtUp = state.my_round >= state.round;
  const inRound0 = state.round === 0 && state.my_round < 0;
  const activeRound0: ScriptedRound | undefined = inRound0
    ? EAT_ROUNDS.find((r) => answers[r.key] === undefined)
    : undefined;
  const activeFollowup = !caughtUp && state.round > 0 ? state.followups[state.round - 1] : undefined;

  // Build the visible conversation from answers + the room's follow-ups.
  const history: Bubble[] = [
    { from: "ai", text: "Hey! Let's find the spot. A few quick taps — only I can see your answers." },
  ];
  for (const r of EAT_ROUNDS) {
    const v = answers[r.key];
    if (v === undefined) break;
    history.push({ from: "ai", text: r.prompt });
    history.push({ from: "me", text: labelFor(v) || "(skipped)" });
  }
  (answers.followups ?? []).forEach((ans, k) => {
    if (state.followups[k]) history.push({ from: "ai", text: state.followups[k] });
    history.push({ from: "me", text: ans || "(skipped)" });
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history.length, state.status]);

  async function save(finalAnswers: ResponseAnswers) {
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("submit_response", {
      p_room_id: state.id,
      p_answers: finalAnswers,
      p_ready: true,
    });
    setSaving(false);
    setText("");
    if (error) return toast.error(error.message);
    onRefresh();
  }

  function pickRound0(round: ScriptedRound, value: string) {
    const updated = { ...answers, [round.key]: value };
    setDraft({ key: stateKey, answers: updated });
    // Freestyle is the last step → submit the whole set.
    if (round.key === "freestyle" || EAT_ROUNDS.indexOf(round) === EAT_ROUNDS.length - 1) {
      save(updated);
    }
  }

  function sendFollowup() {
    const fu = [...(answers.followups ?? [])];
    fu[state.round - 1] = text.trim();
    save({ followups: fu });
  }

  async function reveal() {
    setRevealing(true);
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/reveal-decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ room_id: state.id }),
    });
    setRevealing(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(data.error ?? "Reveal failed — try again");
    if (data.consensus === false) toast("Still split — one more question for everyone");
    onRefresh();
  }

  const total = state.participant_count;
  const ready = state.answered_count;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Conversation */}
      <div className="flex-1 space-y-3 overflow-y-auto pb-4">
        {history.map((b, i) =>
          b.from === "ai" ? (
            <div key={i} className="animate-fade-up max-w-[85%]">
              <div className="mb-1 flex items-center gap-1 text-xs font-medium text-primary">
                <Sparkles className="size-3" /> Hunch
              </div>
              <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-2.5 text-base leading-snug shadow-sm ring-1 ring-foreground/3">
                {b.text}
              </div>
            </div>
          ) : (
            <div key={i} className="animate-fade-up ml-auto max-w-[85%]">
              <div className="rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-base leading-snug text-primary-foreground shadow-sm shadow-primary/25">
                {b.text}
              </div>
            </div>
          ),
        )}

        {/* Active question's quick-reply chips */}
        {activeRound0 && (
          <div className="animate-fade-up max-w-[85%]">
            <div className="mb-1 flex items-center gap-1 text-xs font-medium text-primary">
              <Sparkles className="size-3" /> Hunch
            </div>
            <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-2.5 text-base leading-snug shadow-sm ring-1 ring-foreground/3">
              {activeRound0.prompt}
            </div>
            {activeRound0.chips && (
              <div className="mt-2 flex flex-wrap gap-2">
                {activeRound0.chips.map((c, ci) => (
                  <button
                    key={c.value}
                    onClick={() => pickRound0(activeRound0, c.value)}
                    disabled={saving}
                    style={{ animationDelay: `${0.05 + ci * 0.05}s` }}
                    className="animate-chip rounded-full border border-border bg-card px-4 py-2.5 text-base font-medium shadow-sm transition active:scale-95 hover:border-primary hover:text-primary hover:shadow-md"
                  >
                    {c.emoji ? `${c.emoji} ` : ""}
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {caughtUp && state.status !== "revealing" && (
          <div className="max-w-[85%]">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-success-bg px-3 py-1.5 text-sm font-medium text-success">
              <Check className="size-4" /> Locked in — {ready} of {total} ready
            </div>
          </div>
        )}

        {state.status === "revealing" && (
          <div className="flex animate-pulse items-center gap-1.5 text-sm font-medium text-primary">
            <Sparkles className="size-4" /> Hunch is finding the yes…
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Active input (freestyle round-0 step or a follow-up) */}
      {(activeRound0?.freeText || activeFollowup) && (
        <div className="flex items-center gap-2 border-t border-border pt-3">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={activeFollowup ? "Your answer…" : "Type if you like…"}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !text.trim()) return;
              if (activeFollowup) sendFollowup();
              else if (activeRound0) pickRound0(activeRound0, text.trim());
            }}
          />
          {activeRound0?.optional && !text.trim() ? (
            <Button variant="secondary" className="h-12 shrink-0 rounded-xl" disabled={saving} onClick={() => pickRound0(activeRound0!, "")}>
              Skip
            </Button>
          ) : (
            <Button
              size="icon"
              className="size-12 shrink-0 rounded-xl glow-primary"
              disabled={saving || !text.trim()}
              onClick={() => (activeFollowup ? sendFollowup() : pickRound0(activeRound0!, text.trim()))}
            >
              <Send className="size-4" />
            </Button>
          )}
        </div>
      )}

      {/* Host reveal control */}
      {state.is_host && state.status !== "revealing" && (
        <div className="border-t border-border pt-3">
          <Button className="h-12 w-full rounded-full text-base glow-primary" disabled={revealing || ready === 0} onClick={reveal}>
            <Sparkles className="size-4" />
            {revealing ? "Finding…" : `Find the yes (${ready}/${total})`}
          </Button>
        </div>
      )}
      {!state.is_host && caughtUp && (
        <p className="border-t border-border pt-3 text-center text-[15px] text-muted-foreground">
          Waiting for the host to reveal…
        </p>
      )}
    </div>
  );
}

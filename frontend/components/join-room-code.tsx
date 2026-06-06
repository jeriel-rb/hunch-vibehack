"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Hash, LogIn } from "lucide-react";
import { toast } from "sonner";

function normalizeCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

export function JoinRoomCode() {
  const router = useRouter();
  const [code, setCode] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const roomCode = normalizeCode(code);
    if (roomCode.length !== 6) {
      toast.error("Enter the 6-character room code");
      return;
    }
    router.push(`/room/${roomCode}`);
  }

  return (
    <form
      onSubmit={submit}
      className="flex items-center gap-2 rounded-3xl border border-border/60 bg-card p-2.5 shadow-sm ring-1 ring-foreground/3"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
        <Hash className="size-4" />
      </span>
      <Input
        aria-label="Room code"
        className="h-10 border-0 bg-transparent px-1 text-center font-display text-lg font-semibold tracking-[0.22em] shadow-none focus-visible:ring-0"
        inputMode="text"
        maxLength={6}
        placeholder="CODE"
        value={code}
        onChange={(event) => setCode(normalizeCode(event.target.value))}
      />
      <Button type="submit" size="icon" className="size-10 shrink-0 rounded-2xl glow-primary" aria-label="Join room">
        <LogIn className="size-4" />
      </Button>
    </form>
  );
}

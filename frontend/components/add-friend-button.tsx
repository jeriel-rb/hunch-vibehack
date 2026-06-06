"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";

export function AddFriendButton({ username, self }: { username: string; self: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (self) {
    return <p className="text-sm text-muted-foreground">This is your own add-me link.</p>;
  }

  async function add() {
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("send_friend_request", { p_username: username });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success(`Friend request sent to @${username}`);
    router.push("/friends");
  }

  return (
    <Button className="h-12 w-full text-base glow-primary" onClick={add} disabled={loading}>
      <UserPlus className="size-4" />
      {loading ? "Sending…" : `Add @${username}`}
    </Button>
  );
}

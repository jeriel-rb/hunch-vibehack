import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RoomClient } from "./room-client";
import type { RoomState } from "@/lib/types";

export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/room/${code}`);

  // Idempotent join, then load the full state for this caller.
  await supabase.rpc("join_room", { p_code: code });
  const { data, error } = await supabase.rpc("get_room_state", { p_code: code });
  if (error || !data) redirect("/");

  return <RoomClient initial={data as unknown as RoomState} userId={user.id} />;
}

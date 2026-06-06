import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FriendsClient } from "@/components/friends-client";
import type { SocialData } from "@/lib/types";

export default async function FriendsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/friends");

  const [{ data: social }, { data: profile }] = await Promise.all([
    supabase.rpc("get_social"),
    supabase.from("profiles").select("username").eq("id", user.id).single(),
  ]);

  return (
    <FriendsClient
      initial={(social as unknown as SocialData) ?? { friends: [], incoming: [], outgoing: [] }}
      username={profile?.username ?? ""}
    />
  );
}

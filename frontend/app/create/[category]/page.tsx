import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CreateRoom } from "@/components/create-room";
import { getCategory } from "@/lib/categories";
import { ChevronLeft } from "lucide-react";

export default async function CreatePage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const meta = getCategory(category);
  if (!meta) redirect("/");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/create/${category}`);

  const { data: profile } = await supabase.from("profiles").select("is_pro, credits").eq("id", user.id).single();
  if (!profile || profile.credits <= 0) redirect("/");

  // Pro gate: locked categories require is_pro.
  if (meta.pro && !profile.is_pro) redirect("/");

  return (
    <main className="stagger mx-auto flex min-h-dvh max-w-md flex-col gap-5 p-6">
      <header className="flex items-center gap-2">
        <Link
          href="/"
          aria-label="Back"
          className="grid size-9 place-items-center rounded-full bg-card text-muted-foreground ring-1 ring-border transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="font-display text-xl font-semibold">{meta.label}</h1>
      </header>
      <CreateRoom category={meta.key} defaultQuestion={meta.defaultQuestion} needsLocation={meta.key === "eat"} />
      <p className="text-center text-[15px] text-muted-foreground">
        Share the room, everyone answers privately, Hunch finds the yes.
      </p>
    </main>
  );
}

"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MailCheck } from "lucide-react";
import { HunchLogo } from "@/components/hunch-logo";
import { toast } from "sonner";

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const DEMO_PASSWORD = "123456";
const DEMO_ACCOUNTS = ["user1@xmail.com", "user2@xmail.com", "user3@xmail.com"];

function AuthInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  async function signUp() {
    const handle = username.trim().toLowerCase();
    if (!USERNAME_RE.test(handle)) {
      return toast.error("Username: 3–20 chars, a–z, 0–9, _");
    }
    if (password.length < 6) return toast.error("Password must be at least 6 characters");

    setLoading(true);
    const supabase = createClient();
    const emailRedirectTo = `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

    const { data: available } = await supabase.rpc("username_available", { p_username: handle });
    if (available === false) {
      setLoading(false);
      return toast.error("That username is taken");
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username: handle, display_name: handle }, emailRedirectTo },
    });
    setLoading(false);

    if (error) return toast.error(error.message);
    if (data.session) router.push(next); // email confirmation disabled
    else setCheckEmail(true); // confirmation required
  }

  async function logIn() {
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    router.push(next);
  }

  if (checkEmail) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
        <div className="stagger flex flex-col items-center gap-5 text-center">
          <span className="grid size-16 place-items-center rounded-[1.4rem] bg-linear-to-br from-primary to-[#9b7bff] text-primary-foreground shadow-lg glow-primary">
            <MailCheck className="size-8" />
          </span>
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Confirm your email</h1>
            <p className="mt-2 text-base text-muted-foreground">
              We sent a confirmation link to <span className="font-medium text-foreground">{email}</span>. Open it,
              then come back and log in.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-7 p-6">
      <div className="stagger flex flex-col gap-7">
        <div className="flex flex-col items-center gap-3.5 text-center">
          <HunchLogo className="size-16 drop-shadow-[0_10px_22px_rgba(124,92,255,0.35)]" />
          <div>
            <h1 className="font-display text-5xl font-semibold tracking-tight">
              Hunch<span className="text-primary">.</span>
            </h1>
            <p className="mt-1.5 text-base text-muted-foreground">Everyone already agrees. Sign in to find it.</p>
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-border/60 bg-card/70 p-5 shadow-xl shadow-foreground/6 backdrop-blur-xl">
          <Tabs defaultValue="login">
            <TabsList className="w-full rounded-2xl bg-secondary/70 p-1">
              <TabsTrigger className="flex-1 rounded-xl" value="login">Log in</TabsTrigger>
              <TabsTrigger className="flex-1 rounded-xl" value="signup">Create account</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="stagger mt-5 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="li-email">Email</Label>
                <Input id="li-email" type="email" inputMode="email" autoComplete="email" value={email}
                  onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="li-password">Password</Label>
                <Input id="li-password" type="password" autoComplete="current-password" value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && logIn()} />
              </div>
              <Button className="mt-1 h-12 text-base glow-primary" onClick={logIn} disabled={loading || !email || !password}>
                {loading ? "Signing in…" : "Log in"}
              </Button>

              <div className="mt-1 rounded-2xl border border-border/60 bg-secondary/40 p-3.5 text-sm">
                <p className="text-muted-foreground">
                  Just exploring? Tap a demo account to fill it in — password is{" "}
                  <span className="font-medium text-foreground">{DEMO_PASSWORD}</span>.
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {DEMO_ACCOUNTS.map((demo) => (
                    <button
                      key={demo}
                      type="button"
                      onClick={() => {
                        setEmail(demo);
                        setPassword(DEMO_PASSWORD);
                      }}
                      className="rounded-full border border-border/60 bg-card/70 px-3 py-1.5 font-medium text-foreground transition hover:border-primary/60 hover:bg-primary/10"
                    >
                      {demo}
                    </button>
                  ))}
                </div>
                <p className="mt-2.5 text-muted-foreground">
                  Or create your real account — it really works.
                </p>
              </div>
            </TabsContent>

            <TabsContent value="signup" className="stagger mt-5 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="su-username">Username</Label>
                <Input id="su-username" autoCapitalize="none" placeholder="ramenfan" value={username}
                  onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="su-email">Email</Label>
                <Input id="su-email" type="email" inputMode="email" autoComplete="email" value={email}
                  onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="su-password">Password</Label>
                <Input id="su-password" type="password" autoComplete="new-password" value={password}
                  onChange={(e) => setPassword(e.target.value)} />
              </div>
              <Button className="mt-1 h-12 text-base glow-primary" onClick={signUp} disabled={loading || !email || !password || !username}>
                {loading ? "Creating…" : "Create account"}
              </Button>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <AuthInner />
    </Suspense>
  );
}

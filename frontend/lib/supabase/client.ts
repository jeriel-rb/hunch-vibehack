import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client (anon key). Used from Client Components.
// NOTE: domain types come from @/lib/types; once the remote project exists we
// can regenerate strict DB types via `supabase gen types` and add the generic.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

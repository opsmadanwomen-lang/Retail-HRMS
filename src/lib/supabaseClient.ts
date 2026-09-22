import { createClient } from "@supabase/supabase-js";
// LooseDatabase (not the accurate generated Database) is used here deliberately — see the "Legacy
// compatibility layer" note at the bottom of database.types.ts. It is a compile-time-only
// substitution; runtime behavior of the client is identical either way.
import type { LooseDatabase } from "@/types/database.types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail loudly at startup rather than silently issuing broken requests. Without this, the
  // @supabase/supabase-js client below throws synchronously during module evaluation — which
  // happens as part of the static import chain (main.tsx -> App -> AppProviders -> AuthProvider
  // -> this file), before React ever renders and before any error boundary exists to catch it.
  // That aborts the whole script with an uncaught exception, leaving a blank white page with
  // nothing but a console error. Painting a visible message here first turns that into an
  // actionable diagnostic screen instead.
  const message =
    "Configuration error: missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY environment " +
    "variables. Set them in your deployment environment (e.g. Vercel Project Settings -> " +
    "Environment Variables) and redeploy.";
  // eslint-disable-next-line no-console
  console.error(message);
  if (typeof document !== "undefined") {
    document.body.innerHTML =
      '<div style="font-family:sans-serif;padding:2rem;color:#b91c1c;white-space:pre-wrap;">' +
      message +
      "</div>";
  }
}

export const supabase = createClient<LooseDatabase>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

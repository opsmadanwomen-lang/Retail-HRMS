import { createClient } from "@supabase/supabase-js";
// LooseDatabase (not the accurate generated Database) is used here deliberately — see the "Legacy
// compatibility layer" note at the bottom of database.types.ts. It is a compile-time-only
// substitution; runtime behavior of the client is identical either way.
import type { LooseDatabase } from "@/types/database.types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail loudly at startup rather than silently issuing broken requests.
  // eslint-disable-next-line no-console
  console.error(
    "Missing Supabase environment variables. Copy .env.example to .env and fill in your project values."
  );
}

export const supabase = createClient<LooseDatabase>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

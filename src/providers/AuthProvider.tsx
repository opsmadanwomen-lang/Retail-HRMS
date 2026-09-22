import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "@/lib/supabaseClient";
import { AuthContext, type AuthContextValue } from "@/contexts/AuthContext";
import type { AuthenticatedUser } from "@/types/auth";

async function loadProfile(userId: string): Promise<AuthenticatedUser | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  // A disabled login must never resolve to an authenticated user, even though the underlying
  // Supabase Auth session may still be technically valid. The caller signs the session out.
  if (!data.is_active) {
    return null;
  }

  return {
    id: data.id,
    email: data.email,
    fullName: data.full_name,
    role: data.role,
    companyId: data.company_id,
    storeId: data.store_id ?? null,
    avatarUrl: data.avatar_url,
    mustChangePassword: data.must_change_password ?? false,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function resolveSession(session: { user: { id: string } } | null) {
      if (!session?.user) {
        if (isMounted) setUser(null);
        return;
      }

      const profile = await loadProfile(session.user.id);
      if (!profile) {
        // Either no profile row exists, or the login has been disabled — either way there is no
        // valid app-level session, so fully terminate the underlying Supabase Auth session too.
        await supabase.auth.signOut();
      }
      if (isMounted) setUser(profile);
    }

    async function initialize() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      await resolveSession(session);

      if (isMounted) {
        setIsLoading(false);
      }
    }

    initialize();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      await resolveSession(session);
      if (isMounted) setIsLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (loginEmail: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password,
    });

    if (error) {
      throw error;
    }

    if (!data.user) {
      throw new Error("Sign in failed. Please try again.");
    }

    // Load and set the profile HERE, synchronously as part of the sign-in call, rather than
    // relying solely on the separate onAuthStateChange listener (still present below for page
    // refresh/token-refresh/cross-tab cases). Without this, callers that navigate immediately
    // after `await signIn(...)` resolves would race the listener's async profile fetch: the
    // route would see `user === null` for a moment and bounce straight back to /login even
    // though authentication genuinely succeeded.
    const profile = await loadProfile(data.user.id);
    if (!profile) {
      await supabase.auth.signOut();
      throw new Error("This account is disabled or is not linked to a profile. Contact your administrator.");
    }
    setUser(profile);
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) return;
    const profile = await loadProfile(session.user.id);
    setUser(profile);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      signIn,
      signOut,
      refreshProfile,
    }),
    [user, isLoading, signIn, signOut, refreshProfile]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

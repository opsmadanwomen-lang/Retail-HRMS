import { createContext, useContext } from "react";
import type { AuthenticatedUser } from "@/types/auth";

export interface AuthContextValue {
  user: AuthenticatedUser | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-fetches the current user's profile (e.g. after must_change_password flips to false). */
  refreshProfile: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used within an AuthProvider");
  return ctx;
}

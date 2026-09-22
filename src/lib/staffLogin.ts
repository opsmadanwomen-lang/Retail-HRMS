/**
 * Staff logins use the Employee Code as their public "Login ID" — Supabase Auth still requires an
 * email under the hood, so Staff accounts are provisioned (see supabase/functions/staff-account)
 * with a synthetic, non-deliverable email derived deterministically from the Employee Code. This
 * mirrors that exact same derivation so the login form can translate what the user types into the
 * real Supabase Auth email before calling signInWithPassword.
 *
 * Anything already containing "@" is treated as a direct email login, preserving existing
 * Admin/Super Admin accounts that sign in with their real email.
 */
const STAFF_LOGIN_DOMAIN = "staff.retailhrms.example.com";

export function resolveLoginEmail(loginId: string): string {
  const trimmed = loginId.trim();
  if (trimmed.includes("@")) return trimmed;
  return `${trimmed.toLowerCase()}@${STAFF_LOGIN_DOMAIN}`;
}

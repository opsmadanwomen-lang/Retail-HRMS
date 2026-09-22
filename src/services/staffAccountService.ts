import { supabase } from "@/lib/supabaseClient";

export interface StaffAccountCredentials {
  employeeName: string;
  employeeCode: string;
  loginId: string;
  tempPassword: string;
}

async function invoke<T>(action: "create" | "reset" | "disable" | "enable", employeeId: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke("staff-account", {
    body: { action, employeeId },
  });

  if (error) {
    // supabase-js wraps non-2xx responses in a generic error; try to surface the function's own message.
    const context = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    if (context?.json) {
      try {
        const body = await context.json();
        if (body?.error) throw new Error(body.error);
      } catch {
        // fall through to the generic error below
      }
    }
    throw new Error(error.message || "The request could not be completed.");
  }

  if (data?.error) throw new Error(data.error);
  return data as T;
}

export const staffAccountService = {
  /** Creates a new Staff login for this employee. Fails with a clear message if one already exists. */
  createAccount(employeeId: string): Promise<StaffAccountCredentials> {
    return invoke<StaffAccountCredentials>("create", employeeId);
  },

  /** Issues a brand-new temporary password, invalidating the old one, and forces a change on next login. */
  resetPassword(employeeId: string): Promise<StaffAccountCredentials> {
    return invoke<StaffAccountCredentials>("reset", employeeId);
  },

  disableAccount(employeeId: string): Promise<{ ok: boolean; isActive: boolean }> {
    return invoke("disable", employeeId);
  },

  enableAccount(employeeId: string): Promise<{ ok: boolean; isActive: boolean }> {
    return invoke("enable", employeeId);
  },
};

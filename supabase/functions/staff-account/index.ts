// Supabase Edge Function: staff-account
//
// Handles the privileged parts of the Staff Login lifecycle that a pure
// client-side (anon key) app cannot safely do itself:
//   - create:  provision a new Supabase Auth login for an employee, with a
//              securely generated temporary password, WITHOUT touching the
//              calling admin's own session and WITHOUT sending any email
//              (uses the Admin API, not the public signUp() flow).
//   - reset:   issue a brand-new temporary password for an existing Staff
//              login, invalidating the old one.
//   - disable / enable: turn a Staff login off/on without deleting anything.
//
// This is the ONLY place in the system with access to the service role key.
// Every request is authorized against the CALLER's own JWT + profile role —
// never trusted from the request body — before any privileged action runs.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PASSWORD_ALPHABET_LOWER = "abcdefghjkmnpqrstuvwxyz";
const PASSWORD_ALPHABET_UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";
const PASSWORD_ALPHABET_DIGIT = "23456789";
const PASSWORD_ALPHABET_SPECIAL = "!@#$%*?";

function randomFrom(alphabet: string): string {
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  return alphabet[bytes[0] % alphabet.length];
}

/** Securely generated temporary password — never derived from employee code, DOB, DOJ, mobile, or name. */
function generateTempPassword(): string {
  const required = [
    randomFrom(PASSWORD_ALPHABET_UPPER),
    randomFrom(PASSWORD_ALPHABET_LOWER),
    randomFrom(PASSWORD_ALPHABET_DIGIT),
    randomFrom(PASSWORD_ALPHABET_SPECIAL),
  ];
  const allChars = PASSWORD_ALPHABET_LOWER + PASSWORD_ALPHABET_UPPER + PASSWORD_ALPHABET_DIGIT + PASSWORD_ALPHABET_SPECIAL;
  const rest: string[] = [];
  for (let i = 0; i < 8; i += 1) rest.push(randomFrom(allChars));
  const combined = [...required, ...rest];
  // Fisher-Yates shuffle so the required characters aren't always in the same position.
  for (let i = combined.length - 1; i > 0; i -= 1) {
    const j = Math.floor((crypto.getRandomValues(new Uint8Array(1))[0] / 256) * (i + 1));
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }
  return combined.join("");
}

function synthesizeLoginEmail(employeeCode: string): string {
  return `${employeeCode.toLowerCase()}@staff.retailhrms.example.com`;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    const {
      data: { user: callerAuthUser },
      error: callerAuthError,
    } = await callerClient.auth.getUser();

    if (callerAuthError || !callerAuthUser) {
      return jsonResponse({ error: "Not authenticated." }, 401);
    }

    const { data: callerProfile, error: callerProfileError } = await adminClient
      .from("profiles")
      .select("id, role, company_id, is_active")
      .eq("id", callerAuthUser.id)
      .maybeSingle();

    if (callerProfileError || !callerProfile) {
      return jsonResponse({ error: "Caller profile not found." }, 403);
    }

    const isAuthorized = callerProfile.is_active && (callerProfile.role === "company_admin" || callerProfile.role === "super_admin");
    if (!isAuthorized) {
      return jsonResponse({ error: "You are not authorized to manage Staff accounts." }, 403);
    }

    const body = await req.json();
    const action = body.action as "create" | "reset" | "disable" | "enable";
    const employeeId = body.employeeId as string | undefined;

    if (!action || !employeeId) {
      return jsonResponse({ error: "action and employeeId are required." }, 400);
    }

    const { data: employee, error: employeeError } = await adminClient
      .from("employees")
      .select("id, employee_code, full_name, company_id, store_id, auth_user_id")
      .eq("id", employeeId)
      .maybeSingle();

    if (employeeError || !employee) {
      return jsonResponse({ error: "Employee not found." }, 404);
    }

    if (callerProfile.role !== "super_admin" && employee.company_id !== callerProfile.company_id) {
      return jsonResponse({ error: "Employee is outside your company." }, 403);
    }

    if (!employee.employee_code) {
      return jsonResponse({ error: "Employee does not have an Employee Code yet." }, 400);
    }

    if (action === "create") {
      if (employee.auth_user_id) {
        return jsonResponse({ error: "Login account already exists for this employee." }, 409);
      }

      const loginEmail = synthesizeLoginEmail(employee.employee_code);
      const tempPassword = generateTempPassword();

      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email: loginEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { employee_id: employee.id, employee_code: employee.employee_code },
      });

      if (createError || !created.user) {
        return jsonResponse({ error: createError?.message ?? "Could not create the login account." }, 500);
      }

      const { error: profileError } = await adminClient.from("profiles").insert({
        id: created.user.id,
        company_id: employee.company_id,
        full_name: employee.full_name,
        email: loginEmail,
        role: "staff",
        is_active: true,
        must_change_password: true,
      });

      if (profileError) {
        await adminClient.auth.admin.deleteUser(created.user.id);
        return jsonResponse({ error: profileError.message }, 500);
      }

      const { error: linkError } = await adminClient
        .from("employees")
        .update({ auth_user_id: created.user.id })
        .eq("id", employee.id);

      if (linkError) {
        return jsonResponse({ error: linkError.message }, 500);
      }

      return jsonResponse({
        employeeName: employee.full_name,
        employeeCode: employee.employee_code,
        loginId: employee.employee_code,
        tempPassword,
      });
    }

    if (action === "reset") {
      if (!employee.auth_user_id) {
        return jsonResponse({ error: "This employee does not have a login account yet." }, 400);
      }

      const tempPassword = generateTempPassword();
      const { error: updateError } = await adminClient.auth.admin.updateUserById(employee.auth_user_id, {
        password: tempPassword,
      });
      if (updateError) {
        return jsonResponse({ error: updateError.message }, 500);
      }

      await adminClient
        .from("profiles")
        .update({ must_change_password: true })
        .eq("id", employee.auth_user_id);

      return jsonResponse({
        employeeName: employee.full_name,
        employeeCode: employee.employee_code,
        loginId: employee.employee_code,
        tempPassword,
      });
    }

    if (action === "disable" || action === "enable") {
      if (!employee.auth_user_id) {
        return jsonResponse({ error: "This employee does not have a login account yet." }, 400);
      }

      const { error: statusError } = await adminClient
        .from("profiles")
        .update({ is_active: action === "enable" })
        .eq("id", employee.auth_user_id);

      if (statusError) {
        return jsonResponse({ error: statusError.message }, 500);
      }

      return jsonResponse({ ok: true, isActive: action === "enable" });
    }

    return jsonResponse({ error: `Unknown action "${action}".` }, 400);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected error." }, 500);
  }
});

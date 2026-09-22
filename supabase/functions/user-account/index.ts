// Supabase Edge Function: user-account
//
// Central User Management (Settings -> User Management), Super Admin only.
// Handles the privileged parts of provisioning/managing an application login
// that a pure client-side (anon key) app cannot safely do itself — creating/
// updating an auth.users row and resetting its password via the Admin API.
// This mirrors the EXISTING staff-account function's exact pattern (caller
// authorization against the caller's own JWT + profile role, service-role
// client used only after that check, compensating delete-on-failure) rather
// than inventing a second privileged-account mechanism.
//
// EMPLOYEE IS THE MASTER RECORD (Anuj Dwivedi duplicate-employee incident,
// Aug 2026): this function NEVER inserts into `employees`. Creating a user
// requires an existing `employeeId` (selected by Super Admin in the UI from
// the existing Employees table) and only ever links `employees.auth_user_id`
// to the new/updated login. See `resolveSelectableEmployee` below for the
// duplicate-account guards this enforces before that link is made. Changing
// which employee a login is linked to after creation is a separate, explicit
// `relink_employee` action — normal `update` never touches the linkage.
//
// Role bridging (NOT a second Night Duty system): choosing "Operations
// Manager (SOM)" or "Super Manager" as the Role still stores profiles.role =
// 'staff' — exactly what the EXISTING, already-working Night Duty approval
// system (attendance_operations_manager_assignments / attendance_super_
// managers, resolved via employees.auth_user_id) already expects (see
// migration 0047/0061 and NightDutyManagerAccessPage.tsx). This function
// creates the matching assignment-table row(s) against the SELECTED existing
// employee so the new login has REAL approval authority through that same
// existing mechanism — it never invents a parallel one. Every other role
// (super_admin, company_admin, store_manager, department_manager, staff) is
// stored as-is with no additional bridging, since none of those has any
// existing consumer requiring it.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const APP_ROLES = ["super_admin", "company_admin", "operations_manager", "super_manager", "store_manager", "department_manager", "staff"] as const;
type RequestRole = (typeof APP_ROLES)[number];

// "Operations Manager (SOM)" and "Super Manager" are Role CHOICES in the UI — the underlying
// profiles.role stored is always 'staff' for these two, per the architecture note above.
function storedProfileRole(requestRole: RequestRole): "super_admin" | "company_admin" | "store_manager" | "department_manager" | "staff" {
  if (requestRole === "operations_manager" || requestRole === "super_manager") return "staff";
  return requestRole;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isStrongPassword(password: string): boolean {
  // At least 8 chars, one letter, one number — matches this app's existing password-policy bar
  // (see ChangePasswordPage.tsx) rather than inventing a stricter/looser rule for this one flow.
  return password.length >= 8 && /[A-Za-z]/.test(password) && /[0-9]/.test(password);
}

type SelectableEmployee = {
  id: string;
  company_id: string;
  store_id: string | null;
  full_name: string;
  email: string | null;
  employee_code: string | null;
  auth_user_id: string | null;
};

/**
 * Fetches an employee by ID, scoped to the caller's company, and returns a caller-facing error if
 * it can't be safely used to back a login. This is the ONLY place an `employees` row is looked up
 * for User Management purposes — the row is always identified explicitly by ID (an admin picking
 * it from the existing Employees list), never guessed at by name/email matching.
 *
 * `excludeAuthUserId` lets the same login re-select the employee it's already linked to (used by
 * `relink_employee` when the target is unchanged) without tripping the "already has an account"
 * guard on itself.
 */
async function resolveSelectableEmployee(
  adminClient: ReturnType<typeof createClient>,
  params: { employeeId: string; companyId: string; excludeAuthUserId?: string }
): Promise<{ employee: SelectableEmployee } | { error: string; status: number }> {
  const { employeeId, companyId, excludeAuthUserId } = params;

  const { data: employee, error } = await adminClient
    .from("employees")
    .select("id, company_id, store_id, full_name, email, employee_code, auth_user_id")
    .eq("id", employeeId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (error || !employee) {
    return { error: "Selected employee not found.", status: 404 };
  }

  if (employee.auth_user_id && employee.auth_user_id !== excludeAuthUserId) {
    const { data: existingProfile } = await adminClient
      .from("profiles")
      .select("email")
      .eq("id", employee.auth_user_id)
      .maybeSingle();
    return {
      error: `This employee already has a user account${existingProfile?.email ? ` (${existingProfile.email})` : ""}.`,
      status: 409,
    };
  }

  return { employee: employee as SelectableEmployee };
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

    // Part 22: ONLY Super Admin may create users, change roles, change store scope, deactivate
    // users, or reset another user's password — no exception for company_admin here, unlike
    // staff-account (which is deliberately broader). Re-checked here, server-side, independent of
    // whatever the frontend UI shows/hides.
    if (!callerProfile.is_active || callerProfile.role !== "super_admin") {
      return jsonResponse({ error: "Only Super Admin can manage users." }, 403);
    }

    const body = await req.json();
    const action = body.action as "create" | "update" | "reset_password" | "set_active" | "relink_employee";

    if (!action) {
      return jsonResponse({ error: "action is required." }, 400);
    }

    // -------------------------------------------------------------------
    // CREATE
    // -------------------------------------------------------------------
    if (action === "create") {
      const employeeId = body.employeeId as string | undefined;
      const email = (body.email as string | undefined)?.trim().toLowerCase();
      const password = body.password as string | undefined;
      const role = body.role as RequestRole | undefined;
      const storeId = (body.storeId as string | null | undefined) ?? null;
      const isActive = body.isActive !== false;

      // Employee is the master record — User Management only ever grants an EXISTING employee a
      // login. This is mandatory, not a fallback: there is no "create a new employee" path here.
      if (!employeeId) return jsonResponse({ error: "Employee is required. Select an existing employee before creating a login." }, 400);
      if (!email || !isValidEmail(email)) return jsonResponse({ error: "A valid Email / Login ID is required." }, 400);
      if (!password || !isStrongPassword(password)) {
        return jsonResponse({ error: "Password must be at least 8 characters and include a letter and a number." }, 400);
      }
      if (!role || !APP_ROLES.includes(role)) return jsonResponse({ error: "A valid Role is required." }, 400);

      const resolved = await resolveSelectableEmployee(adminClient, { employeeId, companyId: callerProfile.company_id });
      if ("error" in resolved) return jsonResponse({ error: resolved.error }, resolved.status);
      const employee = resolved.employee;

      // Email must not already belong to a DIFFERENT employee record (even one with no login yet)
      // — the strongest duplicate-account signal available before we touch auth.users at all.
      const { count: emailOnOtherEmployee } = await adminClient
        .from("employees")
        .select("id", { count: "exact", head: true })
        .eq("company_id", callerProfile.company_id)
        .eq("email", email)
        .neq("id", employee.id);
      if ((emailOnOtherEmployee ?? 0) > 0) {
        return jsonResponse({ error: "This email already belongs to a different employee." }, 409);
      }

      // Full Name, Employee Code, etc. always come from the selected employee record — never from
      // client input — so a login can never drift from (or duplicate) the master employee identity.
      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: employee.full_name, employee_id: employee.id, created_via: "user-account" },
      });

      if (createError || !created.user) {
        // Supabase Auth already enforces email uniqueness — surface its message directly rather
        // than re-deriving a duplicate-email check ourselves. This is also what rejects an email
        // already used by another login (Auth user), per the duplicate-account requirement.
        return jsonResponse({ error: createError?.message ?? "Could not create the login account." }, 409);
      }

      const profileRole = storedProfileRole(role);

      const { error: profileError } = await adminClient.from("profiles").insert({
        id: created.user.id,
        company_id: callerProfile.company_id,
        full_name: employee.full_name,
        email,
        role: profileRole,
        store_id: storeId,
        is_active: isActive,
        must_change_password: true,
        created_by: callerProfile.id,
        updated_by: callerProfile.id,
      });

      if (profileError) {
        await adminClient.auth.admin.deleteUser(created.user.id);
        return jsonResponse({ error: profileError.message }, 500);
      }

      // Link the new login to the EXACT selected employee — never an insert. `employee_code`,
      // `store_id`, `store_department_id`, `store_designation_id`, and every history table stay
      // untouched; only `auth_user_id`/`email`/`updated_by` change.
      const { error: linkError } = await adminClient
        .from("employees")
        .update({ auth_user_id: created.user.id, email, updated_by: callerProfile.id })
        .eq("id", employee.id);

      if (linkError) {
        // Compensate fully rather than leave an unlinked login behind — this function's one
        // invariant is "every login it creates is linked to the employee it was created for".
        await adminClient.from("profiles").delete().eq("id", created.user.id);
        await adminClient.auth.admin.deleteUser(created.user.id);
        return jsonResponse({ error: linkError.message }, 500);
      }

      // Bridge to the EXISTING Night Duty approval system for Operations Manager / Super Manager —
      // see the architecture note at the top of this file — against the SAME selected employee.id.
      if (role === "operations_manager") {
        if (storeId) {
          await adminClient.from("attendance_operations_manager_assignments").upsert(
            { company_id: callerProfile.company_id, employee_id: employee.id, store_id: storeId, is_active: true, created_by: callerProfile.id, updated_by: callerProfile.id },
            { onConflict: "employee_id,store_id" }
          );
        } else {
          // "All Stores" scope: one assignment row per active store in the company — the existing
          // attendance_operations_manager_assignments table has no company-wide/NULL-store row
          // concept (by design, matched exactly here rather than changed).
          const { data: stores } = await adminClient.from("stores").select("id").eq("company_id", callerProfile.company_id).eq("status", "active");
          for (const s of stores ?? []) {
            await adminClient.from("attendance_operations_manager_assignments").upsert(
              { company_id: callerProfile.company_id, employee_id: employee.id, store_id: s.id, is_active: true, created_by: callerProfile.id, updated_by: callerProfile.id },
              { onConflict: "employee_id,store_id" }
            );
          }
        }
      } else if (role === "super_manager") {
        await adminClient.from("attendance_super_managers").upsert(
          { company_id: callerProfile.company_id, employee_id: employee.id, is_active: true, created_by: callerProfile.id, updated_by: callerProfile.id },
          { onConflict: "employee_id" }
        );
      }

      return jsonResponse({ userId: created.user.id, email, role, employeeId: employee.id });
    }

    // -------------------------------------------------------------------
    // UPDATE
    // -------------------------------------------------------------------
    if (action === "update") {
      const userId = body.userId as string | undefined;
      if (!userId) return jsonResponse({ error: "userId is required." }, 400);

      const { data: existingProfile, error: existingError } = await adminClient
        .from("profiles")
        .select("id, role, store_id, email, full_name")
        .eq("id", userId)
        .maybeSingle();
      if (existingError || !existingProfile) return jsonResponse({ error: "User not found." }, 404);

      // Employee is the master record — normal Edit User NEVER creates or re-matches an employee
      // (that is exclusively the `relink_employee` action, a separate, explicit, audited step).
      // Whatever employee is (or isn't) linked to this login going in is exactly what's linked
      // coming out.
      const { data: linkedEmployee } = await adminClient.from("employees").select("id").eq("auth_user_id", userId).maybeSingle();

      const updates: Record<string, unknown> = { updated_by: callerProfile.id };
      // Full Name only comes from client input when this login has NO linked employee — once an
      // employee is linked, its `full_name` is the single source of truth (edit it on the Employee
      // Profile, not here), so a client-sent value is ignored rather than letting the two drift.
      if (!linkedEmployee && typeof body.fullName === "string" && body.fullName.trim()) {
        updates.full_name = body.fullName.trim();
      }

      if (typeof body.email === "string" && body.email.trim() && body.email.trim().toLowerCase() !== existingProfile.email) {
        const newEmail = body.email.trim().toLowerCase();
        if (!isValidEmail(newEmail)) return jsonResponse({ error: "A valid Email is required." }, 400);
        const { error: emailError } = await adminClient.auth.admin.updateUserById(userId, { email: newEmail, email_confirm: true });
        if (emailError) return jsonResponse({ error: emailError.message }, 409);
        updates.email = newEmail;
        // Keep the linked employee's email in sync with its login — same invariant CREATE and
        // relink_employee maintain.
        if (linkedEmployee) {
          await adminClient.from("employees").update({ email: newEmail, updated_by: callerProfile.id }).eq("id", linkedEmployee.id);
        }
      }

      let newRole: RequestRole | undefined;
      if (typeof body.role === "string") {
        if (!APP_ROLES.includes(body.role as RequestRole)) return jsonResponse({ error: "Invalid role." }, 400);
        newRole = body.role as RequestRole;
        updates.role = storedProfileRole(newRole);
      }

      if ("storeId" in body) updates.store_id = body.storeId ?? null;
      if (typeof body.isActive === "boolean") updates.is_active = body.isActive;

      const { error: updateError } = await adminClient.from("profiles").update(updates).eq("id", userId);
      if (updateError) return jsonResponse({ error: updateError.message }, 500);

      // If the role changed to Operations Manager / Super Manager, keep the Night Duty assignment
      // membership in sync against the ALREADY-linked employee — reusing the same existing tables,
      // never a new mechanism, and never creating/matching an employee here.
      if (newRole === "operations_manager" || newRole === "super_manager") {
        if (!linkedEmployee?.id) {
          return jsonResponse({
            warning: `Role updated, but this login is not linked to an employee yet, so ${newRole === "operations_manager" ? "Operations Manager" : "Super Manager"} approval could not be granted. Use "Relink Employee" to link an existing employee to this login first, then set the role again.`,
            ok: true,
          }, 200);
        }

        const employeeId = linkedEmployee.id;
        if (newRole === "operations_manager") {
          const storeId = (body.storeId as string | null | undefined) ?? existingProfile.store_id ?? null;
          if (storeId) {
            await adminClient.from("attendance_operations_manager_assignments").upsert(
              { company_id: callerProfile.company_id, employee_id: employeeId, store_id: storeId, is_active: true, updated_by: callerProfile.id },
              { onConflict: "employee_id,store_id" }
            );
          }
        } else {
          await adminClient.from("attendance_super_managers").upsert(
            { company_id: callerProfile.company_id, employee_id: employeeId, is_active: true, updated_by: callerProfile.id },
            { onConflict: "employee_id" }
          );
        }
      }

      return jsonResponse({ ok: true });
    }

    // -------------------------------------------------------------------
    // RELINK EMPLOYEE — the ONLY way a login's employee linkage may change after creation.
    // Explicit, separate from `update` on purpose: this is a meaningful, audited action (old
    // employee unlinked + its Night Duty authority revoked, new employee linked), not a silent
    // side-effect of an ordinary field edit.
    // -------------------------------------------------------------------
    if (action === "relink_employee") {
      const userId = body.userId as string | undefined;
      const employeeId = body.employeeId as string | undefined;
      if (!userId || !employeeId) return jsonResponse({ error: "userId and employeeId are required." }, 400);

      const { data: profile, error: profileError } = await adminClient
        .from("profiles")
        .select("id, email, company_id")
        .eq("id", userId)
        .maybeSingle();
      if (profileError || !profile) return jsonResponse({ error: "User not found." }, 404);

      const resolved = await resolveSelectableEmployee(adminClient, { employeeId, companyId: profile.company_id, excludeAuthUserId: userId });
      if ("error" in resolved) return jsonResponse({ error: resolved.error }, resolved.status);
      const targetEmployee = resolved.employee;

      const { data: currentEmployee } = await adminClient.from("employees").select("id").eq("auth_user_id", userId).maybeSingle();

      if (currentEmployee && currentEmployee.id === targetEmployee.id) {
        return jsonResponse({ ok: true, employeeId: targetEmployee.id }); // already linked — no-op
      }

      if (currentEmployee) {
        // Unlink the OLD employee and revoke any Night Duty approval authority it held through
        // this login — that authority belongs to the login-employee pairing, not to either side
        // alone, so it must not silently carry over to whichever employee is linked next.
        await adminClient.from("employees").update({ auth_user_id: null, updated_by: callerProfile.id }).eq("id", currentEmployee.id);
        await adminClient.from("attendance_operations_manager_assignments").update({ is_active: false, updated_by: callerProfile.id }).eq("employee_id", currentEmployee.id);
        await adminClient.from("attendance_super_managers").update({ is_active: false, updated_by: callerProfile.id }).eq("employee_id", currentEmployee.id);
      }

      const { error: linkError } = await adminClient
        .from("employees")
        .update({ auth_user_id: userId, email: profile.email, updated_by: callerProfile.id })
        .eq("id", targetEmployee.id);
      if (linkError) return jsonResponse({ error: linkError.message }, 500);

      return jsonResponse({ ok: true, employeeId: targetEmployee.id, previousEmployeeId: currentEmployee?.id ?? null });
    }

    // -------------------------------------------------------------------
    // RESET PASSWORD
    // -------------------------------------------------------------------
    if (action === "reset_password") {
      const userId = body.userId as string | undefined;
      const password = body.password as string | undefined;
      if (!userId) return jsonResponse({ error: "userId is required." }, 400);
      if (!password || !isStrongPassword(password)) {
        return jsonResponse({ error: "Password must be at least 8 characters and include a letter and a number." }, 400);
      }

      const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, { password });
      if (updateError) return jsonResponse({ error: updateError.message }, 500);

      await adminClient.from("profiles").update({ must_change_password: true, updated_by: callerProfile.id }).eq("id", userId);

      return jsonResponse({ ok: true });
    }

    // -------------------------------------------------------------------
    // SET ACTIVE / INACTIVE
    // -------------------------------------------------------------------
    if (action === "set_active") {
      const userId = body.userId as string | undefined;
      const isActive = body.isActive as boolean | undefined;
      if (!userId || typeof isActive !== "boolean") return jsonResponse({ error: "userId and isActive are required." }, 400);

      // Deactivating a user must also revoke real Night Duty approval authority immediately,
      // server-side — not merely hide it in the UI (Part 22). Reactivating does NOT automatically
      // restore it; Super Admin re-enables it explicitly via Night Duty Manager Access, matching
      // that this function never silently grants approval authority for a role change it did not
      // itself just make.
      //
      // Employee is the master record: deactivating a LOGIN must never deactivate the linked
      // EMPLOYEE, or touch it at all beyond revoking its OM/Super Manager assignment rows — the
      // employee's own status/history is a separate business decision made on the Employee Profile,
      // not a side-effect of a login being switched off.
      if (!isActive) {
        const { data: linkedEmployee } = await adminClient.from("employees").select("id").eq("auth_user_id", userId).maybeSingle();
        if (linkedEmployee?.id) {
          await adminClient.from("attendance_operations_manager_assignments").update({ is_active: false, updated_by: callerProfile.id }).eq("employee_id", linkedEmployee.id);
          await adminClient.from("attendance_super_managers").update({ is_active: false, updated_by: callerProfile.id }).eq("employee_id", linkedEmployee.id);
        }
      }

      const { error: statusError } = await adminClient.from("profiles").update({ is_active: isActive, updated_by: callerProfile.id }).eq("id", userId);
      if (statusError) return jsonResponse({ error: statusError.message }, 500);

      return jsonResponse({ ok: true, isActive });
    }

    return jsonResponse({ error: `Unknown action "${action}".` }, 400);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected error." }, 500);
  }
});

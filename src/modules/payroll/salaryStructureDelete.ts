// Maps the errors raised by salary_structure_delete() / salary_structure_delete_check() (migration 0177)
// to a specific title + the server's own message. The RPC puts a machine code in the Postgres error
// `hint`; the SQLSTATE `code` is the fallback for errors raised by Postgres itself.

export interface DeleteErrorInfo { title: string; description: string }

const BY_HINT: Record<string, string> = {
  NOT_AUTHORISED: "Unauthorized",
  NOT_AUTHENTICATED: "Unauthorized",
  ACTIVE: "Active structure",
  EMPLOYEE_ASSIGNED: "Employee assignment exists",
  PAYROLL_USED: "Payroll history exists",
  PROTECTED_HISTORY: "Protected historical reference",
  NOT_FOUND: "Structure not found",
};

export function describeDeleteError(e: unknown): DeleteErrorInfo {
  const err = (e ?? {}) as { message?: string; hint?: string | null; code?: string | null };
  const message = err.message || "No further detail was returned by the server.";
  if (err.hint && BY_HINT[err.hint]) return { title: BY_HINT[err.hint], description: message };
  if (err.code === "42501" || err.code === "28000") return { title: "Unauthorized", description: message };
  if (err.code === "23503" || err.code?.startsWith("23")) return { title: "Database constraint", description: message };
  // 42883 / PGRST202: the function is not in the database (migration 0177 not applied yet)
  if (err.code === "42883" || err.code === "PGRST202") return { title: "Delete is not available", description: "The delete function is not installed in the database yet (migration 0177 has not been applied)." };
  return { title: "Unexpected server error", description: message };
}

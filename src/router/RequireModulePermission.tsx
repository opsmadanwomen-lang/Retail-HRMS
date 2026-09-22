import { Navigate, Outlet } from "react-router-dom";
import { ROUTES } from "@/constants/routes";
import { useHasPermission } from "@/hooks/usePermissions";

/**
 * Dynamic Role & Permission System (migration 0161) — module-level route guard. Enforces
 * "manual URL entry is denied" (spec §20) for the modules a Super Admin can restrict from
 * Settings -> User & Role Permissions. Same Navigate/Outlet shape as AdminOnlyRoute, layered
 * INSIDE it (a 'staff' account is already redirected by AdminOnlyRoute before this ever runs).
 *
 * Fails OPEN like every other dynamic-permission check in this app: useHasPermission defaults to
 * `true` while loading or when nothing has been configured, so simply adding this guard to a
 * route changes nothing until a Super Admin explicitly denies VIEW for that module. The backend
 * (RESTRICTIVE RLS in migration 0162, and each RPC's own authorization) remains the real
 * enforcement point regardless of what this guard allows through — this is the UX/navigation
 * layer, not the security boundary.
 */
export function RequireModulePermission({ module, action = "VIEW" }: { module: string; action?: string }) {
  const { allowed } = useHasPermission(module, action);

  if (!allowed) {
    return <Navigate to={ROUTES.dashboard} replace />;
  }

  return <Outlet />;
}

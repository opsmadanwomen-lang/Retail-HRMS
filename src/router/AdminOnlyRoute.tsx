import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { ROUTES } from "@/constants/routes";

/**
 * Guards every admin-facing route (Companies, Stores, Employees, Roles, KPI, Tasks, Performance
 * Data, Organization, Settings, Employee Import, Attendance Import, and the dashboard root). A
 * 'staff' role account is redirected to their own Staff Panel dashboard — this runs at the
 * router level regardless of how the URL was reached (sidebar link, bookmark, typed address,
 * back button), not just a hidden menu item. Company Admin / Super Admin are unaffected.
 */
export function AdminOnlyRoute() {
  const { user } = useAuth();

  if (user?.role === "staff") {
    return <Navigate to={ROUTES.staffDashboard} replace />;
  }

  return <Outlet />;
}

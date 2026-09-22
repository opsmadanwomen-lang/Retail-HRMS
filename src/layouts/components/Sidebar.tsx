import { useMemo } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  FileText,
  Clock,
  CalendarDays,
  Wallet,
  Banknote,
  BarChart3,
  Settings,
  Moon,
  UserCircle,
  ClipboardCheck,
  Landmark,
  ChevronsLeft,
  ChevronsRight,
  X,
  UserMinus,
  ArrowRightLeft,
  Receipt,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { ROUTES } from "@/constants/routes";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentEmployee } from "@/hooks/useAttendance";
import { useAmISuperManager, useMyOperationsManagerStores } from "@/hooks/useExtendedAttendanceRules";
import { useMyPermissionsBulk } from "@/hooks/usePermissions";

// adminOnly items mirror AdminOnlyRoute exactly — this hides them for a good UX, the router
// guard is what actually enforces it (typing the URL directly still redirects a staff account).
const NAV_ITEMS = [
  {
    label: "Dashboard",
    to: ROUTES.dashboard,
    icon: LayoutDashboard,
    end: true,
    adminOnly: true,
  },

  // Staff Panel's own Dashboard — mutually exclusive with the admin Dashboard above (never
  // rendered for the same user), so it reuses the same label/icon by design.
  {
    label: "Dashboard",
    to: ROUTES.staffDashboard,
    icon: LayoutDashboard,
    end: true,
    staffOnly: true,
  },

  {
    label: "Employees",
    to: ROUTES.employees,
    icon: Users,
    adminOnly: true,
    moduleCode: "employee",
  },

  // Employee Import — reached from the Employees page's "Import" button. Route /employees/import
  // is unchanged and still works directly.

  {
    label: "Employee Documents",
    to: ROUTES.employeeDocuments,
    icon: FileText,
    adminOnly: true,
    moduleCode: "employee_documents",
  },

  {
    label: "Exit Requests",
    to: ROUTES.exitRequests,
    icon: UserMinus,
    adminOnly: true,
    moduleCode: "exit_request",
  },

  {
    label: "Employee Transfers",
    to: ROUTES.employeeTransfers,
    icon: ArrowRightLeft,
    adminOnly: true,
    moduleCode: "employee_transfer",
  },

  // Shift Management, Employee Schedule — configuration; now reached from Settings → Settings Center
  // (routes /shifts and /schedule are unchanged and still work directly).

  {
    label: "Attendance",
    to: ROUTES.attendance,
    icon: Clock,
    adminOnly: false,
    moduleCode: "attendance",
  },

  // Staff Panel's own Approvals / Leave / Payslip & Documents / Profile — new pages for this Staff
  // Panel standardization pass (item 22: no separate visual system per page, one shared Sidebar).
  // Approvals is a section (not a single relabeled link) so it has its own `end: false` — clicking
  // it lands on the Approvals list, which currently has one category, Night Duty Approval.
  {
    label: "Approvals",
    to: ROUTES.staffApprovals,
    icon: ClipboardCheck,
    staffOnly: true,
  },

  {
    label: "Leave",
    to: ROUTES.leave,
    icon: CalendarDays,
    end: true,
    staffOnly: true,
    moduleCode: "leave",
  },

  {
    label: "Payslip & Documents",
    to: ROUTES.payslip,
    icon: Wallet,
    staffOnly: true,
  },

  {
    label: "Profile",
    to: ROUTES.profile,
    icon: UserCircle,
    staffOnly: true,
  },

  // Leave Settings (Leave Policy Engine) — configuration; now reached from Settings → Settings Center
  // (route /settings/leave-policies is unchanged and still works directly).

  {
    label: "Leave Settlement",
    to: ROUTES.leaveSettlement,
    icon: Landmark,
    adminOnly: true,
    superAdminOnly: true,
  },

  // Leave Reports — now reached from the Reports hub (Reports → Leave Reports). Route
  // /settings/leave-reports is unchanged and still works directly.

  {
    label: "Payroll",
    to: ROUTES.payroll,
    icon: Wallet,
    adminOnly: true,
    moduleCode: "payroll",
  },

  // Payroll Settings and Advance Settings (Advance Types/Policies/Approvers/Processors/Recovery
  // configuration) — now reached from Settings → Settings Center. Routes
  // /payroll/salary-structure and /settings/advance-management are unchanged and still work directly.

  // Staff Panel's own Advance area — request a new advance / track your own advances. The
  // Reporting-Manager / Boss decide inbox is reached from the "Approvals" section, same as Leave.
  {
    label: "Advances",
    to: ROUTES.myAdvances,
    icon: Banknote,
    end: true,
    staffOnly: true,
    moduleCode: "advance",
  },

  {
    // Operational, staff-wise Advance Ledger — distinct from Settings -> Advance Settings
    // (ROUTES.advanceManagement, configuration only). adminOnly here means "not a plain staff
    // login", matching every advance_ledger_* RPC's own server-side rejection of current_user_role()
    // = 'staff' (see migration 0154) — hiding it from Staff here is UX only, not the real guard.
    label: "Advance Management",
    to: ROUTES.advanceLedger,
    icon: Receipt,
    adminOnly: true,
    moduleCode: "advance_management",
  },

  {
    label: "Reports",
    to: ROUTES.reports,
    icon: BarChart3,
    adminOnly: true,
    moduleCode: "reports",
  },

  // Attendance Rules — configuration; now reached from Settings → Settings Center
  // (route /settings/attendance-rules is unchanged and still works directly).

  {
    // Visibility for this one item is NOT governed by adminOnly/superAdminOnly below — it has its
    // own rule in visibleItems (Super Admin, OR a 'staff' account who is an active Operations
    // Manager / Super Manager). The flags here are unused for this item but kept false for clarity.
    // This is an OPERATIONAL decide inbox (not configuration) so it stays in the main sidebar.
    label: "Night Duty Approvals",
    to: ROUTES.nightDutyApprovals,
    icon: Moon,
    adminOnly: false,
    superAdminOnly: false,
  },

  // Night Duty Manager Access, User Management — configuration; now reached from Settings →
  // Settings Center (routes /attendance/night-duty-managers and /settings/user-management are
  // unchanged and still work directly).

  {
    // Single parent for all configuration. Opens the Settings Center; NavLink prefix-matching
    // keeps it highlighted while on any /settings/* configuration page.
    label: "Settings",
    to: ROUTES.settings,
    icon: Settings,
    adminOnly: true,
    moduleCode: "settings",
  },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  /** True while the mobile off-canvas drawer is open (md: and up ignore this — they always use the
   *  fixed desktop layout below). */
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export function Sidebar({ collapsed, onToggle, mobileOpen, onCloseMobile }: SidebarProps) {
  const { user } = useAuth();
  const isStaff = user?.role === "staff";
  const isSuperAdmin = user?.role === "super_admin";

  // Only resolved for 'staff' accounts (queries are no-ops otherwise via `enabled`) — determines
  // whether the "Night Duty Approvals" link should appear for this particular staff login, since
  // most staff are neither an Operations Manager nor a Super Manager.
  const currentEmployeeQuery = useCurrentEmployee(isStaff ? user?.email : undefined, isStaff ? user?.companyId : undefined, isStaff ? user?.id : undefined);
  const employeeId = isStaff ? currentEmployeeQuery.data?.id : undefined;
  const omStoresQuery = useMyOperationsManagerStores(employeeId);
  const amISuperManagerQuery = useAmISuperManager(employeeId);
  const isNightDutyManager = isStaff && ((omStoresQuery.data?.length ?? 0) > 0 || amISuperManagerQuery.data === true);

  // Dynamic Role & Permission System (migration 0161) — Menu Visibility (spec §20). Fetched once
  // for every module a nav item maps to; the hook defaults each entry to allowed=true while
  // loading or unconfigured (fail-open), so this NEVER hides an item until a Super Admin
  // explicitly denies VIEW for that module from Settings -> User & Role Permissions. This is a
  // UX affordance only — RequireModulePermission (router) and the RESTRICTIVE RLS policies
  // (migration 0162) are the real enforcement, exactly like every adminOnly/staffOnly item here.
  const moduleCodes = useMemo(
    () => Array.from(new Set(NAV_ITEMS.map((item) => ("moduleCode" in item ? item.moduleCode : undefined)).filter(Boolean))) as string[],
    []
  );
  const permissionsQuery = useMyPermissionsBulk(moduleCodes);
  const permissions = permissionsQuery.data;

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.to === ROUTES.nightDutyApprovals) {
      return isSuperAdmin || isNightDutyManager;
    }
    // Staff Panel's own Dashboard/Leave/Payslip & Documents/Profile — visible ONLY to a 'staff'
    // account, never cluttering the Admin sidebar (Admin has its own separate Dashboard/Employees
    // etc. already).
    if ("staffOnly" in item && item.staffOnly) {
      if (!isStaff) return false;
    } else if (!(!isStaff || !item.adminOnly) || (("superAdminOnly" in item) && item.superAdminOnly && !isSuperAdmin)) {
      return false;
    }
    if (!isSuperAdmin && "moduleCode" in item && item.moduleCode && permissions?.[item.moduleCode]?.VIEW === false) {
      return false;
    }
    return true;
  });

  const content = (isMobile: boolean) => (
    <>
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
          RH
        </div>

        {(!collapsed || isMobile) && (
          <div className="leading-tight">
            <p className="text-lg font-semibold">Retail HRMS</p>
            {isStaff && <p className="text-xs text-muted-foreground">Staff Panel</p>}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {visibleItems.map((item) => (
          <NavLink
            key={item.label}
            to={item.to}
            end={item.end}
            onClick={isMobile ? onCloseMobile : undefined}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" />

            {(!collapsed || isMobile) && <span className="truncate">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Collapse (desktop) / Close (mobile) */}
      <button
        onClick={isMobile ? onCloseMobile : onToggle}
        className="flex h-12 items-center justify-center gap-2 border-t text-sm text-muted-foreground hover:bg-accent"
      >
        {isMobile ? (
          <X className="h-4 w-4" />
        ) : collapsed ? (
          <ChevronsRight className="h-4 w-4" />
        ) : (
          <ChevronsLeft className="h-4 w-4" />
        )}
        {(!collapsed || isMobile) && (isMobile ? "Close" : "Collapse")}
      </button>
    </>
  );

  return (
    <>
      {/* Mobile off-canvas drawer — independent of the desktop <aside> below, so a resize while
          open can never hide the desktop sidebar. Backdrop lives in DashboardLayout. */}
      {mobileOpen && (
        <aside className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-card shadow-lg md:hidden">
          {content(true)}
        </aside>
      )}

      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r bg-card transition-all duration-200 md:flex",
          collapsed ? "w-[72px]" : "w-64"
        )}
      >
        {content(false)}
      </aside>
    </>
  );
}
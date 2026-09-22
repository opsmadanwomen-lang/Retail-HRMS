import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { useEmployee } from "@/hooks/useEmployees";

const LABELS: Record<string, string> = {
  employees: "Employees",
  companies: "Companies",
  new: "New",
  stores: "Stores",
  organization: "Organization",
  settings: "Settings",
  profile: "Profile",
  documents: "Documents",
  import: "Import",

  // Settings Center configuration pages — readable "Settings > …" hierarchy for the existing
  // (unchanged) routes. Slugs like "attendance-rules" would otherwise show raw in the breadcrumb.
  "attendance-rules": "Attendance Rules",
  "leave-policies": "Leave Settings",
  "leave-settlement": "Leave Settlement",
  "leave-reports": "Leave Reports",
  "advance-management": "Advance Settings",
  "user-management": "User Management",
  payroll: "Payroll",
  "salary-structure": "Payroll Settings",
  shifts: "Shift Management",
  schedule: "Employee Schedule",
  attendance: "Attendance",
  "night-duty-managers": "Night Duty Manager Access",
  "night-duty-approvals": "Night Duty Approvals",
  advance: "Advance",
  // Operational, staff-wise Advance Ledger (main sidebar "Advance Management", route
  // /advance/ledger) — distinct from "advance-management" above, which is the Settings ->
  // Advance Settings configuration page.
  ledger: "Advance Management",
  leave: "Leave",
  reports: "Reports",
  fnf: "Full & Final Settlement",
  "pf-esi-amounts": "PF / ESI Amount Input",
  "exit-fnf": "Exit / F&F Settings",
  "exit-requests": "Exit Requests",
  transfers: "Employee Transfers",
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

/**
 * Configuration pages reached from the Settings Center. Their ROUTES are unchanged — this is a
 * breadcrumb-presentation override ONLY: each renders "Settings > <Label>" regardless of where its
 * URL actually sits (e.g. /payroll/salary-structure, /shifts, /attendance/night-duty-managers).
 * Operational pages are NOT listed here and keep their normal URL-derived hierarchy.
 * Keyed by exact pathname (leading slash, no trailing slash).
 */
const SETTINGS_CONFIG_PAGES: Record<string, string> = {
  "/settings/user-management": "User Management",
  "/settings/attendance-rules": "Attendance Rules",
  "/settings/leave-policies": "Leave Settings",
  "/settings/advance-management": "Advance Settings",
  "/payroll/salary-structure": "Payroll Settings",
  "/shifts": "Shift Management",
  "/schedule": "Employee Schedule",
  "/attendance/night-duty-managers": "Night Duty Manager Access",
  "/settings/exit-fnf": "Exit / F&F Settings",
};

export function Breadcrumbs() {
  const { pathname } = useLocation();

  const segments = pathname.split("/").filter(Boolean);

  /*
   * URL:
   * /employees/employee-id
   *
   * employeeId = second segment
   */
  const employeeId =
    segments[0] === "employees" && segments.length >= 2
      ? segments[1]
      : undefined;

  /*
   * Employee ka actual naam fetch karega
   */
  const { data: employee } = useEmployee(
    isUuid(employeeId ?? "") ? employeeId : undefined
  );

  // Settings-Center configuration pages: force the "Settings > <page>" hierarchy regardless of where
  // the URL actually sits. Placed AFTER every hook call above (never a conditional hook). None of
  // these paths carry a UUID, so the UUID suppression in the generic renderer below is unaffected.
  const configLabel = SETTINGS_CONFIG_PAGES["/" + segments.join("/")];
  if (configLabel) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/" className="flex items-center hover:text-foreground">
          <Home className="h-4 w-4" />
        </Link>
        <div className="flex items-center gap-2">
          <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
          <Link to="/settings" className="hover:text-foreground">
            Settings
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
          <span className="font-medium text-foreground">{configLabel}</span>
        </div>
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Home className="h-4 w-4" />
        <span>Dashboard</span>
      </div>
    );
  }

  let acc = "";

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      {/* Home */}
      <Link
        to="/"
        className="flex items-center hover:text-foreground"
      >
        <Home className="h-4 w-4" />
      </Link>

      {segments.map((seg, i) => {
        acc += `/${seg}`;

        const isLast = i === segments.length - 1;

        let label = LABELS[seg] ?? decodeURIComponent(seg);

        /*
         * Agar URL me Employee UUID hai,
         * to UUID ki jagah employee ka actual naam show hoga.
         */
        if (isUuid(seg)) {
          label = employee?.fullName ?? "Employee";
        }

        return (
          <div
            key={`${seg}-${i}`}
            className="flex items-center gap-2"
          >
            <ChevronRight className="h-4 w-4 text-muted-foreground/50" />

            {isLast ? (
              <span className="font-medium text-foreground">
                {label}
              </span>
            ) : (
              <Link
                to={acc}
                className="hover:text-foreground"
              >
                {label}
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
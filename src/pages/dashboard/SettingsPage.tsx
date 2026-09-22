import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Users,
  UserCog,
  CalendarClock,
  CalendarCog,
  SlidersHorizontal,
  CalendarDays,
  Wallet,
  Banknote,
  Moon,
  UserMinus,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useMyPermissionsBulk } from "@/hooks/usePermissions";
import { ROUTES } from "@/constants/routes";

/**
 * Settings Center — the single entry point for every configuration area. This is a NAVIGATION /
 * information-architecture surface only: each card opens an EXISTING settings page at its EXISTING
 * route. No page, service, hook, route or permission was rebuilt.
 *
 * Card visibility mirrors the permission each destination page already enforces itself (a Super-Admin
 * `isSuperAdmin` gate, or simply "any admin" for the two that only need AdminOnlyRoute). This is a
 * UX affordance — the router guard + the page's own gate + backend RLS remain authoritative; typing
 * a restricted URL directly still hits those.
 */
type SettingsCard = {
  title: string;
  description: string;
  to: string;
  icon: LucideIcon;
  /** true => Super Admin only; false => any non-staff admin. */
  superAdminOnly: boolean;
  /** Dynamic Role & Permission System (migration 0164) module code, when this card has a 1:1
   *  match in the catalog — an ADDITIONAL visibility check on top of superAdminOnly above, same
   *  fail-open-until-configured pattern as Sidebar.tsx. Omitted cards are unaffected. */
  moduleCode?: string;
};

const CARDS: SettingsCard[] = [
  {
    title: "User Management",
    description: "Create and manage user logins, roles and store access.",
    to: ROUTES.userManagement,
    icon: Users,
    superAdminOnly: true,
    moduleCode: "user_management",
  },
  {
    title: "User & Role Permissions",
    description: "Configure which modules, tabs, actions and sensitive fields each role or individual user can access — enforced on the backend, not just hidden in the UI.",
    to: ROUTES.userPermissions,
    icon: ShieldCheck,
    superAdminOnly: true,
    moduleCode: "permission_management",
  },
  {
    title: "Shift Management",
    description: "Configure shifts, timings, breaks and shift rules.",
    to: ROUTES.shifts,
    icon: CalendarClock,
    superAdminOnly: false,
    moduleCode: "shift_management",
  },
  {
    title: "Employee Schedule",
    description: "Configure employee schedules, roster and scheduling rules.",
    to: ROUTES.employeeSchedule,
    icon: CalendarCog,
    superAdminOnly: false,
    moduleCode: "employee_schedule",
  },
  {
    title: "Attendance Rules",
    description:
      "Configure late, overtime, weekly off, information, penalty, half-day, early-going and extended-duty rules.",
    to: ROUTES.attendanceRules,
    icon: SlidersHorizontal,
    superAdminOnly: true,
    moduleCode: "attendance_rules",
  },
  {
    title: "Leave Settings",
    description:
      "Configure financial years, leave types, policies, accrual, probation, carry forward, approval and related leave rules.",
    to: ROUTES.leavePolicies,
    icon: CalendarDays,
    superAdminOnly: true,
    moduleCode: "leave_settings",
  },
  {
    title: "Payroll Settings",
    description:
      "Configure salary structures, salary components, payroll policies, statutory rules, TDS, PT, PF, ESI, rounding, payroll calendars and related payroll configuration.",
    to: ROUTES.salaryStructure,
    icon: Wallet,
    superAdminOnly: true,
    moduleCode: "payroll_settings",
  },
  {
    title: "Advance Settings",
    description:
      "Configure advance types, policies, approval hierarchy, HR processing, finance processing and recovery settings.",
    to: ROUTES.advanceManagement,
    icon: Banknote,
    superAdminOnly: true,
    moduleCode: "advance_settings",
  },
  {
    title: "Night Duty Manager Access",
    description: "Configure manager access and permissions for Night Duty.",
    to: ROUTES.nightDutyManagers,
    icon: Moon,
    superAdminOnly: true,
    moduleCode: "night_duty_manager_access",
  },
  {
    title: "Exit / F&F Settings",
    description:
      "Configure exit / F&F approvers, the notice-pay policy (period, recovery basis, divisor, waiver) and F&F behaviour (advance recovery mode, auto-inactivation on close).",
    to: ROUTES.exitFnfSettings,
    icon: UserMinus,
    superAdminOnly: true,
  },
];

const SETTINGS_MODULE_CODES = CARDS.map((c) => c.moduleCode).filter((c): c is string => Boolean(c));

export function SettingsPage() {
  const { user } = useAuth();
  const isStaff = user?.role === "staff";
  const isSuperAdmin = user?.role === "super_admin";
  const [query, setQuery] = useState("");

  // Dynamic Role & Permission System — fails open (undefined/true) while loading or
  // unconfigured, so this changes nothing until a Super Admin explicitly denies VIEW.
  const permissionsQuery = useMyPermissionsBulk(SETTINGS_MODULE_CODES);
  const permissions = permissionsQuery.data;

  const visibleCards = useMemo(() => {
    const allowed = CARDS.filter((card) => {
      if (card.superAdminOnly ? !isSuperAdmin : isStaff) return false;
      if (!isSuperAdmin && card.moduleCode && permissions?.[card.moduleCode]?.VIEW === false) return false;
      return true;
    });
    const q = query.trim().toLowerCase();
    if (!q) return allowed;
    return allowed.filter(
      (card) => card.title.toLowerCase().includes(q) || card.description.toLowerCase().includes(q),
    );
  }, [isStaff, isSuperAdmin, query, permissions]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage your HRMS configuration and system preferences."
      />

      {CARDS.some((card) => (card.superAdminOnly ? isSuperAdmin : !isStaff)) ? (
        <>
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search settings…"
              className="pl-9"
              aria-label="Search settings"
            />
          </div>

          {visibleCards.length === 0 ? (
            <EmptyState icon={Search} title="No matching settings" description="Try a different search term." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleCards.map((card) => (
                <Link key={card.to} to={card.to} className="group">
                  <Card className="h-full transition-colors hover:border-primary/50">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <card.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1">{card.title}</span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </CardTitle>
                      <CardDescription>{card.description}</CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </>
      ) : (
        <EmptyState
          icon={UserCog}
          title="Nothing here yet"
          description="Company-wide configuration is managed by your Super Admin. Contact them for account or workspace changes."
        />
      )}
    </div>
  );
}

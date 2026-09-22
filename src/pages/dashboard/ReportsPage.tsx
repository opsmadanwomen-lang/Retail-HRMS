import { Link } from "react-router-dom";
import { ArrowRight, BarChart3, CalendarDays, Gauge, LineChart } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { ROUTES } from "@/constants/routes";

/**
 * Reports — operational reporting hub. Previously the sidebar's "Reports" link pointed at
 * ROUTES.reports (`/reports`) but AppRouter had NO route for it, so the catch-all
 * `<Route path="*" element={<Navigate to="/" />} />` redirected `/reports` → `/` (Dashboard).
 *
 * This page is a lightweight navigation surface only: each card opens an EXISTING, already-routed
 * reporting page at its EXISTING route. No report query, calculation, permission or RLS was added
 * or changed — each card is shown only when the current user matches the same gate the destination
 * page already enforces itself (and the router guard + page gate + backend RLS stay authoritative).
 */
type ReportCard = {
  title: string;
  description: string;
  to: string;
  icon: LucideIcon;
  /** true => Super Admin only (matches the destination page's own gate); false => any non-staff admin. */
  superAdminOnly: boolean;
};

const CARDS: ReportCard[] = [
  {
    title: "Leave Reports",
    description:
      "Company-wide leave reporting — balances, ledgers, applications, approvals, monthly summaries and audit trail.",
    to: ROUTES.leaveReports,
    icon: CalendarDays,
    superAdminOnly: true,
  },
  {
    title: "Performance Summary",
    description: "Role / employee KPI performance summary.",
    to: ROUTES.performanceSummary,
    icon: Gauge,
    superAdminOnly: false,
  },
  {
    title: "Performance Dashboard",
    description: "Performance-data analytics and trends.",
    to: ROUTES.performanceDashboard,
    icon: LineChart,
    superAdminOnly: false,
  },
];

export function ReportsPage() {
  const { user } = useAuth();
  const isStaff = user?.role === "staff";
  const isSuperAdmin = user?.role === "super_admin";

  const visibleCards = CARDS.filter((card) => (card.superAdminOnly ? isSuperAdmin : !isStaff));

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Operational reporting across the HRMS." />

      {visibleCards.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No reports available"
          description="Company-wide reports are available to your Super Admin."
        />
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
    </div>
  );
}

import { useState } from "react";
import { Search, Bell, Moon, LogOut, Menu } from "lucide-react";
import { Breadcrumbs } from "./Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/common/EmptyState";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentEmployee } from "@/hooks/useAttendance";
import { useAmISuperManager, useMyOperationsManagerStores } from "@/hooks/useExtendedAttendanceRules";
import { useMyLeaveNotifications, useUnreadLeaveNotificationCount, useMarkNotificationRead, useMarkAllNotificationsRead } from "@/hooks/useLeave";
import { initialsFromName, formatDate } from "@/lib/utils";

/**
 * A 'staff' login may actually be an Operations Manager (store-scoped) or Super Manager (company-
 * wide) — real authority granted through the EXISTING attendance_operations_manager_assignments /
 * attendance_super_managers tables (see NightDutyManagerAccessPage.tsx), not a distinct
 * profiles.role value. This shows that real, server-verified status here instead of the generic
 * "Staff" label — the exact same lookup Sidebar.tsx already uses to decide Night Duty Approvals
 * visibility, never a second/parallel computation.
 */
function useDisplayRole(): string {
  const { user } = useAuth();
  const isStaff = user?.role === "staff";
  const currentEmployeeQuery = useCurrentEmployee(isStaff ? user?.email : undefined, isStaff ? user?.companyId : undefined, isStaff ? user?.id : undefined);
  const employeeId = isStaff ? currentEmployeeQuery.data?.id : undefined;
  const omStoresQuery = useMyOperationsManagerStores(employeeId);
  const amISuperManagerQuery = useAmISuperManager(employeeId);

  if (!user) return "";
  if (isStaff && amISuperManagerQuery.data === true) return "Super Manager";
  if (isStaff && (omStoresQuery.data?.length ?? 0) > 0) return "Operations Manager";
  return user.role.replace("_", " ");
}

/** Leave notifications only (Phase 4) — the one real, delivered channel (In-App); Push/Email/SMS
 *  remain configuration-only toggles with no delivery behind them (see Leave Settlement page). */
function NotificationBell() {
  const [open, setOpen] = useState(false);
  const unreadQuery = useUnreadLeaveNotificationCount();
  const notificationsQuery = useMyLeaveNotifications(30);
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const unread = unreadQuery.data ?? 0;

  return (
    <>
      <Button variant="ghost" size="icon" className="relative" onClick={() => setOpen(true)} title="Notifications">
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>Notifications</DialogTitle>
              {unread > 0 && (
                <Button variant="ghost" size="sm" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
                  Mark all read
                </Button>
              )}
            </div>
          </DialogHeader>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {notificationsQuery.isLoading ? (
              <p className="p-4 text-center text-sm text-muted-foreground">Loading…</p>
            ) : (notificationsQuery.data ?? []).length === 0 ? (
              <EmptyState icon={Bell} title="No notifications" description="Leave-related updates will appear here." />
            ) : (
              (notificationsQuery.data ?? []).map((n) => (
                <button
                  key={n.id}
                  onClick={() => !n.isRead && markRead.mutate(n.id)}
                  className={`w-full rounded-lg border p-3 text-left text-sm transition-colors ${n.isRead ? "bg-transparent" : "bg-accent/50"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-foreground">{n.title}</p>
                    {!n.isRead && <Badge variant="default" className="text-[10px]">New</Badge>}
                  </div>
                  {n.body ? <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p> : null}
                  <p className="mt-1 text-[11px] text-muted-foreground">{formatDate(n.createdAt)}</p>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Header({ onOpenMobileNav }: { onOpenMobileNav?: () => void }) {
  const { user, signOut } = useAuth();
  const displayRole = useDisplayRole();

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-4 border-b bg-background/80 px-4 backdrop-blur sm:px-6">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={onOpenMobileNav} title="Open navigation">
        <Menu className="h-4 w-4" />
      </Button>

      <div className="hidden sm:block">
        <Breadcrumbs />
      </div>

      <div className="relative ml-auto hidden max-w-sm flex-1 md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search…" className="pl-9" disabled />
      </div>

      <div className="ml-auto flex items-center gap-1 sm:ml-0">
        <Button variant="ghost" size="icon" disabled title="Theme toggle (coming soon)">
          <Moon className="h-4 w-4" />
        </Button>
        <NotificationBell />

        <div className="mx-2 hidden h-6 w-px bg-border sm:block" />

        <div className="flex items-center gap-2 pl-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {user ? initialsFromName(user.fullName) : "—"}
          </div>
          <div className="hidden leading-tight sm:block">
            <p className="text-sm font-medium">{user?.fullName ?? "Loading…"}</p>
            <p className="text-xs capitalize text-muted-foreground">{displayRole}</p>
          </div>
        </div>

        <Button variant="ghost" size="icon" onClick={signOut} title="Sign out">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}

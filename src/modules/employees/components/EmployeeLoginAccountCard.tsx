import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Lock, Unlock, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabaseClient";
import { staffAccountService, type StaffAccountCredentials } from "@/services/staffAccountService";
import { StaffAccountCredentialsDialog } from "./StaffAccountCredentialsDialog";
import type { Employee } from "@/types/employee";

interface EmployeeLoginAccountCardProps {
  employee: Employee;
}

export function EmployeeLoginAccountCard({ employee }: EmployeeLoginAccountCardProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === "company_admin" || user?.role === "super_admin";
  const queryClient = useQueryClient();

  const [credentials, setCredentials] = useState<StaffAccountCredentials | null>(null);
  const [pendingAction, setPendingAction] = useState<"create" | "reset" | "disable" | "enable" | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);

  const loginStatusQuery = useQuery({
    queryKey: ["employee-login-status", employee.authUserId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("is_active")
        .eq("id", employee.authUserId as string)
        .maybeSingle();
      if (error) throw error;
      return data?.is_active ?? null;
    },
    enabled: Boolean(employee.authUserId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["employees", "detail", employee.id] });
    queryClient.invalidateQueries({ queryKey: ["employee-login-status", employee.authUserId] });
  };

  const runAction = async (action: "create" | "reset" | "disable" | "enable") => {
    setPendingAction(action);
    try {
      if (action === "create") {
        const result = await staffAccountService.createAccount(employee.id);
        setCredentials(result);
      } else if (action === "reset") {
        const result = await staffAccountService.resetPassword(employee.id);
        setCredentials(result);
      } else if (action === "disable") {
        await staffAccountService.disableAccount(employee.id);
        toast({ title: "Login disabled", description: "This employee can no longer sign in.", variant: "success" });
      } else {
        await staffAccountService.enableAccount(employee.id);
        toast({ title: "Login enabled", variant: "success" });
      }
      invalidate();
    } catch (error) {
      toast({
        title: "Action failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPendingAction(null);
    }
  };

  const hasAccount = Boolean(employee.authUserId);
  const isActive = loginStatusQuery.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4" />
          Login Account
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Status:</span>
            {!hasAccount ? (
              <Badge variant="secondary">Not Created</Badge>
            ) : isActive === false ? (
              <Badge variant="destructive">Disabled</Badge>
            ) : (
              <Badge variant="success">Active</Badge>
            )}
          </div>
          {hasAccount ? <p className="text-sm text-muted-foreground">Login ID: {employee.employeeCode ?? "—"}</p> : null}
        </div>

        {isAdmin ? (
          <div className="flex flex-wrap gap-2">
            {!hasAccount ? (
              <Button size="sm" onClick={() => runAction("create")} disabled={pendingAction !== null}>
                <UserPlus className="mr-2 h-4 w-4" />
                {pendingAction === "create" ? "Creating…" : "Create Login"}
              </Button>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={() => setConfirmReset(true)} disabled={pendingAction !== null}>
                  <KeyRound className="mr-2 h-4 w-4" />
                  Reset Password
                </Button>
                {isActive === false ? (
                  <Button size="sm" variant="outline" onClick={() => runAction("enable")} disabled={pendingAction !== null}>
                    <Unlock className="mr-2 h-4 w-4" />
                    {pendingAction === "enable" ? "Enabling…" : "Enable Login"}
                  </Button>
                ) : (
                  <Button size="sm" variant="destructive" onClick={() => setConfirmDisable(true)} disabled={pendingAction !== null}>
                    <Lock className="mr-2 h-4 w-4" />
                    Disable Login
                  </Button>
                )}
              </>
            )}
          </div>
        ) : null}
      </CardContent>

      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password?</DialogTitle>
            <DialogDescription>
              This generates a new temporary password and immediately invalidates the current one. The employee will
              be asked to change it on their next login.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmReset(false)} disabled={pendingAction !== null}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConfirmReset(false);
                runAction("reset");
              }}
              disabled={pendingAction !== null}
            >
              {pendingAction === "reset" ? "Resetting…" : "Reset Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDisable} onOpenChange={setConfirmDisable}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable Login?</DialogTitle>
            <DialogDescription>
              This only prevents sign-in — the employee record and their attendance history are not affected and can
              be re-enabled at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDisable(false)} disabled={pendingAction !== null}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmDisable(false);
                runAction("disable");
              }}
              disabled={pendingAction !== null}
            >
              {pendingAction === "disable" ? "Disabling…" : "Disable Login"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StaffAccountCredentialsDialog credentials={credentials} onClose={() => setCredentials(null)} />
    </Card>
  );
}

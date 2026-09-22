import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRemoveRoleAssignment } from "@/hooks/useEmployeeRoles";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import type { EmployeeRole } from "@/types/role";

interface RemoveRoleDialogProps {
  employeeRole: EmployeeRole | null;
  onOpenChange: (open: boolean) => void;
}

export function RemoveRoleDialog({ employeeRole, onOpenChange }: RemoveRoleDialogProps) {
  const { user } = useAuth();
  const [reason, setReason] = useState("");
  const removeAssignment = useRemoveRoleAssignment();

  const handleConfirm = async () => {
    if (!employeeRole) return;
    try {
      await removeAssignment.mutateAsync({
        employeeRoleId: employeeRole.id,
        employeeId: employeeRole.employeeId,
        reason: reason || undefined,
        removedBy: user?.id,
      });
      toast({ title: "Role removed", variant: "success" });
      setReason("");
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not remove role",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={Boolean(employeeRole)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove this responsibility?</DialogTitle>
          <DialogDescription>
            {employeeRole?.roleName} will be marked inactive for this employee. This is recorded in Role History.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label>Reason (optional)</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being removed?" />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={removeAssignment.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={removeAssignment.isPending}>
            {removeAssignment.isPending ? "Removing…" : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

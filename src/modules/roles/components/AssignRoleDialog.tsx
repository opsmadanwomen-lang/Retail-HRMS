import { useMemo } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { assignRoleFormSchema, type AssignRoleFormSchema } from "../schema";
import { useRoles } from "@/hooks/useRoles";
import { useRoleStatuses } from "@/hooks/useRoleLookups";
import { useActiveEmployeeRoles, useAssignRole } from "@/hooks/useEmployeeRoles";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";

interface AssignRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  storeId: string;
  companyId: string;
}

export function AssignRoleDialog({ open, onOpenChange, employeeId, storeId, companyId }: AssignRoleDialogProps) {
  const { user } = useAuth();
  const { data: roles } = useRoles({ companyId, isActive: true });
  const { data: statuses } = useRoleStatuses();
  const { data: activeRoles } = useActiveEmployeeRoles(employeeId);
  const assignRole = useAssignRole();

  const heldRoleIds = useMemo(() => new Set((activeRoles ?? []).map((r) => r.roleId)), [activeRoles]);
  const availableRoles = (roles ?? []).filter((r) => !heldRoleIds.has(r.id));

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AssignRoleFormSchema>({
    resolver: zodResolver(assignRoleFormSchema),
    defaultValues: { effectiveDate: new Date().toISOString().slice(0, 10) },
  });

  const onSubmit = async (values: AssignRoleFormSchema) => {
    try {
      await assignRole.mutateAsync({
        employeeId,
        storeId,
        companyId,
        values,
        assignedBy: user?.id,
      });
      toast({ title: "Role assigned", variant: "success" });
      reset();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not assign role",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign a Role</DialogTitle>
          <DialogDescription>Add an additional responsibility for this employee.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              Role <span className="text-destructive">*</span>
            </Label>
            <Controller
              name="roleId"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRoles.map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        {role.roleName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.roleId && <p className="text-xs text-destructive">{errors.roleId.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>
              Status <span className="text-destructive">*</span>
            </Label>
            <Controller
              name="statusId"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a status" />
                  </SelectTrigger>
                  <SelectContent>
                    {(statuses ?? []).map((status) => (
                      <SelectItem key={status.id} value={status.id}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.statusId && <p className="text-xs text-destructive">{errors.statusId.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>
                Effective Date <span className="text-destructive">*</span>
              </Label>
              <Input type="date" {...register("effectiveDate")} />
              {errors.effectiveDate && <p className="text-xs text-destructive">{errors.effectiveDate.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>End Date</Label>
              <Input type="date" {...register("endDate")} />
              {errors.endDate && <p className="text-xs text-destructive">{errors.endDate.message}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Remarks</Label>
            <Textarea placeholder="Optional notes about this assignment…" {...register("remarks")} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || availableRoles.length === 0}>
              {isSubmitting ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmployeeTaskTable } from "../components/EmployeeTaskTable";
import { TaskSubmissionDialog } from "../components/TaskSubmissionDialog";
import { TaskVerificationDialog } from "../components/TaskVerificationDialog";
import { assignTaskFormSchema, type AssignTaskFormSchema, TASK_PRIORITY_OPTIONS } from "../schema";
import { useEmployees } from "@/hooks/useEmployees";
import { useTasks } from "@/hooks/useTasks";
import { useTaskStatuses } from "@/hooks/useTaskLookups";
import { useAssignTask, useEmployeeTasks, useCancelTaskAssignment, useTaskSubmissions } from "@/hooks/useEmployeeTask";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";
import type { EmployeeTaskAssignment } from "@/types/task";

export function TaskAssignmentPage() {
  const { user } = useAuth();
  const [employeeId, setEmployeeId] = useState("");
  const [submittingAssignment, setSubmittingAssignment] = useState<EmployeeTaskAssignment | null>(null);
  const [verifyingAssignment, setVerifyingAssignment] = useState<EmployeeTaskAssignment | null>(null);

  const { data: employees } = useEmployees({ companyId: user?.companyId ?? undefined });
  const selectedEmployee = (employees ?? []).find((e) => e.id === employeeId);

  const { data: tasks } = useTasks({ companyId: user?.companyId ?? undefined, isActive: true });
  const { data: statuses } = useTaskStatuses();
  const { data: assignments } = useEmployeeTasks(employeeId || undefined);
  const { data: verifyingSubmissions } = useTaskSubmissions(verifyingAssignment?.id);
  const assignTask = useAssignTask();
  const cancelAssignment = useCancelTaskAssignment();

  const assignedTaskIds = useMemo(() => new Set((assignments ?? []).map((a) => a.taskId)), [assignments]);
  const availableTasks = (tasks ?? []).filter((t) => !assignedTaskIds.has(t.id));

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AssignTaskFormSchema>({
    resolver: zodResolver(assignTaskFormSchema),
    defaultValues: { priority: "medium", dueDate: new Date().toISOString().slice(0, 10) },
  });

  const onSubmit = async (values: AssignTaskFormSchema) => {
    if (!selectedEmployee) return;
    if (!selectedEmployee.storeId) {
      toast({ title: "Not applicable", description: "Task assignment applies to Store Specific employees only.", variant: "destructive" });
      return;
    }
    try {
      await assignTask.mutateAsync({
        employeeId: selectedEmployee.id,
        roleId: null,
        storeId: selectedEmployee.storeId,
        companyId: selectedEmployee.companyId,
        values,
        assignedBy: user?.id,
      });
      toast({ title: "Task assigned", variant: "success" });
      reset({ priority: "medium", dueDate: new Date().toISOString().slice(0, 10) });
    } catch (error) {
      toast({
        title: "Could not assign task",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleCancel = async (assignment: EmployeeTaskAssignment) => {
    try {
      await cancelAssignment.mutateAsync({
        assignmentId: assignment.id,
        employeeId: assignment.employeeId,
        userId: user?.id,
      });
      toast({ title: "Assignment cancelled", variant: "success" });
    } catch (error) {
      toast({
        title: "Could not cancel assignment",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const latestVerifyingSubmission = (verifyingSubmissions ?? [])[0] ?? null;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="w-fit">
        <Link to={ROUTES.tasks}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Task Master
        </Link>
      </Button>

      <PageHeader title="Task Assignment" description="Assign a task to an employee with a due date and priority." />

      <Card>
        <CardHeader>
          <CardTitle>1. Select Employee</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger className="max-w-sm">
              <SelectValue placeholder="Search and select an employee" />
            </SelectTrigger>
            <SelectContent>
              {(employees ?? []).map((emp) => (
                <SelectItem key={emp.id} value={emp.id}>
                  {emp.fullName} {emp.employeeCode ? `(${emp.employeeCode})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedEmployee && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>2. Assign Task</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
                <div className="space-y-1.5">
                  <Label>
                    Task <span className="text-destructive">*</span>
                  </Label>
                  <Controller
                    name="taskId"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a task" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableTasks.map((task) => (
                            <SelectItem key={task.id} value={task.id}>
                              {task.taskName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {errors.taskId && <p className="text-xs text-destructive">{errors.taskId.message}</p>}
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

                <div className="space-y-1.5">
                  <Label>Priority</Label>
                  <Controller
                    name="priority"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TASK_PRIORITY_OPTIONS.map((p) => (
                            <SelectItem key={p} value={p} className="capitalize">
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>
                      Due Date <span className="text-destructive">*</span>
                    </Label>
                    <Input type="date" {...register("dueDate")} />
                    {errors.dueDate && <p className="text-xs text-destructive">{errors.dueDate.message}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Due Time</Label>
                    <Input type="time" {...register("dueTime")} />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button type="submit" disabled={isSubmitting || availableTasks.length === 0}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Current Tasks</CardTitle>
            </CardHeader>
            <CardContent>
              {!assignments || assignments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks assigned yet.</p>
              ) : (
                <EmployeeTaskTable
                  assignments={assignments}
                  onSubmit={setSubmittingAssignment}
                  onVerify={setVerifyingAssignment}
                  onCancel={handleCancel}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}

      {selectedEmployee && (
        <TaskSubmissionDialog
          assignment={submittingAssignment}
          companyId={selectedEmployee.companyId}
          onOpenChange={(open) => !open && setSubmittingAssignment(null)}
        />
      )}
      <TaskVerificationDialog
        assignment={verifyingAssignment}
        submission={latestVerifyingSubmission}
        onOpenChange={(open) => !open && setVerifyingAssignment(null)}
      />
    </div>
  );
}

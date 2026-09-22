import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Pencil, ArrowLeft, Calendar, TrendingUp, ArrowRightLeft, User as UserIcon, PlusCircle, ShieldCheck, ShieldAlert, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmployeeStatusBadge } from "../components/EmployeeStatusBadge";
import { EmployeeDocumentUploader } from "../components/EmployeeDocumentUploader";
import { EmployeeTransferHistory } from "../components/EmployeeTransferHistory";
import { EmployeePromotionHistory } from "../components/EmployeePromotionHistory";
import { EmployeeLoginAccountCard } from "../components/EmployeeLoginAccountCard";
import { EmployeeCurrentSalaryCard } from "../components/EmployeeCurrentSalaryCard";
import { ResponsibilityCard } from "@/modules/roles/components/ResponsibilityCard";
import { AssignRoleDialog } from "@/modules/roles/components/AssignRoleDialog";
import { RemoveRoleDialog } from "@/modules/roles/components/RemoveRoleDialog";
import { EmployeeKpiTable } from "@/modules/kpi/components/EmployeeKpiTable";
import { AssignKpiDialog } from "@/modules/kpi/components/AssignKpiDialog";
import { KpiTargetDialog } from "@/modules/kpi/components/KpiTargetDialog";
import { KpiActualDialog } from "@/modules/kpi/components/KpiActualDialog";
import { EmployeeTaskTable } from "@/modules/tasks/components/EmployeeTaskTable";
import { AssignTaskDialog } from "@/modules/tasks/components/AssignTaskDialog";
import { TaskSubmissionDialog } from "@/modules/tasks/components/TaskSubmissionDialog";
import { TaskVerificationDialog } from "@/modules/tasks/components/TaskVerificationDialog";
import { useEmployee } from "@/hooks/useEmployees";
import { useEmployeeGrades } from "@/hooks/usePayroll";
import { gradeLabelMap } from "../gradeOptions";
import { useDirectReports, useAddEmployeeNote, useEmployeeNotes } from "@/hooks/useEmployeeNotes";
import { useActiveEmployeeRoles, useEmployeeRoleHistory } from "@/hooks/useEmployeeRoles";
import { useEmployeeKpiAssignments, useSyncKpiFromRole, useRemoveEmployeeKpiAssignment } from "@/hooks/useEmployeeKpi";
import {
  useEmployeeTasks,
  useCancelTaskAssignment,
  useTaskSubmissions,
  useTaskHistory,
  useTaskComments,
  useAddTaskComment,
} from "@/hooks/useEmployeeTask";
import { useTaskChecklists } from "@/hooks/useTaskChecklist";
import { usePerformanceEntries } from "@/hooks/usePerformanceEntries";
import { EntryTable } from "@/modules/performance-data/components/EntryTable";
import { useAuth } from "@/hooks/useAuth";
import { useHasFieldPermission, useHasPermission } from "@/hooks/usePermissions";
import { auditService } from "@/services/auditService";
import { useQuery } from "@tanstack/react-query";
import { formatDate, initialsFromName } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";
import type { EmployeeRole } from "@/types/role";
import type { EmployeeKpiAssignment } from "@/types/kpi";
import type { EmployeeTaskAssignment } from "@/types/task";

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between border-b py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value || "—"}</span>
    </div>
  );
}

/** Read-only SOP reference for one assigned task's checklist(s). */
function SopSection({ assignment }: { assignment: EmployeeTaskAssignment }) {
  const { data: checklists } = useTaskChecklists(assignment.taskId);
  const items = (checklists ?? []).flatMap((c) => c.items);

  return (
    <div className="rounded-lg border p-4">
      <p className="mb-2 font-medium">{assignment.taskName}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No SOP checklist defined for this task.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              <span className="text-muted-foreground">☐</span>
              <span>{item.itemName}</span>
              {item.isMandatory && <span className="text-xs text-destructive">Mandatory</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Checklist completion progress for one assigned task, from its latest submission. */
function ChecklistStatusSection({
  assignment,
  onComplete,
}: {
  assignment: EmployeeTaskAssignment;
  onComplete: (assignment: EmployeeTaskAssignment) => void;
}) {
  const { data: checklists } = useTaskChecklists(assignment.taskId);
  const { data: submissions } = useTaskSubmissions(assignment.id);
  const mandatoryItems = (checklists ?? []).flatMap((c) => c.items).filter((i) => i.isMandatory);
  const latestSubmission = (submissions ?? [])[0];
  const checkedIds = new Set(
    (latestSubmission?.checklistResponses ?? []).filter((r) => r.checked).map((r) => r.itemId)
  );
  const completedCount = mandatoryItems.filter((i) => checkedIds.has(i.id)).length;

  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div>
        <p className="font-medium">{assignment.taskName}</p>
        <p className="text-sm text-muted-foreground">
          {mandatoryItems.length === 0
            ? "No mandatory checklist items."
            : `${completedCount} / ${mandatoryItems.length} mandatory items complete`}
        </p>
      </div>
      {!latestSubmission && (
        <Button variant="outline" size="sm" onClick={() => onComplete(assignment)}>
          Complete Checklist
        </Button>
      )}
    </div>
  );
}

export function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  // Dynamic Role & Permission System (migration 0161) — field-level access (spec §15). Fails
  // open (true) while loading or unconfigured, exactly like every other dynamic-permission check
  // in this app, so this changes nothing until a Super Admin explicitly restricts a field.
  const canViewFullName = useHasFieldPermission("employee", "full_name").allowed;
  const canViewMobile = useHasFieldPermission("employee", "mobile").allowed;
  const canViewEmail = useHasFieldPermission("employee", "email").allowed;
  const canViewJoiningDate = useHasFieldPermission("employee", "joining_date").allowed;
  const canViewDocumentsTab = useHasPermission("employee_documents", "VIEW").allowed;
  const { data: employee, isLoading } = useEmployee(id);
  const { data: grades } = useEmployeeGrades(employee?.companyId);
  const gradeText = useMemo(
    () => (employee?.gradeId ? gradeLabelMap(grades ?? []).get(employee.gradeId) ?? null : null),
    [grades, employee?.gradeId]
  );
  const { data: directReports } = useDirectReports(id);
  const { data: notes } = useEmployeeNotes(id);
  const addNote = useAddEmployeeNote();
  const [noteText, setNoteText] = useState("");
  const { data: activeRoles } = useActiveEmployeeRoles(id);
  const { data: roleHistory } = useEmployeeRoleHistory(id);
  const [isAssignRoleOpen, setIsAssignRoleOpen] = useState(false);
  const [removingRole, setRemovingRole] = useState<EmployeeRole | null>(null);
  const { data: kpiAssignments } = useEmployeeKpiAssignments(id);
  const syncKpis = useSyncKpiFromRole();
  const removeKpiAssignment = useRemoveEmployeeKpiAssignment();
  const [isAssignKpiOpen, setIsAssignKpiOpen] = useState(false);
  const [targetAssignment, setTargetAssignment] = useState<EmployeeKpiAssignment | null>(null);
  const [actualAssignment, setActualAssignment] = useState<EmployeeKpiAssignment | null>(null);
  const { data: taskAssignments } = useEmployeeTasks(id);
  const { data: performanceEntries } = usePerformanceEntries({ employeeId: id });
  const cancelTaskAssignment = useCancelTaskAssignment();
  const [isAssignTaskOpen, setIsAssignTaskOpen] = useState(false);
  const [submittingAssignment, setSubmittingAssignment] = useState<EmployeeTaskAssignment | null>(null);
  const [verifyingAssignment, setVerifyingAssignment] = useState<EmployeeTaskAssignment | null>(null);
  const [historyAssignmentId, setHistoryAssignmentId] = useState<string | undefined>(undefined);
  const { data: verifyingSubmissions } = useTaskSubmissions(verifyingAssignment?.id);
  const { data: taskHistory } = useTaskHistory(historyAssignmentId);
  const { data: taskComments } = useTaskComments(historyAssignmentId);
  const addTaskComment = useAddTaskComment();
  const [newComment, setNewComment] = useState("");

  const handleCancelTask = async (assignment: EmployeeTaskAssignment) => {
    try {
      await cancelTaskAssignment.mutateAsync({ assignmentId: assignment.id, employeeId: assignment.employeeId, userId: user?.id });
      toast({ title: "Assignment cancelled", variant: "success" });
    } catch (error) {
      toast({
        title: "Could not cancel assignment",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleAddTaskComment = async () => {
    if (!newComment.trim() || !historyAssignmentId) return;
    try {
      await addTaskComment.mutateAsync({ assignmentId: historyAssignmentId, comment: newComment.trim(), commentedBy: user?.id });
      setNewComment("");
    } catch (error) {
      toast({
        title: "Could not add comment",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleSyncKpisFromRoles = async () => {
    if (!employee) return;
    if (!employee.storeId) {
      toast({ title: "Not applicable", description: "KPI sync from roles applies to Store Specific employees only.", variant: "destructive" });
      return;
    }
    try {
      let totalCreated = 0;
      for (const role of activeRoles ?? []) {
        totalCreated += await syncKpis.mutateAsync({
          employeeId: employee.id,
          roleId: role.roleId,
          storeId: employee.storeId,
          companyId: employee.companyId,
          assignedBy: user?.id,
        });
      }
      toast({
        title: "Synced from roles",
        description: totalCreated > 0 ? `${totalCreated} KPI(s) newly assigned.` : "No new KPIs to assign.",
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Could not sync KPIs",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const { data: activity } = useQuery({
    queryKey: ["employee-activity", id],
    queryFn: () => auditService.recentForRecord("employees", id as string),
    enabled: Boolean(id),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading employee…</p>;
  if (!employee) return <p className="text-sm text-muted-foreground">Employee not found.</p>;

  const handleAddNote = async () => {
    if (!noteText.trim() || !id || !employee.companyId) return;
    try {
      await addNote.mutateAsync({ employeeId: id, companyId: employee.companyId, note: noteText.trim(), createdBy: user?.id });
      setNoteText("");
    } catch (error) {
      toast({
        title: "Could not add note",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const timelineEvents = [
    ...(employee.joiningDate
      ? [{ date: employee.joiningDate, label: "Joined", icon: Calendar }]
      : []),
  ];

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="w-fit">
        <Link to={ROUTES.employees}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Employees
        </Link>
      </Button>

      <PageHeader
        title={employee.fullName}
        description={employee.employeeCode ? `Employee Code: ${employee.employeeCode}` : undefined}
        actions={
          <Button asChild>
            <Link to={`/employees/${employee.id}/edit`}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-6 sm:flex-row">
          <Avatar className="h-16 w-16">
            <AvatarImage src={employee.photoUrl ?? undefined} alt={employee.fullName} />
            <AvatarFallback className="text-lg">{initialsFromName(employee.fullName)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 text-center sm:text-left">
            <p className="text-lg font-semibold">{employee.fullName}</p>
            <p className="text-sm text-muted-foreground">
              {employee.designationTitle ?? "—"} · {employee.departmentName ?? "—"} · {employee.storeName ?? "—"}
            </p>
          </div>
          <EmployeeStatusBadge status={employee.status} />
        </CardContent>
      </Card>

      <EmployeeLoginAccountCard employee={employee} />

      <EmployeeCurrentSalaryCard employeeId={employee.id} companyId={employee.companyId} />

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="employment">Employment</TabsTrigger>
          <TabsTrigger value="responsibilities">Responsibilities</TabsTrigger>
          <TabsTrigger value="kpis">KPIs</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="sop">SOP</TabsTrigger>
          <TabsTrigger value="checklist">Checklist</TabsTrigger>
          <TabsTrigger value="task-history">History</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="reporting">Reporting</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardContent className="p-6">
              <DetailRow label="First Name" value={canViewFullName ? employee.firstName : "Restricted"} />
              <DetailRow label="Middle Name" value={canViewFullName ? employee.middleName : "Restricted"} />
              <DetailRow label="Last Name" value={canViewFullName ? employee.lastName : "Restricted"} />
              <DetailRow label="Gender" value={employee.gender?.replace(/_/g, " ")} />
              <DetailRow label="Date of Birth" value={employee.dateOfBirth ? formatDate(employee.dateOfBirth) : null} />
              <DetailRow label="Blood Group" value={employee.bloodGroup} />
              <DetailRow label="Mobile" value={canViewMobile ? employee.mobile : "Restricted"} />
              <DetailRow label="Alternate Mobile" value={canViewMobile ? employee.alternateMobile : "Restricted"} />
              <DetailRow label="Email" value={canViewEmail ? employee.email : "Restricted"} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="employment">
          <Card>
            <CardContent className="p-6">
              <DetailRow label="Store" value={employee.storeName} />
              <DetailRow label="Team" value={employee.teamName} />
              <DetailRow label="Department" value={employee.departmentName} />
              <DetailRow label="Designation" value={employee.designationTitle} />
              <DetailRow label="Grade" value={gradeText} />
              <DetailRow label="Reporting Manager" value={employee.reportingManagerName} />
              <DetailRow label="Joining Date" value={canViewJoiningDate ? (employee.joiningDate ? formatDate(employee.joiningDate) : null) : "Restricted"} />
              <DetailRow
                label="Confirmation Date"
                value={employee.confirmationDate ? formatDate(employee.confirmationDate) : null}
              />
              <DetailRow label="Employment Type" value={employee.employmentType?.replace(/_/g, " ")} />
              <DetailRow label="Salary Type" value={employee.salaryType?.replace(/_/g, " ")} />
            </CardContent>
          </Card>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardContent className="p-6">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <ArrowRightLeft className="h-4 w-4" /> Transfer History
                </h3>
                <EmployeeTransferHistory employeeId={employee.id} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <TrendingUp className="h-4 w-4" /> Promotion History
                </h3>
                <EmployeePromotionHistory employeeId={employee.id} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="responsibilities">
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <ShieldCheck className="h-4 w-4" /> Primary Designation
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {employee.designationTitle ?? "—"} · {employee.departmentName ?? "—"}
                  </p>
                </div>
                <Button size="sm" onClick={() => setIsAssignRoleOpen(true)}>
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Assign Role
                </Button>
              </div>

              <div>
                <h3 className="mb-3 text-sm font-semibold">Additional Roles</h3>
                {!activeRoles || activeRoles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No additional roles assigned yet.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {activeRoles.map((employeeRole) => (
                      <ResponsibilityCard key={employeeRole.id} employeeRole={employeeRole} onRemove={setRemovingRole} />
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="mb-3 text-sm font-semibold">Role History</h3>
                {!roleHistory || roleHistory.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No role history yet.</p>
                ) : (
                  <div className="space-y-2">
                    {roleHistory.map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                        <div>
                          <span className="font-medium capitalize">{entry.action.replace("_", " ")}</span>
                          <span className="ml-2 text-muted-foreground">{entry.roleName}</span>
                          {entry.reason && <p className="text-xs text-muted-foreground">{entry.reason}</p>}
                        </div>
                        <span className="text-xs text-muted-foreground">{formatDate(entry.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="kpis">
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  KPIs assigned to this employee, either from their roles or assigned manually.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSyncKpisFromRoles}
                    disabled={syncKpis.isPending}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {syncKpis.isPending ? "Syncing…" : "Sync from Roles"}
                  </Button>
                  <Button size="sm" onClick={() => setIsAssignKpiOpen(true)}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Assign KPI
                  </Button>
                </div>
              </div>

              {!kpiAssignments || kpiAssignments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No KPIs assigned yet.</p>
              ) : (
                <EmployeeKpiTable
                  assignments={kpiAssignments}
                  onSetTarget={setTargetAssignment}
                  onLogActual={setActualAssignment}
                  onRemove={(assignment) => removeKpiAssignment.mutate({ assignmentId: assignment.id, employeeId: employee.id })}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tasks">
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">Tasks assigned to this employee.</p>
                <Button size="sm" onClick={() => setIsAssignTaskOpen(true)}>
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Assign Task
                </Button>
              </div>

              {!taskAssignments || taskAssignments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks assigned yet.</p>
              ) : (
                <EmployeeTaskTable
                  assignments={taskAssignments}
                  onSubmit={setSubmittingAssignment}
                  onVerify={setVerifyingAssignment}
                  onCancel={handleCancelTask}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sop">
          <Card>
            <CardContent className="space-y-4 p-6">
              <p className="text-sm text-muted-foreground">
                Standard operating procedure for each of this employee&apos;s assigned tasks.
              </p>
              {!taskAssignments || taskAssignments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks assigned yet.</p>
              ) : (
                <div className="space-y-4">
                  {taskAssignments.map((assignment) => (
                    <SopSection key={assignment.id} assignment={assignment} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="checklist">
          <Card>
            <CardContent className="space-y-4 p-6">
              <p className="text-sm text-muted-foreground">Checklist completion status for each assigned task.</p>
              {!taskAssignments || taskAssignments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks assigned yet.</p>
              ) : (
                <div className="space-y-4">
                  {taskAssignments.map((assignment) => (
                    <ChecklistStatusSection key={assignment.id} assignment={assignment} onComplete={setSubmittingAssignment} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="task-history">
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="space-y-1.5">
                <Label>Task</Label>
                <select
                  className="flex h-9 w-full max-w-sm rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  value={historyAssignmentId ?? ""}
                  onChange={(e) => setHistoryAssignmentId(e.target.value || undefined)}
                >
                  <option value="">Select a task…</option>
                  {(taskAssignments ?? []).map((assignment) => (
                    <option key={assignment.id} value={assignment.id}>
                      {assignment.taskName}
                    </option>
                  ))}
                </select>
              </div>

              {historyAssignmentId && (
                <>
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">Timeline</h3>
                    {!taskHistory || taskHistory.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No history yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {taskHistory.map((entry) => (
                          <div key={entry.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                            <div>
                              <span className="font-medium capitalize">{entry.action.replace("_", " ")}</span>
                              {entry.statusLabel && <span className="ml-2 text-muted-foreground">{entry.statusLabel}</span>}
                              {entry.remarks && <p className="text-xs text-muted-foreground">{entry.remarks}</p>}
                            </div>
                            <span className="text-xs text-muted-foreground">{formatDate(entry.createdAt)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="mb-2 text-sm font-semibold">Comments</h3>
                    <div className="mb-3 flex gap-2">
                      <Textarea
                        placeholder="Add a comment…"
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        className="min-h-0"
                      />
                      <Button size="sm" onClick={handleAddTaskComment} disabled={!newComment.trim() || addTaskComment.isPending}>
                        Post
                      </Button>
                    </div>
                    {!taskComments || taskComments.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No comments yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {taskComments.map((comment) => (
                          <div key={comment.id} className="rounded-lg border p-3 text-sm">
                            <p>{comment.comment}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {comment.commentedByName ?? "Someone"} · {formatDate(comment.createdAt)}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance">
          <Card>
            <CardContent className="space-y-4 p-6">
              <div>
                <h3 className="mb-1 text-sm font-semibold">Performance Data</h3>
                <p className="text-sm text-muted-foreground">
                  Every metric entry recorded for this employee, from Daily Entry or Bulk Entry.
                </p>
              </div>

              {!performanceEntries || performanceEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No entries recorded yet.</p>
              ) : (
                <EntryTable entries={performanceEntries} />
              )}

              <div>
                <h3 className="mb-2 text-sm font-semibold">Metric History (by metric)</h3>
                {!performanceEntries || performanceEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing to summarize yet.</p>
                ) : (
                  <div className="space-y-2">
                    {Array.from(
                      performanceEntries.reduce((map, entry) => {
                        const key = entry.metricName ?? "Unknown";
                        map.set(key, (map.get(key) ?? 0) + 1);
                        return map;
                      }, new Map<string, number>())
                    ).map(([metricName, count]) => (
                      <div key={metricName} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                        <span>{metricName}</span>
                        <span className="text-muted-foreground">{count} entr{count === 1 ? "y" : "ies"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          {canViewDocumentsTab ? (
            <Card>
              <CardContent className="p-6">
                <EmployeeDocumentUploader employeeId={employee.id} companyId={employee.companyId} uploadedBy={user?.id} />
              </CardContent>
            </Card>
          ) : (
            <EmptyState icon={ShieldAlert} title="Restricted" description="You do not have permission to view Employee Documents." />
          )}
        </TabsContent>

        <TabsContent value="reporting">
          <Card>
            <CardContent className="p-6">
              <h3 className="mb-3 text-sm font-semibold">Reporting Manager</h3>
              <p className="mb-6 text-sm text-muted-foreground">{employee.reportingManagerName ?? "No reporting manager assigned."}</p>

              <h3 className="mb-3 text-sm font-semibold">Direct Reports</h3>
              {!directReports || directReports.length === 0 ? (
                <p className="text-sm text-muted-foreground">No one reports to this employee yet.</p>
              ) : (
                <div className="divide-y rounded-lg border">
                  {directReports.map((report) => (
                    <Link
                      key={report.id}
                      to={`/employees/${report.id}`}
                      className="flex items-center justify-between gap-3 p-3 text-sm hover:bg-accent"
                    >
                      <span className="flex items-center gap-2">
                        <UserIcon className="h-4 w-4 text-muted-foreground" />
                        {report.fullName}
                      </span>
                      <span className="text-muted-foreground">{report.designationTitle ?? "—"}</span>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timeline">
          <Card>
            <CardContent className="p-6">
              {timelineEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No timeline events yet.</p>
              ) : (
                <div className="space-y-3">
                  {timelineEvents.map((event, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm">
                      <event.icon className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{event.label}</span>
                      <span className="text-muted-foreground">{formatDate(event.date)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardContent className="p-6">
              {!activity || activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
              ) : (
                <div className="space-y-3">
                  {activity.map((log) => (
                    <div key={log.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium capitalize">{log.action}</span>
                        <span className="text-xs text-muted-foreground">{formatDate(log.performed_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes">
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="space-y-2">
                <Textarea
                  placeholder="Add a note about this employee…"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                />
                <div className="flex justify-end">
                  <Button size="sm" onClick={handleAddNote} disabled={addNote.isPending || !noteText.trim()}>
                    Add Note
                  </Button>
                </div>
              </div>

              {!notes || notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No notes yet.</p>
              ) : (
                <div className="space-y-3">
                  {notes.map((note) => (
                    <div key={note.id} className="rounded-lg border p-3 text-sm">
                      <p>{note.note}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatDate(note.createdAt)}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {employee && employee.storeId && (
        <AssignRoleDialog
          open={isAssignRoleOpen}
          onOpenChange={setIsAssignRoleOpen}
          employeeId={employee.id}
          storeId={employee.storeId}
          companyId={employee.companyId}
        />
      )}
      <RemoveRoleDialog employeeRole={removingRole} onOpenChange={(open) => !open && setRemovingRole(null)} />

      {employee && employee.storeId && (
        <AssignKpiDialog
          open={isAssignKpiOpen}
          onOpenChange={setIsAssignKpiOpen}
          employeeId={employee.id}
          storeId={employee.storeId}
          companyId={employee.companyId}
          existingAssignments={kpiAssignments ?? []}
        />
      )}
      {employee && employee.storeId && (
        <KpiTargetDialog
          assignment={targetAssignment}
          storeId={employee.storeId}
          companyId={employee.companyId}
          onOpenChange={(open) => !open && setTargetAssignment(null)}
        />
      )}
      {employee && employee.storeId && (
        <KpiActualDialog
          assignment={actualAssignment}
          storeId={employee.storeId}
          companyId={employee.companyId}
          onOpenChange={(open) => !open && setActualAssignment(null)}
        />
      )}

      {employee && employee.storeId && (
        <AssignTaskDialog
          open={isAssignTaskOpen}
          onOpenChange={setIsAssignTaskOpen}
          employeeId={employee.id}
          roleId={null}
          storeId={employee.storeId}
          companyId={employee.companyId}
        />
      )}
      {employee && (
        <TaskSubmissionDialog
          assignment={submittingAssignment}
          companyId={employee.companyId}
          onOpenChange={(open) => !open && setSubmittingAssignment(null)}
        />
      )}
      <TaskVerificationDialog
        assignment={verifyingAssignment}
        submission={(verifyingSubmissions ?? [])[0] ?? null}
        onOpenChange={(open) => !open && setVerifyingAssignment(null)}
      />
    </div>
  );
}

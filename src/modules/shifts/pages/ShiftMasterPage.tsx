import { useState } from "react";
import { Plus, Clock } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { useShifts } from "@/hooks/useShifts";
import { ShiftFormDialog } from "../components/ShiftFormDialog";
import type { AttendanceShift } from "@/types/attendance";

function formatTime(value: string): string {
  const [h, m] = value.split(":").map(Number);
  const date = new Date(2000, 0, 1, h, m);
  return new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }).format(date);
}

export function ShiftMasterPage() {
  const { user } = useAuth();
  const shiftsQuery = useShifts(user?.companyId ?? undefined);
  const [formOpen, setFormOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<AttendanceShift | null>(null);

  const openCreate = () => {
    setEditingShift(null);
    setFormOpen(true);
  };

  const openEdit = (shift: AttendanceShift) => {
    setEditingShift(shift);
    setFormOpen(true);
  };

  const shifts = shiftsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shift Management"
        description="Create and manage the shifts used across your stores. Shifts define Scheduled Start/End Time and eligibility — Late/Overtime calculation rules live separately under Attendance Rule Management."
        actions={
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New Shift
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          {shiftsQuery.isLoading ? (
            <div className="p-6">
              <LoadingState />
            </div>
          ) : shifts.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={Clock} title="No shifts yet" description="Create your first shift to start assigning it to employees." />
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Shift Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Timing</TableHead>
                    <TableHead>Late Eligible</TableHead>
                    <TableHead>Overtime Eligible</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shifts.map((shift) => (
                    <TableRow key={shift.id}>
                      <TableCell className="font-medium">{shift.name}</TableCell>
                      <TableCell className="font-mono text-sm">{shift.shiftCode ?? "—"}</TableCell>
                      <TableCell>
                        {formatTime(shift.startTime)} – {formatTime(shift.endTime)}
                      </TableCell>
                      <TableCell>{shift.lateEligible ? "Yes" : "No"}</TableCell>
                      <TableCell>{shift.overtimeEnabled ? "Yes" : "No"}</TableCell>
                      <TableCell>
                        <Badge variant={shift.isActive ? "success" : "secondary"}>{shift.isActive ? "Active" : "Inactive"}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(shift)}>
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ShiftFormDialog open={formOpen} onOpenChange={setFormOpen} shift={editingShift} />
    </div>
  );
}

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useAdminUpsertAttendance, useAttendanceUseInformation } from "@/hooks/useAttendanceAdmin";
import { useAuth } from "@/hooks/useAuth";
import { useStores } from "@/hooks/useStores";
import { useEmployeeShift, useExplainAttendanceRules } from "@/hooks/useAttendance";
import { ATTENDANCE_STATUS_LABELS, ATTENDANCE_STATUS_OPTIONS } from "@/constants/attendance";
import type { AttendanceStatus } from "@/types/database.types";
import { utcIsoToIstHHMM } from "@/lib/attendanceCalculation";
import { formatDate } from "@/lib/utils";
import type { MonthlyAttendanceRow } from "@/modules/attendance/utils";
import { AppliedAttendanceRules } from "@/modules/attendance/components/AppliedAttendanceRules";

interface EditAttendanceEmployee {
  id: string;
  fullName: string;
  employeeCode: string | null;
  /** Null = Company Wide employee (e.g. Super Manager) — Rule Details cannot resolve store-scoped
   *  rules for them, so the panel is hidden in that case rather than guessing a store. */
  storeId: string | null;
}

interface EditAttendanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: EditAttendanceEmployee | null;
  /** The row being edited — supplies the date and pre-fills current status/punch times. */
  row: MonthlyAttendanceRow | null;
  onSaved?: () => void;
}

/**
 * Super Admin create/edit for one attendance date (today or any date in the past — the caller is
 * responsible for never opening this on a future/locked row; attendance_admin_upsert() also
 * rejects a future date server-side regardless). Recalculation of Late/Working/Overtime, using the
 * shift that applied on THAT date, happens entirely inside the RPC — this dialog only collects
 * status/punch times/remark and shows the server's result back via the mutation.
 */
export function EditAttendanceDialog({ open, onOpenChange, employee, row, onSaved }: EditAttendanceDialogProps) {
  const adminUpsert = useAdminUpsertAttendance();
  const useInformationMutation = useAttendanceUseInformation();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const storesQuery = useStores(user?.companyId ?? undefined);
  const storeName = storesQuery.data?.find((s) => s.id === employee?.storeId)?.name ?? "—";

  // Mirrors `row`'s record-identifying fields (id/punchInAt/punchOutAt/usedInformation), but is
  // updated IN PLACE the moment "Use Information" returns its freshly-recalculated record — `row`
  // itself is a snapshot the parent list passed in and does not update live while this dialog stays
  // open, so Applied Attendance Rules would otherwise keep re-explaining the pre-Information state
  // (wrongly passing useInformation=false) even though the record was just changed server-side.
  const [liveRecord, setLiveRecord] = useState<{
    id: string | null;
    punchInAt: string | null;
    punchOutAt: string | null;
    usedInformation: boolean;
  } | null>(null);

  // Rule Details reflects the RECORD AS SAVED (liveRecord, seeded from row and kept in sync with
  // Use Information's own result), not the admin's in-progress edits below — it explains "why was
  // this attendance calculated this way", not a live preview of an unsaved draft. Re-opens with the
  // new values automatically after Save.
  const shiftQuery = useEmployeeShift(employee?.id, row?.date);
  const explainQuery = useExplainAttendanceRules(
    open && employee?.storeId && shiftQuery.data?.id
      ? {
          companyId: user?.companyId ?? undefined,
          employeeId: employee.id,
          shiftId: shiftQuery.data.id,
          storeId: employee.storeId,
          attendanceDate: row?.date,
          punchInAt: liveRecord?.punchInAt ?? null,
          punchOutAt: liveRecord?.punchOutAt ?? null,
          // Re-explain the SAVED day's actual Information usage — never re-trigger a fresh use.
          // Safe to pass through as-is: compute_late_and_penalty_facts()'s usage insert is
          // ON CONFLICT DO NOTHING, and this is only ever true when a usage row already exists
          // for this exact employee+date (attendance_admin_upsert/attendance_use_information
          // created it at save/use time).
          useInformation: liveRecord?.usedInformation ?? false,
        }
      : null
  );
  const ruleDetailsUnavailable = !employee?.storeId
    ? "Not available for Company Wide employees."
    : !shiftQuery.isLoading && !shiftQuery.data
    ? "No shift is assigned to this employee for this date."
    : null;

  const [status, setStatus] = useState<AttendanceStatus>("present");
  const [punchInTime, setPunchInTime] = useState("");
  const [punchOutTime, setPunchOutTime] = useState("");
  const [remark, setRemark] = useState("");

  useEffect(() => {
    if (!open || !row) return;
    setStatus(row.status);
    setPunchInTime(row.punchInAt ? utcIsoToIstHHMM(row.punchInAt) : "");
    setPunchOutTime(row.punchOutAt ? utcIsoToIstHHMM(row.punchOutAt) : "");
    setRemark("");
    setLiveRecord({ id: row.id, punchInAt: row.punchInAt, punchOutAt: row.punchOutAt, usedInformation: row.usedInformation });
  }, [open, row]);

  const handleUseInformation = async () => {
    if (!liveRecord?.id || !employee || !row) return;
    try {
      const updated = await useInformationMutation.mutateAsync({ attendanceRecordId: liveRecord.id });
      setLiveRecord({ id: updated.id, punchInAt: updated.punchInAt, punchOutAt: updated.punchOutAt, usedInformation: updated.usedInformation });
      toast({
        title: "Information used successfully.",
        description: "Attendance recalculated.",
        variant: "success",
      });
      onSaved?.();
    } catch (error) {
      toast({
        title: "Could not use Information",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
      throw error; // let the confirmation dialog know the action did not complete, so it stays open
    }
  };

  // Punch Out earlier than Punch In is a legitimate OVERNIGHT shift (e.g. In 10:30 AM, Out 02:30 AM
  // the next day) — attendance_admin_upsert() normalizes it onto the next calendar day itself, the
  // same authoritative reconstruction the live Punch Out flow already relies on. Only an EXACT match
  // (zero-duration attendance) is still rejected, matching the RPC's own guard.
  const isOvernightPunch = Boolean(punchInTime && punchOutTime && punchOutTime < punchInTime);

  const handleSave = async () => {
    if (!employee || !row) return;
    if (punchInTime && punchOutTime && punchOutTime === punchInTime) {
      toast({ title: "Punch Out must be after Punch In.", variant: "destructive" });
      return;
    }

    try {
      await adminUpsert.mutateAsync({
        employeeId: employee.id,
        attendanceDate: row.date,
        status,
        punchInTime: punchInTime || null,
        punchOutTime: punchOutTime || null,
        remark: remark.trim() || undefined,
      });
      toast({ title: "Attendance updated", description: `${employee.fullName} — ${formatDate(row.date)}`, variant: "success" });
      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      toast({
        title: "Could not update attendance",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Attendance</DialogTitle>
          <DialogDescription>
            {employee ? `${employee.fullName} (${employee.employeeCode ?? "—"})` : ""}
            {row ? ` · ${formatDate(row.date)}` : ""}. Late/Working Hours/Overtime are recalculated
            automatically using the shift that applied on this date.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as AttendanceStatus)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ATTENDANCE_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {ATTENDANCE_STATUS_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Punch In</Label>
              <Input type="time" value={punchInTime} onChange={(event) => setPunchInTime(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Punch Out</Label>
              <Input type="time" value={punchOutTime} onChange={(event) => setPunchOutTime(event.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Leave a time blank to clear it (e.g. for Absent, Leave, or Weekly Off).
          </p>
          {isOvernightPunch ? (
            <p className="text-xs text-primary">
              Punch Out is earlier than Punch In — this will be saved as an overnight shift, with
              Punch Out on {formatDate(row?.date ?? "")} + 1 day.
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label>Remark / Reason</Label>
            <Textarea
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
              placeholder="e.g. Attendance missed during manual entry, corrected by Super Admin."
            />
          </div>

          {adminUpsert.isError ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
              {adminUpsert.error instanceof Error ? adminUpsert.error.message : "Update failed. Please try again."}
            </div>
          ) : null}

          {employee ? (
            <AppliedAttendanceRules
              explanations={explainQuery.data}
              isLoading={shiftQuery.isLoading || explainQuery.isLoading}
              unavailableReason={ruleDetailsUnavailable}
              employeeId={employee.id}
              employeeName={employee.fullName}
              storeId={employee.storeId ?? ""}
              storeName={storeName}
              attendanceDate={row?.date ?? ""}
              attendanceRecordId={liveRecord?.id ?? null}
              canUseInformation={isSuperAdmin}
              onUseInformation={handleUseInformation}
              isUsingInformation={useInformationMutation.isPending}
            />
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={adminUpsert.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={adminUpsert.isPending}>
            {adminUpsert.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

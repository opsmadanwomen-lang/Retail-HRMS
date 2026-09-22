import type { AttendanceStatus } from "@/types/database.types";

export const ATTENDANCE_STATUS_OPTIONS: AttendanceStatus[] = [
  "present",
  "absent",
  "half_day",
  "leave",
  "weekly_off",
  "holiday",
  "work_from_home",
  "on_duty",
];

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  half_day: "Half Day",
  leave: "Leave",
  weekly_off: "Weekly Off",
  holiday: "Holiday",
  work_from_home: "Work From Home",
  on_duty: "On Duty",
};

export const ATTENDANCE_STATUS_VARIANTS: Record<AttendanceStatus, "default" | "success" | "warning" | "destructive" | "secondary"> = {
  present: "success",
  absent: "destructive",
  half_day: "warning",
  leave: "secondary",
  weekly_off: "secondary",
  holiday: "secondary",
  work_from_home: "secondary",
  on_duty: "secondary",
};

export const ATTENDANCE_SOURCE_LABELS = {
  web: "Web",
  mobile: "Mobile",
  backend: "Backend",
  admin: "Super Admin",
} as const;

import Papa from "papaparse";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabaseClient";
import { storeService } from "@/services/storeService";
import { organizationService } from "@/services/organizationService";
import { employeeService } from "@/services/employeeService";
import type { EmployeeStatus, GenderType } from "@/types/database.types";
import type {
  EmployeeImportPreviewRow,
  EmployeeImportRow,
  EmployeeImportSummary,
} from "@/types/employee";
import { generateEmployeeCodeCandidate } from "@/lib/employeeCode";

const UNIQUE_VIOLATION = "23505";
const MAX_CODE_GENERATION_ATTEMPTS = 8;
const MOBILE_REGEX = /^[0-9+\-\s]{7,15}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STATUS_ALIASES: Record<string, EmployeeStatus> = {
  active: "active",
  inactive: "inactive",
  "on leave": "on_leave",
  onleave: "on_leave",
  notice: "notice_period",
  "notice period": "notice_period",
  resigned: "resigned",
  terminated: "terminated",
  transferred: "transferred",
  left: "resigned",
};

const HEADER_MAP: Record<string, keyof EmployeeImportRow> = {
  "employee code": "employeeCode",
  "employee name": "employeeName",
  name: "employeeName",
  mobile: "mobile",
  phone: "mobile",
  email: "email",
  gender: "gender",
  dob: "dob",
  "date of birth": "dob",
  "joining date": "joiningDate",
  store: "store",
  department: "department",
  designation: "designation",
  "reporting manager": "reportingManager",
  status: "status",
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

function rowsFromObjects(objects: Record<string, unknown>[]): EmployeeImportRow[] {
  return objects.map((obj) => {
    const row: Partial<EmployeeImportRow> = {};
    for (const [key, value] of Object.entries(obj)) {
      const mapped = HEADER_MAP[normalizeHeader(key)];
      if (mapped && value !== undefined && value !== null) {
        (row as Record<string, unknown>)[mapped] = String(value).trim();
      }
    }
    return row as EmployeeImportRow;
  });
}

const GENDER_VALUES: GenderType[] = ["male", "female", "other", "prefer_not_to_say"];

function resolveGender(value: string | undefined): GenderType | null {
  if (!value) return null;
  const key = value.trim().toLowerCase().replace(/\s+/g, "_") as GenderType;
  return GENDER_VALUES.includes(key) ? key : null;
}

export const employeeImportService = {
  /** Parses a .csv, .xlsx, or .xls file into raw import rows. */
  async parseFile(file: File): Promise<EmployeeImportRow[]> {
    const extension = file.name.split(".").pop()?.toLowerCase();

    if (extension === "csv") {
      return new Promise((resolve, reject) => {
        Papa.parse<Record<string, unknown>>(file, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => resolve(rowsFromObjects(results.data)),
          error: (err) => reject(err),
        });
      });
    }

    if (extension === "xlsx" || extension === "xls") {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const objects = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });
      return rowsFromObjects(objects);
    }

    throw new Error("Unsupported file type. Please upload a .csv, .xlsx, or .xls file.");
  },

  /** Generates a downloadable sample CSV matching the required import columns. */
  downloadSampleTemplate(): void {
    const headers = [
      "Employee Code",
      "Employee Name",
      "Mobile",
      "Email",
      "Gender",
      "DOB",
      "Joining Date",
      "Store",
      "Department",
      "Designation",
      "Reporting Manager",
      "Status",
    ];
    const sampleRow = [
      "EMP-1001",
      "Anita Sharma",
      "9876543210",
      "anita.sharma@example.com",
      "female",
      "1995-04-12",
      "2024-01-15",
      "Connaught Place",
      "Sales Team",
      "SSE",
      "",
      "active",
    ];
    const csv = [headers.join(","), sampleRow.join(",")].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "employee-import-sample.csv";
    link.click();
    URL.revokeObjectURL(url);
  },

  /**
   * Validates every row and auto-maps Store -> Department -> Designation
   * against the store's existing organization structure. If Store,
   * Department, and Designation all already exist, the row is assigned
   * automatically — no user input required. If the designation cannot be
   * found, the row is flagged `needs_mapping` so the UI can present a
   * manual mapping screen instead of guessing.
   */
  async validateAndResolve(rows: EmployeeImportRow[], companyId: string): Promise<EmployeeImportPreviewRow[]> {
    const stores = await storeService.list(companyId);
    const storeByName = new Map(stores.map((s) => [s.name.trim().toLowerCase(), s]));

    const orgTreeCache = new Map<string, Awaited<ReturnType<typeof organizationService.getTreeForStore>>>();
    const seenCodes = new Set<string>();
    const seenEmails = new Set<string>();

    const results: EmployeeImportPreviewRow[] = [];

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      const rowNumber = i + 2; // account for header row
      const errors: string[] = [];

      if (!raw.employeeName?.trim()) errors.push("Employee Name is required.");
      if (!raw.store?.trim()) errors.push("Store is required.");
      if (!raw.department?.trim()) errors.push("Department is required.");
      if (!raw.designation?.trim()) errors.push("Designation is required.");
      if (raw.mobile && !MOBILE_REGEX.test(raw.mobile)) errors.push("Mobile number looks invalid.");
      if (raw.email && !EMAIL_REGEX.test(raw.email)) errors.push("Email looks invalid.");

      let resolvedStoreId: string | undefined;
      let resolvedDesignationId: string | undefined;
      let resolvedReportingManagerId: string | null | undefined;
      let needsMapping = false;

      const store = raw.store ? storeByName.get(raw.store.trim().toLowerCase()) : undefined;
      if (raw.store && !store) {
        errors.push(`Store "${raw.store}" was not found.`);
      } else if (store) {
        resolvedStoreId = store.id;

        if (!orgTreeCache.has(store.id)) {
          orgTreeCache.set(store.id, await organizationService.getTreeForStore(store.id));
        }
        const tree = orgTreeCache.get(store.id) ?? [];

        const department = tree
          .flatMap((team) => team.departments)
          .find((d) => d.name.trim().toLowerCase() === raw.department?.trim().toLowerCase());

        if (!department) {
          needsMapping = true;
        } else {
          const designation = department.designations.find(
            (d) => d.title.trim().toLowerCase() === raw.designation?.trim().toLowerCase()
          );
          if (!designation) {
            needsMapping = true;
          } else {
            resolvedDesignationId = designation.id;
          }
        }

        if (raw.reportingManager?.trim()) {
          const managers = await employeeService.listForStore(store.id);
          const match = managers.find(
            (m) => m.fullName.trim().toLowerCase() === raw.reportingManager?.trim().toLowerCase()
          );
          resolvedReportingManagerId = match ? match.id : null;
        }
      }

      let state: EmployeeImportPreviewRow["state"] = "valid";

      const codeKey = raw.employeeCode?.trim().toLowerCase();
      const emailKey = raw.email?.trim().toLowerCase();
      let isDuplicate = false;

      if (codeKey) {
        if (seenCodes.has(codeKey) || (await employeeService.isCodeTaken(companyId, raw.employeeCode!.trim()))) {
          isDuplicate = true;
        }
        seenCodes.add(codeKey);
      }
      if (emailKey) {
        if (seenEmails.has(emailKey) || (await employeeService.isEmailTaken(companyId, raw.email!.trim()))) {
          isDuplicate = true;
        }
        seenEmails.add(emailKey);
      }

      if (errors.length > 0) {
        state = "error";
      } else if (isDuplicate) {
        state = "duplicate";
      } else if (needsMapping) {
        state = "needs_mapping";
      }

      results.push({
        rowNumber,
        raw,
        state,
        errors,
        resolvedStoreId,
        resolvedDesignationId,
        resolvedReportingManagerId,
      });
    }

    return results;
  },

  resolveStatus(value: string | undefined): EmployeeStatus {
    if (!value) return "active";
    const key = value.trim().toLowerCase();
    return STATUS_ALIASES[key] ?? "active";
  },

  /**
   * Imports every row currently marked `valid` (rows that are `error`,
   * `duplicate`, or `needs_mapping` are skipped) and writes a summary row
   * to `employee_import_batches`.
   */
  async importValidRows(params: {
    fileName: string;
    companyId: string;
    rows: EmployeeImportPreviewRow[];
    performedBy?: string;
  }): Promise<EmployeeImportSummary> {
    const { fileName, companyId, rows, performedBy } = params;
    const validRows = rows.filter((r) => r.state === "valid");
    const errorDetails: Array<{ rowNumber: number; message: string }> = [];
    let imported = 0;
    let codesGenerated = 0;

    // Employee Code is never taken from the file — always auto-generated from the resolved
    // store's code, same rule and same collision-safe retry as the manual Add Employee form.
    const stores = await storeService.list(companyId);
    const storeCodeById = new Map(stores.map((store) => [store.id, store.code]));

    for (const row of validRows) {
      if (!row.resolvedStoreId || !row.resolvedDesignationId) {
        errorDetails.push({ rowNumber: row.rowNumber, message: "Missing resolved store or designation." });
        continue;
      }
      const storeCode = storeCodeById.get(row.resolvedStoreId);
      if (!storeCode) {
        errorDetails.push({ rowNumber: row.rowNumber, message: "Could not resolve the store's code." });
        continue;
      }

      try {
        const fullName = row.raw.employeeName.trim();
        const basePayload = {
          company_id: companyId,
          store_id: row.resolvedStoreId,
          store_designation_id: row.resolvedDesignationId,
          reporting_manager_id: row.resolvedReportingManagerId ?? null,
          first_name: fullName,
          last_name: null,
          full_name: fullName,
          gender: resolveGender(row.raw.gender),
          date_of_birth: row.raw.dob?.trim() || null,
          mobile: row.raw.mobile?.trim() || null,
          email: row.raw.email?.trim() || null,
          joining_date: row.raw.joiningDate?.trim() || null,
          status: this.resolveStatus(row.raw.status),
          created_by: performedBy ?? null,
          updated_by: performedBy ?? null,
        };

        let rowImported = false;
        let lastRowError: unknown = null;
        for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt += 1) {
          const employeeCode = generateEmployeeCodeCandidate(storeCode);
          const { error } = await supabase.from("employees").insert({ ...basePayload, employee_code: employeeCode });
          if (!error) {
            rowImported = true;
            codesGenerated += 1;
            break;
          }
          lastRowError = error;
          if (error.code !== UNIQUE_VIOLATION) break;
        }

        if (!rowImported) {
          throw lastRowError instanceof Error
            ? lastRowError
            : new Error("Could not generate a unique Employee Code for this row.");
        }
        imported += 1;
      } catch (err) {
        errorDetails.push({
          rowNumber: row.rowNumber,
          message: err instanceof Error ? err.message : "Unknown error while importing row.",
        });
      }
    }

    const summary: EmployeeImportSummary = {
      totalRows: rows.length,
      validRows: validRows.length,
      importedRows: imported,
      codesGenerated,
      skippedRows: rows.length - validRows.length,
      errorRows: errorDetails.length,
    };

    await supabase.from("employee_import_batches").insert({
      company_id: companyId,
      file_name: fileName,
      total_rows: summary.totalRows,
      valid_rows: summary.validRows,
      imported_rows: summary.importedRows,
      skipped_rows: summary.skippedRows,
      error_rows: summary.errorRows,
      errors: errorDetails.length > 0 ? errorDetails : null,
      performed_by: performedBy ?? null,
    });

    return summary;
  },
};

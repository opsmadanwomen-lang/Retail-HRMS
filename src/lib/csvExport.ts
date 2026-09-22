/**
 * Minimal client-side CSV export — no third-party library, per the explicit instruction not to
 * introduce a large new reporting framework for this. Excel opens CSV natively, satisfying
 * "Excel/CSV export where practical" without a heavy XLSX dependency.
 */
export function exportRowsToCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (rows.length === 0) return;

  const headers = Object.keys(rows[0]);
  const escapeCell = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    const str = String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const lines = [headers.join(","), ...rows.map((row) => headers.map((h) => escapeCell(row[h])).join(","))];
  const csvContent = lines.join("\r\n");

  const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

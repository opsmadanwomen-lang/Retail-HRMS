// Pulls the LIVE table shapes, constraints and function bodies (READ-ONLY SELECTs through the linked project)
// into ./.fixtures so run.cjs can test migrations against the real engine code in a local PGlite.
//   node scripts/sql-regression/pull-fixtures.cjs
// Needs: supabase CLI logged in + linked (same as `supabase db query --linked`). Never writes to the database.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const OUT = path.join(__dirname, ".fixtures");
fs.mkdirSync(OUT, { recursive: true });

const TABLES = [
  "salary_structures", "salary_structure_components", "salary_slab_rules", "salary_structure_assignments", "employee_salary_assignments",
  "payroll_policies", "payroll_statutory_rules", "payroll_pt_slabs", "payroll_deduction_order", "payroll_component_amounts",
  "payroll_salary_components", "tds_policies", "store_payroll_calendars", "payroll_policy_assignments", "employee_assignment_history",
  "payroll_component_import_batches", "payroll_component_amount_audit", "payroll_runs", "payroll_periods", "advance_finance_processors",
  "advance_payroll_periods", "advance_recovery_plans", "advance_recovery_transactions", "attendance_records", "leave_attendance_effects", "payroll_employee_results", "payroll_lines",
];
const FUNCTIONS = [
  "payroll_round", "payroll_resolve_policy", "salary_bifurcate", "payroll_eval_formula", "payroll_policy_finalize",
  "payroll_resolve_policy_for_employee", "tds_resolve_policy", "employee_assignment_as_of", "payroll_resolve_store_calendar",
  "payroll_calendar_working_days", "tds_compute", "salary_resolve_for_employee", "payroll_policy_compute_lines", "payroll_policy_preview",
  "payroll_policy_validate", "salary_assign_employee", "salary_list_employee_assignments", "payroll_component_import_eligible",
  "payroll_component_import_codes", "payroll_component_amounts_guard", "payroll_component_amount_set", "_pca_parse_amount",
  "payroll_component_import_preview", "payroll_component_import_commit", "payroll_component_amounts_bulk_set",
  "payroll_component_amounts_audit_trg", "payroll_policy_activate", "payroll_apply_policy", "salary_preview", "payroll_calculate_run", "salary_resolve_core",
];

function query(sql) {
  const f = path.join(os.tmpdir(), `pull_${process.pid}_${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(f, sql);
  try {
    const out = execFileSync("cmd", ["/c", "supabase", "db", "query", "--linked", "--output-format", "json", "-f", f], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const json = out.slice(out.indexOf("{"));
    return JSON.parse(json).rows;
  } finally { fs.unlinkSync(f); }
}
const list = (a) => a.map((x) => `'${x}'`).join(",");

const cols = query(`select table_name, column_name, data_type, udt_name, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name in (${list(TABLES)}) order by table_name, ordinal_position`);
fs.writeFileSync(path.join(OUT, "cols.json"), JSON.stringify(cols));
const cons = query(`select conrelid::regclass::text tbl, conname, contype, pg_get_constraintdef(oid) def from pg_constraint where connamespace='public'::regnamespace and conrelid::regclass::text in (${list(TABLES)}) and contype in ('c','u','x','p') order by 1,2`);
fs.writeFileSync(path.join(OUT, "cons.json"), JSON.stringify(cons));
for (const fn of FUNCTIONS) {
  const rows = query(`select pg_get_functiondef(p.oid) d from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='${fn}'`);
  if (rows.length !== 1) throw new Error(`${fn}: expected exactly 1 definition, found ${rows.length}`);
  fs.writeFileSync(path.join(OUT, `live_${fn}.sql`), rows[0].d);
}
console.log(`fixtures written to ${OUT}: ${cols.length} columns, ${cons.length} constraints, ${FUNCTIONS.length} functions`);

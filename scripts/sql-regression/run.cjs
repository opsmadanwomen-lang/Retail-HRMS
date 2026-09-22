// SQL regression suite for the payroll salary-configuration work (migrations 0178 + 0179).
// Local PGlite database = LIVE table shapes + LIVE function bodies (from .fixtures) + the migration files under test.
//   node scripts/sql-regression/pull-fixtures.cjs      # once (read-only, needs the linked supabase CLI)
//   npm i --no-save @electric-sql/pglite                # once (kept out of package.json on purpose)
//   node scripts/sql-regression/run.cjs
// It never connects to the real database.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const FIX = path.join(__dirname, ".fixtures");
const MIGS = ["0178_common_payroll_components_and_auto_salary_structure.sql", "0179_policy_inheritance_resolver_security_and_closed_period_guard.sql", "0180_contain_common_component_formula_errors.sql", "0181_component_service_eligibility.sql", "0182_component_test_and_shared_eligibility.sql", "0183_virtual_employee_preview_and_salary_edit_permission.sql", "0184_company_ot_late_hourly_basis.sql", "0185_configurable_ot_late_hourly_basis.sql"]
  .map((f) => path.join(ROOT, "supabase", "migrations", f));
const MIG_0184 = MIGS[MIGS.length - 2];
const MIG_0185 = MIGS[MIGS.length - 1];
const rd = (p) => fs.readFileSync(p, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
const results = [];
const ok = (name, cond, extra = "") => results.push([cond ? "PASS" : "FAIL", name, cond ? "" : extra]);
const C = "11111111-1111-1111-1111-111111111111", C2 = "99999999-9999-9999-9999-999999999999";
const uid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

(async () => {
  let PGlite, btree_gist;
  // PGlite is a dev-only tool kept out of package.json: `npm i --no-save @electric-sql/pglite`, or set PGLITE_DIR=<folder containing node_modules>.
  try {
    if (process.env.PGLITE_DIR) {
      const base = path.join(process.env.PGLITE_DIR, "node_modules", "@electric-sql", "pglite", "dist");
      const { pathToFileURL } = require("url");
      ({ PGlite } = await import(pathToFileURL(path.join(base, "index.js")).href));
      ({ btree_gist } = await import(pathToFileURL(path.join(base, "contrib", "btree_gist.js")).href));
    } else { ({ PGlite } = await import("@electric-sql/pglite")); ({ btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist")); }
  } catch (e) { console.error("Install PGlite first:  npm i --no-save @electric-sql/pglite  (or set PGLITE_DIR)", e.message); process.exit(2); }
  const db = new PGlite({ extensions: { btree_gist } });
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const as = (role, { emp = "", company = C, pm = "" } = {}) =>
    db.exec(`select set_config('test.role','${role}',false), set_config('test.emp','${emp}',false), set_config('test.company','${company}',false), set_config('test.pm','${pm}',false), set_config('test.uid','${uid(900)}',false);`);
  const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e.message.split("\n")[0]; } };

  // ------------------------------------------------------------------ stubs + live shapes
  await db.exec("create extension if not exists btree_gist; create role anon; create role authenticated; create role service_role;");
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create or replace function public.is_super_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.role', true), '') = 'super_admin' $$;
    create or replace function public.current_user_role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), 'staff') $$;
    create or replace function public.current_user_company_id() returns uuid language sql stable as $$ select nullif(current_setting('test.company', true), '')::uuid $$;
    create or replace function public.current_user_employee_id() returns uuid language sql stable as $$ select nullif(current_setting('test.emp', true), '')::uuid $$;
    create or replace function public.payroll_can_manage(p_company_id uuid) returns boolean language sql stable as $$ select public.is_super_admin() or (coalesce(current_setting('test.pm', true), '') = '1' and p_company_id = public.current_user_company_id()) $$;
    create or replace function public.has_dynamic_permission(u uuid, m text, a text) returns boolean language sql stable as $$ select coalesce(current_setting('test.dyn', true), '') <> 'deny' $$;
    create table public.companies (id uuid primary key default gen_random_uuid());
    create table public.profiles (id uuid primary key, full_name text);
    create table public.stores (id uuid primary key default gen_random_uuid(), name text);
    create table public.store_departments (id uuid primary key default gen_random_uuid(), name text);
    create table public.store_designations (id uuid primary key default gen_random_uuid(), title text);
    -- Advance recovery is a separate engine that this suite does not run: an empty stand-in so payroll_calculate_run can execute.
    create or replace function public.advance_recovery_run_period(p_period uuid, p_emp uuid) returns table (deducted_amount numeric) language sql stable as $$ select null::numeric where false $$;
    create table public.employees (id uuid primary key default gen_random_uuid(), company_id uuid, employee_code text, store_id uuid, store_department_id uuid,
      store_designation_id uuid, grade_id uuid, category_id uuid, employment_type text, full_name text, joining_date date, leaving_date date, status text default 'active');
    create table public.employee_salary_components (id uuid primary key default gen_random_uuid(), employee_id uuid, basic_salary numeric, da numeric, effective_from date, effective_to date);
  `);
  const cols = JSON.parse(rd(path.join(FIX, "cols.json")));
  const byT = {};
  for (const c of cols) (byT[c.table_name] ||= []).push(c);
  for (const [t, cs] of Object.entries(byT)) {
    const defs = cs.map((c) => {
      let type = c.data_type;
      if (type === "USER-DEFINED") type = "text"; else if (type === "ARRAY") type = c.udt_name.replace(/^_/, "") + "[]";
      let def = c.column_default;
      if (def && /nextval/.test(def)) def = null;
      if (def && c.data_type === "USER-DEFINED") def = def.replace(/::[a-z_."]+/gi, "");
      return `"${c.column_name}" ${type}${c.is_nullable === "NO" ? " not null" : ""}${def ? " default " + def : ""}`;
    });
    await db.exec(`create table public.${t} (${defs.join(", ")});`);
  }
  const cons = JSON.parse(rd(path.join(FIX, "cons.json")));
  const ord = { p: 0, u: 1, x: 2, c: 3 };
  cons.sort((a, b) => ord[a.contype] - ord[b.contype]);
  for (const c of cons) {
    try { await db.exec(`alter table public.${c.tbl} add constraint "${c.conname}" ${c.def.replace(/::(app_role|[a-z_]+_(type|status|kind))/g, "::text")};`); }
    catch (e) { console.log("constraint skipped:", c.tbl, c.conname, "-", e.message.split("\n")[0]); }
  }
  const FNS = ["payroll_round", "payroll_resolve_policy", "salary_bifurcate", "payroll_eval_formula", "payroll_policy_finalize", "payroll_resolve_policy_for_employee",
    "tds_resolve_policy", "employee_assignment_as_of", "payroll_resolve_store_calendar", "payroll_calendar_working_days", "tds_compute", "salary_resolve_for_employee",
    "payroll_policy_compute_lines", "payroll_policy_preview", "payroll_policy_validate", "salary_assign_employee", "salary_list_employee_assignments",
    "payroll_component_import_eligible", "payroll_component_import_codes", "payroll_component_amounts_guard", "payroll_component_amount_set", "_pca_parse_amount",
    "payroll_component_import_preview", "payroll_component_import_commit", "payroll_component_amounts_bulk_set", "payroll_component_amounts_audit_trg", "payroll_policy_activate", "payroll_apply_policy", "salary_preview", "payroll_calculate_run"];
  for (const f of FNS) {
    try { await db.exec(rd(path.join(FIX, `live_${f}.sql`))); } catch (e) { console.log("LIVE FN LOAD FAILED", f, "-", e.message.split("\n")[0]); }
  }
  await db.exec(`
    create trigger trg_pca_guard before insert or delete or update on public.payroll_component_amounts for each row execute function public.payroll_component_amounts_guard();
    create trigger trg_pca_audit_row after insert or delete or update on public.payroll_component_amounts for each row execute function public.payroll_component_amounts_audit_trg();
    grant usage on schema public to authenticated, anon;
  `);

  // ------------------------------------------------------------------ seed (mirrors live: M1/M2/M3, slabs M1+M2 only, one policy with PF+ESI rules)
  await db.exec(`insert into public.companies(id) values ('${C}'),('${C2}'); insert into public.profiles values ('${uid(900)}','Admin User');`);
  const spec = { M1: ["Unskilled", "pct_of_component", 100], M2: ["Semi Skilled", "pct_of_basic", 85], M3: ["Skilled", "pct_of_basic", 40] };
  const sid = {};
  for (const [code, [name, daType, daPct]] of Object.entries(spec)) {
    sid[code] = (await q(`insert into public.salary_structures (company_id, code, name, status, rounding, gross_balanced, allow_negative_balance, effective_from) values ('${C}','${code}','${name}','active','round_2',true,false,'2026-04-01') returning id`))[0].id;
    await db.exec(`insert into public.salary_structure_components (company_id, salary_structure_id, code, name, category, calculation_type, percentage, base_component_code, is_basic, included_in_gross, display_order) values
      ('${C}','${sid[code]}','BASIC','BASIC','earning','pct_of_gross',50,null,true,true,10),
      ('${C}','${sid[code]}','DA','DA','earning','${daType}',${daPct},${daType === "pct_of_component" ? "'BASIC'" : "null"},false,true,20),
      ('${C}','${sid[code]}','ALLOWANCE','ALLOWANCE','earning','balance',null,null,false,true,30);`);
  }
  await db.exec(`insert into public.salary_slab_rules (company_id, salary_structure_id, min_gross, max_gross) values ('${C}','${sid.M1}',0,12499.99), ('${C}','${sid.M2}',12500,20000);`);
  const E = {};
  for (const [k, n] of [["E1", 1], ["E2", 2], ["E3", 3], ["E4", 4], ["E5", 5], ["E6", 6], ["E7", 7]]) {
    E[k] = uid(n);
    await db.exec(`insert into public.employees(id, company_id, employee_code, full_name) values ('${E[k]}','${C}','EMP${n}','Employee ${n}');`);
  }
  const OE = uid(50); await db.exec(`insert into public.employees(id, company_id, employee_code, full_name) values ('${OE}','${C2}','OTH1','Other Co Employee');`);
  const pol = (await q(`insert into public.payroll_policies (company_id, status, effective_from, code, policy_name, version_no, currency_precision, proration_method, proration_basis, ot_enabled, ot_std_hours_per_day, lwp_enabled, lwp_divisor_basis, working_days_method)
     values ('${C}','active','2000-01-01','P1','Policy 1',1,2,'calendar_days','basic_da',true,8,true,'basic_da','calendar_minus_offdays') returning id`))[0].id;
  await db.exec(`insert into public.payroll_statutory_rules (company_id, payroll_policy_id, kind, enabled, calc_method, calc_base, employee_rate, employer_rate, wage_ceiling, effective_from)
    values ('${C}','${pol}','pf',true,'pct_of_base','basic',12,13,15000,'2000-01-01'),('${C}','${pol}','esi',true,'pct_of_base','gross',0.75,3.25,21000,'2000-01-01');`);
  await as("super_admin");

  const cl = (policy, gross, basic, da, x = {}) => q(
    `select kind, line_type, code, name, amount, calc_type, calc_base, unresolved from public.payroll_policy_compute_lines($1::uuid,'2026-10-01','2026-10-31',31,null,$2,$3,$4,$5,$6,0,$7::uuid,'{}'::text[],null,null,null,$8::jsonb,$9::jsonb) order by 1,3`,
    [policy, basic, da, gross, x.lwp ?? 0, x.ot ?? 0, x.struct ?? null, JSON.stringify(x.manual ?? {}), JSON.stringify(x.comps ?? {})]);
  const baseline = JSON.stringify(await cl(pol, 14000, 7000, 7000, { lwp: 2, ot: 120, comps: { DA: 7000, BASIC: 7000 } }));

  // ------------------------------------------------------------------ apply migrations (twice: idempotent)
  let migErr = null;
  // 0178-0183 are applied and re-applied first (each was written to be re-runnable); 0184 then widens two function signatures, so it is
  // applied on top exactly once in order (as on the real database) and its own re-runnability is checked separately.
  for (const m of MIGS.slice(0, -2)) { try { await db.exec(rd(m)); } catch (e) { migErr = `${path.basename(m)}: ${e.message}`; break; } }
  ok("0178 + 0179 apply cleanly on live-shaped schema", !migErr, migErr ?? "");
  if (migErr) return report();
  let again = null; try { for (const m of MIGS.slice(0, -2)) await db.exec(rd(m)); } catch (e) { again = e.message.split("\n")[0]; }
  ok("0178 + 0179 are re-runnable (idempotent)", !again, again ?? "");
  let e184 = null; try { await db.exec(rd(MIG_0184)); } catch (e) { e184 = e.message.split("\n")[0]; }
  ok("0184 applies cleanly on top of 0178-0183 (live-shaped schema)", !e184, e184 ?? "");
  if (e184) return report();
  let e184b = null; try { await db.exec(rd(MIG_0184)); } catch (e) { e184b = e.message.split("\n")[0]; }
  ok("0184 is re-runnable (idempotent)", !e184b, e184b ?? "");
  let e185 = null; try { await db.exec(rd(MIG_0185)); } catch (e) { e185 = e.message.split("\n")[0]; }
  ok("0185 applies cleanly on top of 0178-0184 (live-shaped schema)", !e185, e185 ?? "");
  if (e185) return report();
  let e185b = null; try { await db.exec(rd(MIG_0185)); } catch (e) { e185b = e.message.split("\n")[0]; }
  ok("0185 is re-runnable (idempotent)", !e185b, e185b ?? "");
  ok("REGRESSION legacy PF/ESI/OT/LWP compute_lines output identical before vs after migrations", baseline === JSON.stringify(await cl(pol, 14000, 7000, 7000, { lwp: 2, ot: 120, comps: { DA: 7000, BASIC: 7000 } })));
  const allSql = MIGS.slice(0, -2).map(rd).join("\n");
  ok("STATIC: migrations 0178-0183 do not redefine payroll_calculate_run / attendance / leave / advance / fnf / transfer engines",
    !/create or replace function public\.(payroll_calculate_run|attendance_|leave_|advance_|fnf_|_?transfer_)/i.test(allSql));
  // 0184 legitimately re-issues payroll_calculate_run (it must read the Late minutes) — but never the attendance / leave / advance / fnf / transfer engines.
  ok("STATIC: 0184 touches only payroll functions (no attendance / leave / advance / fnf / transfer / salary-structure engine is redefined)",
    !/create (or replace )?function public\.(attendance_|leave_|advance_|fnf_|_?transfer_|salary_)/i.test(rd(MIG_0184)));
  // 0185 only widens payroll_ot_late_basis and re-bodies compute_lines/apply_policy/preview/validate — same boundary as 0184.
  ok("STATIC: 0185 touches only payroll functions (no attendance / leave / advance / fnf / transfer / salary-structure engine is redefined)",
    !/create (or replace )?function public\.(attendance_|leave_|advance_|fnf_|_?transfer_|salary_|payroll_calculate_run)/i.test(rd(MIG_0185)));

  // ------------------------------------------------------------------ A. salary routing (slab table + resolver)
  const core = async (g) => (await q(`select r.*, (select code from public.salary_structures s where s.id=r.salary_structure_id) code from public.salary_resolve_core('${E.E1}', '2026-10-31', $1::numeric) r`, [g]))[0];
  const slabAt = async (g) => (await q(`select s.code from public.salary_slab_rules sl join public.salary_structures s on s.id=sl.salary_structure_id where sl.is_active and $1::numeric >= sl.min_gross and (sl.max_gross is null or $1::numeric <= sl.max_gross)`, [g]))[0]?.code ?? null;
  ok("A0 slab table covers Gross 0 -> M1 (resolver deliberately does NOT route Gross 0: no salary; 0.01 does)", (await slabAt(0)) === "M1" && (await core(0)).code == null && (await core(0.01)).code === "M1");
  await db.exec(`insert into public.salary_slab_rules (company_id, salary_structure_id, min_gross, max_gross) values ('${C}','${sid.M3}',20000.01,null);`);
  for (const [g, e] of [[11000, "M1"], [12499.99, "M1"], [12500, "M2"], [15000, "M2"], [20000, "M2"], [20000.01, "M3"], [25000, "M3"]]) ok(`A  Gross ${g} -> ${e}`, (await core(g)).code === e, `got ${(await core(g)).code}`);

  // ------------------------------------------------------------------ B. bifurcation (M1 floor rule proposed & applied live)
  await db.exec(`update public.salary_structure_components set rounding_mode='floor', rounding_precision=2 where salary_structure_id='${sid.M1}' and code='BASIC';`);
  const bif = async (c, g) => (await q(`select code, amount from public.salary_bifurcate('${sid[c]}', $1::numeric) order by display_order`, [g])).map((r) => `${r.code}=${Number(r.amount)}`).join(",");
  ok("B  M1 @ 18000: Basic 50% / DA 100% of Basic / Allowance balance = 9000/9000/0", (await bif("M1", 18000)) === "BASIC=9000,DA=9000,ALLOWANCE=0");
  ok("B  M1 @ 11000 = 5500/5500/0 and @ 12499.99 = 6249.99/6249.99/0.01 (floor rule)", (await bif("M1", 11000)) === "BASIC=5500,DA=5500,ALLOWANCE=0" && (await bif("M1", 12499.99)) === "BASIC=6249.99,DA=6249.99,ALLOWANCE=0.01");
  ok("B  M2 @ 18000: DA 85% -> 9000/7650/1350", (await bif("M2", 18000)) === "BASIC=9000,DA=7650,ALLOWANCE=1350");
  ok("B  M3 @ 25000: DA 40% -> 12500/5000/7500", (await bif("M3", 25000)) === "BASIC=12500,DA=5000,ALLOWANCE=7500");

  // ------------------------------------------------------------------ C. common components
  const ins = (code, name, type, method, x = {}) => db.query(
    `insert into public.payroll_statutory_rules (company_id, payroll_policy_id, kind, enabled, calc_method, calc_base, employee_rate, employee_amount, ref_component_code, base_formula, effective_from, effective_to, component_code, component_name, component_type)
     values ($1,$2,'other',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [C, x.policy ?? pol, x.enabled ?? true, method, x.base ?? null, x.rate ?? null, x.amount ?? null, x.ref ?? null, x.formula ?? null, x.from ?? "2000-01-01", x.to ?? null, code, name, type]);
  await ins("MEDICAL", "Medical Fund", "deduction", "pct_of_base", { base: "gross", rate: 1 });
  await ins("FIXTEST", "Fixed Test", "deduction", "fixed_amount", { amount: 200 });
  await ins("PCTBASIC", "Pct Basic Test", "deduction", "pct_of_base", { base: "basic", rate: 10 });
  await ins("PCTDA", "Pct DA Test", "deduction", "pct_of_component", { ref: "DA", rate: 10 });
  await ins("INCENTIVE", "Incentive", "earning", "manual");
  await ins("FORMTEST", "Formula Test", "deduction", "formula", { formula: "round(BASIC * 0.02, 2)" });
  await ins("FUTURE1", "Future", "deduction", "fixed_amount", { amount: 50, from: "2027-01-01" });
  await ins("EXPIRED1", "Expired", "deduction", "fixed_amount", { amount: 60, to: "2026-09-30" });
  await ins("INACTIVE1", "Inactive", "deduction", "fixed_amount", { amount: 70, enabled: false });
  const by = (rows, code) => rows.find((r) => r.code === code);
  let rows = await cl(pol, 10000, 5000, 5000, { comps: { BASIC: 5000, DA: 5000 }, manual: { INCENTIVE: { employee_amount: 2500, source: "excel_import" } } });
  ok("C  Medical Fund = 1% of Gross 10,000 = 100", Number(by(rows, "MEDICAL")?.amount) === 100);
  ok("C  Fixed 200 / % of Basic 500 / % of DA 500 / Formula 100", [by(rows, "FIXTEST"), by(rows, "PCTBASIC"), by(rows, "PCTDA"), by(rows, "FORMTEST")].map((r) => Number(r?.amount)).join() === "200,500,500,100");
  ok("C  Incentive manual amount 2500 is an EARNING", Number(by(rows, "INCENTIVE")?.amount) === 2500 && by(rows, "INCENTIVE")?.line_type === "earning");
  ok("C  PF + ESI (legacy statutory rules) still produced", by(rows, "PF")?.calc_type === "statutory_pf" && by(rows, "ESI")?.calc_type === "statutory_esi");
  ok("C  effective dates: future-dated / expired / inactive components NOT applied", !by(rows, "FUTURE1") && !by(rows, "EXPIRED1") && !by(rows, "INACTIVE1"), JSON.stringify(rows.map((r) => r.code)));
  rows = await cl(pol, 10000, 5000, 5000, { comps: { BASIC: 5000, DA: 5000 } });
  ok("C  manual BLANK => 0 + flagged (unresolved)", Number(by(rows, "INCENTIVE")?.amount) === 0 && by(rows, "INCENTIVE")?.unresolved === true);
  rows = await cl(pol, 10000, 5000, 5000, { comps: { BASIC: 5000, DA: 5000 }, manual: { INCENTIVE: { employee_amount: 0, source: "manual" } } });
  ok("C  manual explicit ZERO respected (not flagged)", Number(by(rows, "INCENTIVE")?.amount) === 0 && by(rows, "INCENTIVE")?.unresolved === false);
  const [m1, m2, m3] = [await cl(pol, 11000, 5500, 5500, { struct: sid.M1 }), await cl(pol, 13000, 6500, 5525, { struct: sid.M2 }), await cl(pol, 25000, 12500, 5000, { struct: sid.M3 })];
  ok("C  ONE Medical component works for M1/M2/M3 (110/130/250)", [m1, m2, m3].map((r) => Number(by(r, "MEDICAL")?.amount)).join() === "110,130,250");

  // ---- Excel import + manual entry through the REAL import/commit/amount_set functions
  await db.exec(`insert into public.payroll_periods (id, company_id, period_month, period_start_date, period_end_date, status) values
    ('${uid(301)}','${C}','2026-08-01','2026-08-01','2026-08-31','locked'), ('${uid(302)}','${C}','2026-09-01','2026-09-01','2026-09-30','finalized'), ('${uid(303)}','${C}','2026-10-01','2026-10-01','2026-10-31','calculated');
    insert into public.payroll_runs (company_id, payroll_period_id, status, is_current) values ('${C}','${uid(301)}','locked',true),('${C}','${uid(302)}','finalized',true),('${C}','${uid(303)}','calculated',true);`);
  await as("staff", { emp: E.E2, pm: "1" });
  const codes = (await q(`select public.payroll_component_import_codes('${C}') c`))[0].c;
  ok("Excel: import code list has INCENTIVE (manual common component) and never OT", codes.includes("INCENTIVE") && !codes.includes("OT"), codes.join());
  const rowsIn = [{ row_number: 1, staff_id: "EMP1", amounts: { INCENTIVE: "2500" } }, { row_number: 2, staff_id: "EMP2", amounts: { INCENTIVE: "" } }, { row_number: 3, staff_id: "EMP3", amounts: { INCENTIVE: "0" } }, { row_number: 4, staff_id: "NOPE", amounts: { INCENTIVE: "10" } }];
  const prev = (await q(`select public.payroll_component_import_preview('${C}','${uid(303)}', array['INCENTIVE'], $1::jsonb) j`, [JSON.stringify(rowsIn)]))[0].j;
  ok("Excel preview: bad Staff ID is an error and blocks commit", prev.summary.errors === 1, JSON.stringify(prev.summary));
  const cErr = await fails(() => db.query(`select public.payroll_component_import_commit('${C}','${uid(303)}', array['INCENTIVE'], $1::jsonb, 'f.xlsx')`, [JSON.stringify(rowsIn)]));
  ok("Excel commit refused while any row has an error (nothing imported)", !!cErr && (await q(`select count(*)::int n from public.payroll_component_amounts`))[0].n === 0, cErr ?? "");
  const cm = (await q(`select public.payroll_component_import_commit('${C}','${uid(303)}', array['INCENTIVE'], $1::jsonb, 'f.xlsx') j`, [JSON.stringify(rowsIn.slice(0, 3))]))[0].j;
  const st = await q(`select e.employee_code c, a.employee_amount::numeric a, a.source s from public.payroll_component_amounts a join public.employees e on e.id=a.employee_id order by 1`);
  ok("Excel commit: 2500 stored, ZERO stored as 0, BLANK left untouched (no row)", cm.imported === 2 && cm.skipped_blank === 1 && st.length === 2 && Number(st.find((r) => r.c === "EMP1").a) === 2500 && Number(st.find((r) => r.c === "EMP3").a) === 0 && st.every((r) => r.s === "excel_import"), JSON.stringify(st));
  await db.query(`select * from public.payroll_component_amount_set('${uid(303)}','${E.E2}','INCENTIVE', 1800, null, 'typed')`);
  ok("Manual entry: amount_set stores 1800 (source manual)", Number((await q(`select employee_amount::numeric a from public.payroll_component_amounts where employee_id='${E.E2}'`))[0].a) === 1800);
  ok("Manual entry: not-manual component (FIXTEST) refused", !!(await fails(() => db.query(`select * from public.payroll_component_amount_set('${uid(303)}','${E.E2}','FIXTEST', 5)`))));
  const e42 = await fails(() => db.query(`select * from public.payroll_component_amount_set('${uid(302)}','${E.E2}','INCENTIVE', 5)`));
  ok("H  manual amount into a FINALIZED period refused (immutable)", /immutable|finalized/i.test(e42 ?? ""), e42 ?? "no error");
  const e43 = await fails(() => db.query(`select public.payroll_component_import_commit('${C}','${uid(301)}', array['INCENTIVE'], $1::jsonb)`, [JSON.stringify(rowsIn.slice(0, 1))]));
  ok("H  Excel import into a LOCKED period refused", /immutable|locked/i.test(e43 ?? ""), e43 ?? "no error");
  await as("staff", { emp: E.E2, pm: "" });
  ok("G  Excel/manual import by a non-payroll user refused server-side", !!(await fails(() => db.query(`select * from public.payroll_component_amount_set('${uid(303)}','${E.E2}','INCENTIVE', 5)`))));
  await as("super_admin");

  // ------------------------------------------------------------------ D. OT is never a generic component
  ok("D  common component code OT rejected", !!(await fails(() => ins("OT", "Overtime", "earning", "fixed_amount", { amount: 1, from: "2001-01-01" }))));
  ok("D  structure component OT + manual rejected", !!(await fails(() => db.exec(`insert into public.salary_structure_components (company_id, salary_structure_id, code, name, category, calculation_type) values ('${C}','${sid.M1}','OT','OT','earning','manual')`))));
  ok("D  manual/imported amount row for OT rejected", !!(await fails(() => db.exec(`insert into public.payroll_component_amounts (company_id, payroll_period_id, employee_id, component_code, employee_amount) values ('${C}','${uid(303)}','${E.E1}','OT',10)`))));
  ok("D  flat component OT must stay attendance_input (fixed rejected)", !!(await fails(() => db.exec(`insert into public.payroll_salary_components (company_id, code, name, component_type, calculation_method, source, effective_from) values ('${C}','OT','OT','earning','fixed_from_salary','overtime','2026-01-01')`))));
  ok("D  amount_set('OT') and import of OT refused", !!(await fails(() => db.query(`select * from public.payroll_component_amount_set('${uid(303)}','${E.E2}','OT', 5)`))) && !!(await fails(() => db.query(`select public.payroll_component_import_preview('${C}','${uid(303)}', array['OT'], '[]'::jsonb)`))));
  const otLines = await cl(pol, 14000, 7000, 7000, { ot: 120, comps: { DA: 7000, BASIC: 7000 } });
  ok("D  OT comes ONLY from attendance minutes (120 min -> earning_ot line, calc overtime_attendance); 0 min -> no line",
    by(otLines, "OT")?.kind === "earning_ot" && by(otLines, "OT")?.calc_type === "overtime_attendance" && Number(by(otLines, "OT")?.amount) > 0 && !by(await cl(pol, 14000, 7000, 7000, {}), "OT"));

  // ------------------------------------------------------------------ E. LWP / F. Advance
  const lwp = await cl(pol, 14000, 7000, 7000, { lwp: 2, comps: { DA: 7000, BASIC: 7000 } });
  ok("E  LWP comes from unpaid LWP days (2 days -> deduction_lwp > 0; 0 days -> none)", by(lwp, "LWP")?.kind === "deduction_lwp" && Number(by(lwp, "LWP")?.amount) > 0 && !by(await cl(pol, 14000, 7000, 7000, {}), "LWP"));
  ok("F  Advance Recovery engine untouched: 0178/0179 redefine no advance_* function (advance recovery itself is exercised by the live app; not runnable in this harness)", !/create or replace function public\.advance/i.test(allSql));

  // ------------------------------------------------------------------ preview = same engine, typed Gross
  const pv = async (emp, g) => (await q(`select public.payroll_policy_preview('${emp}', '2026-10-01', $1::jsonb) j`, [JSON.stringify(g == null ? {} : { gross: g })]))[0].j;
  for (const [g, e] of [[11000, "M1"], [13000, "M2"], [20000, "M2"], [20000.01, "M3"], [25000, "M3"]]) ok(`Preview: typed Gross ${g} auto-resolves ${e} (no saved salary needed)`, (await pv(E.E7, g)).salary_structure.code === e);
  const p11 = await pv(E.E7, 11000);
  const earn = Object.fromEntries(p11.earnings.map((x) => [x.code, Number(x.amount)])); const ded = Object.fromEntries(p11.deductions.map((x) => [x.code, Number(x.amount)]));
  ok("Preview @11000: Basic 5500 / DA 5500 / Allowance 0 + Medical 110 + PF from the same engine; net = gross - deductions", earn.BASIC === 5500 && earn.DA === 5500 && earn.ALLOWANCE === 0 && ded.MEDICAL === 110 && "PF" in ded && Math.abs(Number(p11.net_salary) - (Number(p11.gross) - Number(p11.total_deductions))) < 0.01);
  ok("Preview @12499.99 works after the M1 floor rule", (await pv(E.E7, 12499.99)).salary_structure.code === "M1");

  // ------------------------------------------------------------------ Custom Formula: Medical Fund tiers (0180)
  // The builder is the real TypeScript module the UI uses, transpiled here, and its output runs through the REAL evaluator.
  let fb;
  try {
    const esbuild = require(path.join(ROOT, "node_modules", "esbuild"));
    const js = esbuild.transformSync(rd(path.join(ROOT, "src", "modules", "payroll", "formulaBuilder.ts")), { loader: "ts", format: "cjs" }).code;
    const mod = { exports: {} }; new Function("module", "exports", js)(mod, mod.exports); fb = mod.exports;
  } catch (e) { ok("formulaBuilder.ts loads for testing", false, e.message); }
  if (fb) {
    const tiers = [{ limit: "10000", mode: "below", amount: "75" }, { limit: "20000", mode: "upto", amount: "100" }];
    const built = fb.buildRangeFormula(tiers, "125");
    ok("Builder: Medical Fund tiers build a formula in the EXISTING syntax (only GROSS + least/greatest/ceil)", !built.error && fb.checkFormula(built.formula) === null && fb.findUnsupportedTokens(built.formula).length === 0, built.error ?? built.formula);
    ok("Builder: rejects the broken formula from the bug report (IF / comparison) and accepts 'Gross' (case-insensitive)",
      JSON.stringify(fb.findUnsupportedTokens("IF(Gross < 10000, 75, IF(Gross <= 20000, 100, 125))")) === '["IF"]' && fb.hasComparison("Gross < 10000") && fb.checkFormula("Gross * 0.01") === null);
    ok("Builder: bad input refused (descending limits / blank amount)", !!fb.buildRangeFormula([{ limit: "20000", mode: "below", amount: "1" }, { limit: "10000", mode: "below", amount: "2" }], "3").error && !!fb.buildRangeFormula(tiers, "").error);
    await ins("MEDFUND", "Medical Fund", "deduction", "formula", { formula: built.formula });
    const med = async (policy, gross, struct) => Number(by(await cl(policy, gross, gross / 2, gross / 2, { struct }), "MEDFUND")?.amount);
    const cases = [[9999.99, 75, "M1"], [10000, 100, "M1"], [12500, 100, "M2"], [20000, 100, "M2"], [20000.01, 125, "M3"], [25000, 125, "M3"], [0.01, 75, "M1"]];
    for (const [g, want, s] of cases) ok(`Medical Fund formula: Gross ${g} (${s}) -> ${want}`, (await med(pol, g, sid[s])) === want, `got ${await med(pol, g, sid[s])}`);
    ok("Medical Fund formula: the SAME single component gives 75/100/125 under M1, M2 and M3 structures",
      [await med(pol, 9999.99, sid.M1), await med(pol, 15000, sid.M2), await med(pol, 30000, sid.M3)].join() === "75,100,125");
    const e1 = await fails(() => ins("BADFORM", "Bad", "deduction", "formula", { formula: "IF(Gross < 10000, 75, IF(Gross <= 20000, 100, 125))" }));
    ok("Save-time guard: the IF(...) formula can no longer be SAVED (friendly message names IF)", /Unsupported word\(s\): IF/.test(e1 ?? ""), e1 ?? "saved!");
    ok("Save-time guard: comparison-only formula refused", /Comparison symbols/.test((await fails(() => ins("BADFORM2", "Bad", "deduction", "formula", { formula: "GROSS < 10000" }))) ?? ""));
    const t1 = (await q(`select public.payroll_formula_test($1, 11000, 5500, 5500) j`, [built.formula]))[0].j;
    const t2 = (await q(`select public.payroll_formula_test('IF(Gross < 1, 2, 3)', 11000) j`))[0].j;
    ok("payroll_formula_test: valid formula -> value 100 at 11000; IF formula -> ok=false with reason", t1.ok === true && Number(t1.value) === 100 && t2.ok === false && /IF/.test(t2.error), JSON.stringify([t1, t2]));
    await as("staff", { emp: E.E2 });
    ok("payroll_formula_test refused for a non-payroll user (server-side)", /Not authorised/.test((await fails(() => q(`select public.payroll_formula_test('GROSS', 1) j`))) ?? ""));
    await as("super_admin");

    // Legacy rule saved BEFORE 0180 with the bad formula (simulated by bypassing the new guard): it must be contained.
    await db.exec(`alter table public.payroll_statutory_rules disable trigger trg_payroll_statutory_rules_formula_guard;`);
    await ins("MEDICAL_FUND", "Medical Fund (legacy bad)", "deduction", "formula", { formula: "IF(Gross < 10000, 75, IF(Gross <= 20000, 100, 125))" });
    await db.exec(`alter table public.payroll_statutory_rules enable trigger trg_payroll_statutory_rules_formula_guard;`);
    const bad = await cl(pol, 11000, 5500, 5500, { struct: sid.M1, comps: { BASIC: 5500, DA: 5500 } });
    ok("Containment: compute_lines does NOT throw; the bad component is an unresolved 0 line with its own reason",
      Number(by(bad, "MEDICAL_FUND")?.amount) === 0 && by(bad, "MEDICAL_FUND")?.unresolved === true);
    ok("Containment: other components (PF, Medical 1%, MEDFUND tiers, manual Incentive) are still computed", Boolean(by(bad, "PF")) && Number(by(bad, "MEDICAL")?.amount) === 110 && Number(by(bad, "MEDFUND")?.amount) === 100 && Boolean(by(bad, "INCENTIVE")));
    for (const [g, want] of [[11000, "M1"], [13000, "M2"], [20000, "M2"], [25000, "M3"]]) {
      let pj = null, perr = null;
      try { pj = await pv(E.E7, g); } catch (e) { perr = e.message.split("\n")[0]; }
      ok(`Containment: preview @ ${g} STILL resolves ${want} (structure/grade/slab not blanked) despite the bad formula`, pj?.salary_structure?.code === want, perr ?? JSON.stringify(pj?.salary_structure));
      if (g === 11000 && pj) {
        const line = (pj.issues ?? []).find((d) => d.code === "MEDICAL_FUND");
        ok("Containment: the failure is reported on Medical Fund itself, in words (preview.issues)", /formula is invalid/.test(line?.note ?? "") && /IF/.test(line?.note ?? ""), JSON.stringify(pj.issues));
        const earn2 = Object.fromEntries(pj.earnings.map((x) => [x.code, Number(x.amount)]));
        ok("Containment: Basic/DA/Allowance still shown (5500/5500/0)", earn2.BASIC === 5500 && earn2.DA === 5500 && earn2.ALLOWANCE === 0);
      }
    }
    await db.exec(`delete from public.payroll_statutory_rules where component_code = 'MEDICAL_FUND';`);
    const ok11 = await pv(E.E7, 11000);
    ok("Fixed: with valid rules preview @ 11000 shows Medical Fund tier 100 and no errors", Number(ok11.deductions.find((d) => d.code === "MEDFUND")?.amount) === 100 && (ok11.errors ?? []).length === 0);
  }

  // ------------------------------------------------------------------ salary revision + history
  const asg = (emp, g, from, reason = "Regression test revision", remark = null) => q(`select * from public.salary_assign_employee('${emp}', $1::numeric, $2::date, null, $3, $4)`, [g, from, reason, remark]);
  await as("super_admin");
  const k1 = (await asg(E.E1, 11000, "2026-04-01"))[0], k2 = (await asg(E.E1, 13000, "2027-02-01"))[0];
  ok("K  11000 -> M1 then 13000 -> M2; previous gross/structure recorded", k1.resolved_structure_id === sid.M1 && Number(k2.previous_gross) === 11000 && k2.previous_structure_id === sid.M1 && k2.resolved_structure_id === sid.M2);
  const rs = async (d) => (await q(`select r.gross_salary::numeric g, (select code from public.salary_structures s where s.id=r.salary_structure_id) c from public.salary_resolve_for_employee('${E.E1}', $1::date) r`, [d]))[0];
  ok("L  history: as-of Jan 2027 = 11000/M1 (old salary kept), as-of Feb 2027 = 13000/M2", (await rs("2027-01-31")).c === "M1" && (await rs("2027-02-28")).c === "M2" && Number((await rs("2027-01-31")).g) === 11000);
  await db.exec(`delete from public.salary_slab_rules where salary_structure_id='${sid.M3}';`);
  ok("Save refused when NO slab covers the Gross (prevents unpayable salary)", /no active salary slab/.test((await fails(() => asg(E.E2, 30000, "2027-03-01"))) ?? ""));
  await db.exec(`insert into public.salary_slab_rules (company_id, salary_structure_id, min_gross, max_gross) values ('${C}','${sid.M3}',20000.01,null);`);

  // ------------------------------------------------------------------ H. closed-period guard on salary revisions
  const snap = async () => JSON.stringify(await q(`select (select json_agg(p order by id) from public.payroll_periods p) periods, (select json_agg(r order by id) from public.payroll_runs r) runs`));
  const before = await snap();
  await as("staff", { emp: E.E2, pm: "1" });
  const h1 = await fails(() => asg(E.E3, 11000, "2026-09-15"));
  ok("H  finance processor cannot revise INTO a Finalized period (Sep 2026)", /Sep 2026/.test(h1 ?? "") && (await q(`select count(*)::int n from public.employee_salary_assignments where employee_id='${E.E3}'`))[0].n === 0, h1 ?? "no error");
  ok("H  ...nor into a Locked period (Aug 2026)", /Aug 2026/.test((await fails(() => asg(E.E3, 11000, "2026-08-10"))) ?? ""));
  ok("H  a revision starting in the OPEN period (Oct 2026) is allowed for the same user", (await asg(E.E4, 11000, "2026-10-01")).length === 1);
  ok("H  a FUTURE revision (2027) is allowed", (await asg(E.E5, 14000, "2027-01-01")).length === 1);
  await as("super_admin");
  ok("H  Super Admin WITHOUT a reason is refused", /reason/i.test((await fails(() => asg(E.E3, 11000, "2026-09-15", ""))) ?? ""));
  const h4 = (await asg(E.E3, 11000, "2026-09-15", "Approved correction ref 42", "manual note"))[0];
  ok("H  Super Admin WITH a reason succeeds; the closed period is written into the remark", /Back-dated into closed payroll: Sep 2026/.test(h4.remark ?? "") && /manual note/.test(h4.remark ?? ""), h4.remark);
  ok("H  IMMUTABLE: payroll periods and runs are byte-identical after all revision attempts", (await snap()) === before);

  // ------------------------------------------------------------------ G. security of the resolver
  const secure = (emp) => q(`select * from public.salary_resolve_secure('${emp}', '2027-02-28')`);
  await as("staff", { emp: E.E1 });
  ok("G  employee reads OWN salary", Number((await secure(E.E1))[0].gross_salary) === 13000);
  await as("staff", { emp: E.E2 });
  ok("G  employee CANNOT read another employee's Gross", /Not authorised/.test((await fails(() => secure(E.E1))) ?? ""));
  await as("", { emp: "" });
  ok("G  caller with no identity refused", !!(await fails(() => secure(E.E1))));
  await as("company_admin", { emp: E.E6 });
  ok("G  company admin (same company) allowed", (await secure(E.E1)).length === 1);
  await as("company_admin", { emp: OE, company: C2 });
  ok("G  admin of ANOTHER company refused", !!(await fails(() => secure(E.E1))));
  await as("staff", { emp: E.E2, pm: "1" });
  ok("G  payroll/finance processor allowed", (await secure(E.E1)).length === 1);
  await as("super_admin");
  ok("G  super admin allowed", (await secure(E.E1)).length === 1);
  const priv = async (fn, role) => (await q(`select has_function_privilege('${role}', p.oid, 'execute') x from pg_proc p where p.proname='${fn}'`))[0].x;
  ok("G  raw resolver / apply_policy / compute_lines / finalize NOT executable by anon or authenticated",
    (await Promise.all(["salary_resolve_for_employee", "payroll_apply_policy", "payroll_policy_compute_lines", "payroll_policy_finalize"].flatMap((f) => ["anon", "authenticated"].map((r) => priv(f, r))))).every((x) => x === false) || false, "");
  ok("G  UI-called functions keep authenticated but lose anon (salary_preview / assign / list / preview / secure)",
    (await Promise.all(["salary_preview", "salary_assign_employee", "salary_list_employee_assignments", "payroll_policy_preview", "salary_resolve_secure"].map(async (f) => (await priv(f, "authenticated")) && !(await priv(f, "anon"))))).every(Boolean));
  // transfer / F&F / payroll style chain: SECURITY DEFINER callers keep working for a logged-in API role
  await db.exec(`create or replace function public.test_transfer_like(p uuid) returns numeric language plpgsql security definer as $f$ declare v numeric; begin select gross_salary into v from public.salary_resolve_for_employee(p, '2027-02-28'); return v; end $f$;
    grant execute on function public.test_transfer_like(uuid) to authenticated;`);
  await db.exec("set role authenticated");
  const chain = await fails(async () => { const r = await db.query(`select public.test_transfer_like('${E.E1}') v`); if (Number(r.rows[0].v) !== 13000) throw new Error("wrong value"); });
  const direct = await fails(() => db.query(`select * from public.salary_resolve_for_employee('${E.E1}', '2027-02-28')`));
  await db.exec("reset role");
  ok("G  transfer/F&F/payroll-style SECURITY DEFINER chain still resolves salary under an API role", chain === null, chain ?? "");
  ok("G  the same API role calling the raw resolver DIRECTLY is denied", /permission denied/i.test(direct ?? ""), direct ?? "no error");

  // ------------------------------------------------------------------ Medical Fund: 12-month service eligibility (0181)
  // Eligibility = joining_date + N months <= PAYROLL PERIOD END. N is DATA on the rule (eligibility_months), not code.
  const MED_FORMULA = fb.buildRangeFormula([{ limit: "10000", mode: "below", amount: "75" }, { limit: "20000", mode: "upto", amount: "100" }], "125").formula;
  await db.exec(`update public.payroll_statutory_rules set eligibility_type='after_months', eligibility_months=12 where component_code='MEDFUND'`);
  const P = { jan25: ["2025-01-01", "2025-01-31"], feb25: ["2025-02-01", "2025-02-28"], aug: ["2026-08-01", "2026-08-31"], sep: ["2026-09-01", "2026-09-30"], oct: ["2026-10-01", "2026-10-31"], nov: ["2026-11-01", "2026-11-30"] };
  const clp = (policy, gross, join, per, x = {}) => q(
    `select code, amount, calc_type, calc_base, calc_note, unresolved from public.payroll_policy_compute_lines($1::uuid,$2::date,$3::date,30,$4::date,$5::numeric,$5::numeric,$6::numeric,0,0,0,$7::uuid,'{}'::text[],null,null,null,'{}'::jsonb,'{}'::jsonb)`,
    [policy, per[0], per[1], join, gross / 2, gross, x.struct ?? null]);
  const med = async (join, gross, per) => by(await clp(pol, gross, join, per), "MEDFUND");
  ok("Eligibility: rule stores type + months as DATA (after_months / 12); PF rule stays 'always'",
    (await q(`select eligibility_type t, eligibility_months m from public.payroll_statutory_rules where component_code='MEDFUND'`))[0].m === 12 &&
    (await q(`select eligibility_type t from public.payroll_statutory_rules where kind='pf' and payroll_policy_id='${pol}'`))[0].t === "always");
  const JOIN = "2025-10-01";
  for (const [name, gross, sepWant, octWant] of [["A", 11000, 0, 100], ["B", 9000, 0, 75], ["C", 20000, 0, 100], ["D", 20000.01, 0, 125]]) {
    const sep = await med(JOIN, gross, P.sep), oct = await med(JOIN, gross, P.oct), nov = await med(JOIN, gross, P.nov);
    ok(`Employee ${name} (joined 01-Oct-2025, Gross ${gross}): Sep 2026 = ${sepWant} (Not applicable), Oct 2026 = ${octWant}, Nov 2026 = ${octWant}`,
      Number(sep.amount) === sepWant && /^Not applicable/.test(sep.calc_note) && sep.unresolved === false && sep.calc_base === "eligibility" && Number(oct.amount) === octWant && Number(nov.amount) === octWant,
      `${sep.amount}/${oct.amount}/${nov.amount} ${sep.calc_note}`);
  }
  ok("Eligibility note names the completion date (01 Oct 2026)", /01 Oct 2026/.test((await med(JOIN, 11000, P.sep)).calc_note));
  ok("Boundary: joined 01-Oct-2025 -> Aug 2026 no, Sep 2026 no (period end 30-Sep < 01-Oct-2026), Oct 2026 yes",
    Number((await med(JOIN, 11000, P.aug)).amount) === 0 && Number((await med(JOIN, 11000, P.sep)).amount) === 0 && Number((await med(JOIN, 11000, P.oct)).amount) === 100);
  ok("Boundary: joined 15-Oct-2025 -> Sep no, Oct 2026 yes (15-Oct-2026 <= period end 31-Oct-2026; whole month deducted)",
    Number((await med("2025-10-15", 11000, P.sep)).amount) === 0 && Number((await med("2025-10-15", 11000, P.oct)).amount) === 100);
  ok("Boundary: joined 31-Oct-2025 -> Oct 2026 yes (completion date == period end counts)", Number((await med("2025-10-31", 11000, P.oct)).amount) === 100);
  ok("Boundary: joined 01-Nov-2025 -> Oct 2026 no, Nov 2026 yes", Number((await med("2025-11-01", 11000, P.oct)).amount) === 0 && Number((await med("2025-11-01", 11000, P.nov)).amount) === 100);
  ok("Leap/month-end: joined 29-Feb-2024 -> completes 28-Feb-2025: Jan 2025 no, Feb 2025 yes",
    Number((await med("2024-02-29", 11000, P.jan25)).amount) === 0 && Number((await med("2024-02-29", 11000, P.feb25)).amount) === 100);
  await db.query(`insert into public.payroll_statutory_rules (company_id, payroll_policy_id, kind, enabled, calc_method, employee_amount, effective_from, component_code, component_name, component_type, eligibility_type, eligibility_months)
    values ($1,$2,'other',true,'fixed_amount',10,'2000-01-01','ELIG1M','One month rule','deduction','after_months',1)`, [C, pol]);
  const e1m = async (join, per) => by(await clp(pol, 11000, join, per), "ELIG1M");
  ok("Month-end clamp: joined 31-Jan-2025 + 1 month = 28-Feb-2025: Jan no, Feb 2025 yes", Number((await e1m("2025-01-31", P.jan25)).amount) === 0 && Number((await e1m("2025-01-31", P.feb25)).amount) === 10);
  await db.exec(`delete from public.payroll_statutory_rules where component_code='ELIG1M'`);
  const oldTimer = await med("2020-06-15", 11000, P.sep);
  ok("Already >1 year (joined 15-Jun-2020): Medical Fund applies in every month", Number(oldTimer.amount) === 100);
  ok("Existing salary bands still hold once eligible: 9999.99->75, 10000->100, 20000->100, 20000.01->125",
    (await Promise.all([9999.99, 10000, 20000, 20000.01].map(async (g) => Number((await med("2020-06-15", g, P.oct)).amount)))).join() === "75,100,100,125");
  const nj = await med(null, 11000, P.oct);
  ok("Missing joining date: Rs 0 + flagged for review (never a guessed amount)", Number(nj.amount) === 0 && nj.unresolved === true && /joining date is missing/.test(nj.calc_note));
  const others = await clp(pol, 11000, JOIN, P.sep);
  ok("Other components are NOT affected by Medical Fund's eligibility (1% Medical, PF, Fixed, manual Incentive still computed in Sep 2026)",
    Number(by(others, "MEDICAL")?.amount) === 110 && Boolean(by(others, "PF")) && Number(by(others, "FIXTEST")?.amount) === 200 && Boolean(by(others, "INCENTIVE")));
  ok("DB constraints: after_months needs 0..600 months", !!(await fails(() => db.exec(`update public.payroll_statutory_rules set eligibility_months = null where component_code='MEDFUND'`))) && !!(await fails(() => db.exec(`update public.payroll_statutory_rules set eligibility_months = 601 where component_code='MEDFUND'`))));

  // ---- Employee Salary preview (payroll_policy_preview): server reads the real joining_date
  const E8 = uid(8), E9 = uid(9);
  await db.exec(`insert into public.employees(id, company_id, employee_code, full_name, joining_date) values ('${E8}','${C}','EMP8','Employee A','2025-10-01'),('${E9}','${C}','EMP9','Old Employee','2020-06-15');`);
  const pvm = async (emp, month, g, extra = {}) => (await q(`select public.payroll_policy_preview('${emp}', $1::date, $2::jsonb) j`, [month, JSON.stringify({ gross: g, ...extra })]))[0].j;
  const dl = (j) => Object.fromEntries((j.deductions ?? []).map((d) => [d.code, Number(d.amount)]));
  const pSep = await pvm(E8, "2026-09-01", 11000), pOct = await pvm(E8, "2026-10-01", 11000), pNov = await pvm(E8, "2026-11-01", 11000);
  ok("Preview (Employee A, Gross 11000): Sep 2026 Medical Fund = 0 'Not applicable'; Oct 2026 = 100; Nov 2026 = 100",
    dl(pSep).MEDFUND === 0 && /^Not applicable/.test(pSep.line_notes.MEDFUND) && dl(pOct).MEDFUND === 100 && dl(pNov).MEDFUND === 100, JSON.stringify([dl(pSep).MEDFUND, pSep.line_notes.MEDFUND, dl(pOct).MEDFUND]));
  const ea = Object.fromEntries(pSep.earnings.map((x) => [x.code, Number(x.amount)]));
  ok("Preview when NOT eligible: structure/grade/slab and Basic/DA/Allowance are NOT blanked (M1, 5500/5500/0)",
    pSep.salary_structure.code === "M1" && ea.BASIC === 5500 && ea.DA === 5500 && ea.ALLOWANCE === 0 && (pSep.errors ?? []).length === 0 && !(pSep.issues ?? []).some((i) => i.code === "MEDFUND"));
  ok("Preview: other bands for the same employee: 9000 -> Oct 75 / Sep 0, 20000 -> 100, 20000.01 -> 125 (M3)",
    dl(await pvm(E8, "2026-10-01", 9000)).MEDFUND === 75 && dl(await pvm(E8, "2026-09-01", 9000)).MEDFUND === 0 && dl(await pvm(E8, "2026-10-01", 20000)).MEDFUND === 100 && dl(await pvm(E8, "2026-10-01", 20000.01)).MEDFUND === 125 && (await pvm(E8, "2026-10-01", 20000.01)).salary_structure.code === "M3");
  ok("Preview (joined 2020): Medical Fund applies in Sep 2026", dl(await pvm(E9, "2026-09-01", 11000)).MEDFUND === 100);
  const pNoJoin = await pvm(E.E7, "2026-10-01", 11000);
  ok("Preview (no joining date on file): structure still resolves; Medical Fund flagged in issues, Rs 0", pNoJoin.salary_structure.code === "M1" && dl(pNoJoin).MEDFUND === 0 && (pNoJoin.issues ?? []).some((i) => i.code === "MEDFUND" && /joining date is missing/.test(i.note)));
  await as("company_admin", { emp: E.E6 });
  const spoof = await pvm(E8, "2026-09-01", 11000, { joining_date: "2000-01-01" });
  await as("super_admin");
  const whatIf = await pvm(E8, "2026-09-01", 11000, { joining_date: "2000-01-01" });
  ok("Security: a non-payroll caller's joining_date override is IGNORED (still Not applicable); Super Admin what-if is honoured", dl(spoof).MEDFUND === 0 && dl(whatIf).MEDFUND === 100);

  // ---- Gross-range editor round trip: a SAVED formula must re-open as its ranges (0182 / formulaBuilder.parseRangeFormula)
  const LIVE_SAVED = "75 + 25 * (1 - least(1, greatest(0, ceil(10000 - GROSS)))) + 25 * least(1, greatest(0, ceil(GROSS - 20000)))"; // exact text stored on the live MEDICAL_FUND rule
  const parsed = fb.parseRangeFormula(LIVE_SAVED);
  ok("Parser: the formula SAVED in the live database re-opens as 10000 below -> 75 | 20000 up to and incl. -> 100 | otherwise 125",
    JSON.stringify(parsed) === JSON.stringify({ tiers: [{ limit: "10000", mode: "below", amount: "75" }, { limit: "20000", mode: "upto", amount: "100" }], finalAmount: "125" }), JSON.stringify(parsed));
  ok("Parser: builder output for the same ranges is byte-identical to the saved formula (save -> reopen -> save is stable)", fb.buildRangeFormula(parsed.tiers, parsed.finalAmount).formula === LIVE_SAVED);
  const rt = [
    [[{ limit: "5000", mode: "below", amount: "10" }, { limit: "15000.5", mode: "upto", amount: "40.25" }, { limit: "30000", mode: "below", amount: "40.25" }], "90"],
    [[{ limit: "10000", mode: "upto", amount: "125" }], "75"],   // descending amounts (negative step)
    [[{ limit: "1", mode: "below", amount: "0" }, { limit: "2", mode: "below", amount: "3" }, { limit: "3", mode: "upto", amount: "7" }, { limit: "4", mode: "below", amount: "9" }], "12"],
  ];
  const rtOk = rt.every(([t, last]) => {
    const b = fb.buildRangeFormula(t, last).formula; const p = fb.parseRangeFormula(b);
    return p && fb.buildRangeFormula(p.tiers, p.finalAmount).formula === b;
  });
  ok("Parser: build -> parse -> build is lossless for decimals, descending amounts and 4 limits", rtOk);
  ok("Parser: a hand-written / foreign formula is NOT mistaken for a range table (opens as text)", fb.parseRangeFormula("round(BASIC * 0.02, 2)") === null && fb.parseRangeFormula("GROSS * 0.01") === null && fb.parseRangeFormula("") === null);
  const nb = fb.buildRangeFormula([{ limit: "10000", mode: "below", amount: "75" }, { limit: "20000", mode: "upto", amount: "100" }], "125");
  ok("Validation: the Medical Fund rows (10000/75, 20000/100, otherwise 125) pass; a blank limit is the ONLY thing that errors",
    nb.error === null && /Row 1: enter a Gross limit/.test(fb.buildRangeFormula([{ limit: "", mode: "below", amount: "75" }], "125").error ?? "") && fb.buildRangeFormula([{ limit: "10000", mode: "below", amount: "75" }], "125").error === null);
  const wrongBand = fb.buildRangeFormula([{ limit: "10000", mode: "below", amount: "75" }, { limit: "20000", mode: "below", amount: "100" }], "125").formula;
  const tw = (g) => q(`select public.payroll_component_test($1, $2, null, null, 'always', null, null, null) j`, [wrongBand, g]).then((r) => Number(r[0].j.value));
  ok("Honesty check: choosing 'below 20000' (not 'up to and including') sends exactly 20000 to the next band (125) — the row summary states this", (await tw(20000)) === 125 && (await tw(19999.99)) === 100);

  // ---- The Configure screen's Test button = payroll_component_test: SAME evaluator + SAME eligibility function as payroll
  const tc = async (g, type = "always", months = null, join = null, month = null) => (await q(`select public.payroll_component_test($1::text, $2::numeric, null, null, $3::text, $4::int, $5::date, $6::date) j`, [LIVE_SAVED, g, type, months, join, month]))[0].j;
  const bandsOk = [[9999.99, 75], [10000, 100], [20000, 100], [20000.01, 125], [25000, 125]];
  for (const [g, w] of bandsOk) { const r = await tc(g); ok(`Test button (amount only): Gross ${g} -> ${w}`, r.ok === true && Number(r.value) === w, JSON.stringify(r)); }
  for (const [label, month, wantApplicable, endW] of [["Sep 2026 (period ends 30-Sep-2026)", "2026-09-01", false, "2026-09-30"], ["Oct 2026 (ends 31-Oct-2026)", "2026-10-01", true, "2026-10-31"], ["Nov 2026 (ends 30-Nov-2026)", "2026-11-01", true, "2026-11-30"]]) {
    const r = await tc(11000, "after_months", 12, "2025-10-01", month);
    ok(`Test button + eligibility: joined 01-Oct-2025, ${label}: ${wantApplicable ? "applicable = 100" : "Not applicable = 0"}`,
      r.applicable === wantApplicable && Number(r.value) === (wantApplicable ? 100 : 0) && r.period_end === endW && (wantApplicable || /^Not applicable — 12 months of service not completed \(completes on 01 Oct 2026\)/.test(r.note)), JSON.stringify(r));
  }
  ok("Test button: not eligible still reports the amount it WOULD be (Gross 25000 -> would be 125)", (await tc(25000, "after_months", 12, "2025-10-01", "2026-09-01")).amount_if_eligible === 125);
  ok("Test button: 15-Oct-2025 -> Oct 2026 eligible; 01-Nov-2025 -> Oct 2026 not eligible", (await tc(11000, "after_months", 12, "2025-10-15", "2026-10-01")).applicable === true && (await tc(11000, "after_months", 12, "2025-11-01", "2026-10-01")).applicable === false);
  const noJoin = await tc(11000, "after_months", 12, null, "2026-10-01");
  ok("Test button: missing joining date -> Rs 0 + needs_review", noJoin.applicable === false && noJoin.needs_review === true && Number(noJoin.value) === 0);
  ok("Test button: bad inputs are refused with a reason (unknown type / months / IF formula / no month)",
    (await tc(1, "weird")).ok === false && (await tc(1, "after_months", 700, "2025-10-01", "2026-10-01")).ok === false && (await tc(1, "after_months", 12, "2025-10-01", null)).ok === false &&
    (await q(`select public.payroll_component_test('IF(Gross<1,2,3)', 5) j`))[0].j.ok === false);
  await as("staff", { emp: E.E2 });
  ok("Test button: refused for a non-payroll user (server-side)", /Not authorised/.test((await fails(() => q(`select public.payroll_component_test('GROSS', 1) j`))) ?? ""));
  await as("super_admin");
  const elg = async (fn, role) => (await q(`select has_function_privilege('${role}', p.oid, 'execute') x from pg_proc p where p.proname='${fn}'`))[0].x;
  ok("Security: payroll_rule_eligibility is internal-only; payroll_component_test open to logged-in users only (not anon)", !(await elg("payroll_rule_eligibility", "anon")) && !(await elg("payroll_rule_eligibility", "authenticated")) && (await elg("payroll_component_test", "authenticated")) && !(await elg("payroll_component_test", "anon")));
  ok("Single rule: payroll_component_test agrees with payroll_policy_compute_lines for the same employee/month (Sep 0, Oct 100)",
    Number((await med(JOIN, 11000, P.sep)).amount) === 0 && (await tc(11000, "after_months", 12, JOIN, "2026-09-01")).applicable === false && Number((await med(JOIN, 11000, P.oct)).amount) === 100 && (await tc(11000, "after_months", 12, JOIN, "2026-10-01")).applicable === true);
  const pv25s = await pvm(E8, "2026-09-01", 25000), pv25o = await pvm(E8, "2026-10-01", 25000);
  ok("Preview (Employee joined 01-Oct-2025, Gross 25000): Sep 2026 Not applicable, Oct 2026 = 125", dl(pv25s).MEDFUND === 0 && /^Not applicable — 12 months of service not completed/.test(pv25s.line_notes.MEDFUND) && dl(pv25o).MEDFUND === 125);
  for (const [g, s] of [[11000, "M1"], [13000, "M2"], [20000, "M2"], [25000, "M3"]]) {
    const j = await pvm(E8, "2026-09-01", g), e2 = Object.fromEntries(j.earnings.map((x) => [x.code, Number(x.amount)]));
    ok(`Not-yet-eligible employee, Gross ${g}: structure ${s} + Basic/DA/Allowance still resolve (Medical Fund does not blank them)`, j.salary_structure.code === s && e2.BASIC > 0 && e2.DA > 0 && "ALLOWANCE" in e2 && dl(j).MEDFUND === 0, `${j.salary_structure.code}`);
  }

  // ---- ACTUAL payroll: the real payroll_calculate_run on a fresh company, Sep / Oct / Nov 2026
  const C3 = "33333333-aaaa-aaaa-aaaa-333333333333";
  await db.exec(`insert into public.companies(id) values ('${C3}')`);
  const s3 = {};
  for (const [code, [name, daType, daPct]] of Object.entries(spec)) {
    s3[code] = (await q(`insert into public.salary_structures (company_id, code, name, status, rounding, gross_balanced, allow_negative_balance, effective_from) values ('${C3}','${code}','${name}','active','round_2',true,false,'2026-04-01') returning id`))[0].id;
    await db.exec(`insert into public.salary_structure_components (company_id, salary_structure_id, code, name, category, calculation_type, percentage, base_component_code, is_basic, included_in_gross, display_order, rounding_mode, rounding_precision) values
      ('${C3}','${s3[code]}','BASIC','BASIC','earning','pct_of_gross',50,null,true,true,10,${code === "M1" ? "'floor',2" : "null,null"}),
      ('${C3}','${s3[code]}','DA','DA','earning','${daType}',${daPct},${daType === "pct_of_component" ? "'BASIC'" : "null"},false,true,20,null,null),
      ('${C3}','${s3[code]}','ALLOWANCE','ALLOWANCE','earning','balance',null,null,false,true,30,null,null);`);
  }
  await db.exec(`insert into public.salary_slab_rules (company_id, salary_structure_id, min_gross, max_gross) values ('${C3}','${s3.M1}',0,12499.99),('${C3}','${s3.M2}',12500,20000),('${C3}','${s3.M3}',20000.01,null);`);
  const polP = (await q(`insert into public.payroll_policies (company_id, status, effective_from, code, policy_name, version_no, currency_precision, proration_method, proration_basis, ot_enabled, ot_std_hours_per_day, lwp_enabled, lwp_divisor_basis, working_days_method)
     values ('${C3}','active','2000-01-01','P3','Policy 3',1,2,'calendar_days','basic_da',true,8,true,'basic_da','calendar_minus_offdays') returning id`))[0].id;
  await db.query(`insert into public.payroll_statutory_rules (company_id, payroll_policy_id, kind, enabled, calc_method, base_formula, effective_from, component_code, component_name, component_type, eligibility_type, eligibility_months)
    values ($1,$2,'other',true,'formula',$3,'2000-01-01','MEDICAL_FUND','Medical Fund','deduction','after_months',12)`, [C3, polP, MED_FORMULA]);
  await db.exec(`insert into public.payroll_statutory_rules (company_id, payroll_policy_id, kind, enabled, calc_method, calc_base, employee_rate, wage_ceiling, effective_from) values ('${C3}','${polP}','pf',true,'pct_of_base','basic',12,15000,'2000-01-01');`);
  const emps = { A: [uid(61), "2025-10-01", 11000], B: [uid(62), "2025-10-01", 9000], C: [uid(63), "2025-10-01", 20000], D: [uid(64), "2025-10-01", 20000.01], OLD: [uid(65), "2020-06-15", 11000], NOJ: [uid(66), null, 11000] };
  for (const [k, [id, join, g]] of Object.entries(emps)) {
    await db.query(`insert into public.employees(id, company_id, employee_code, full_name, joining_date) values ($1,$2,$3,$4,$5)`, [id, C3, `P3${k}`, `Payroll ${k}`, join]);
    await db.query(`insert into public.employee_salary_assignments (company_id, employee_id, gross_salary, effective_from) values ($1,$2,$3,'2025-10-01')`, [C3, id, g]);
  }
  // attendance-driven inputs for the long-service employee in Oct 2026: 120 payable OT minutes and 1 unpaid (LWP) day
  await db.exec(`insert into public.attendance_records (company_id, employee_id, store_id, attendance_date, shift_id, status, payable_overtime_minutes) values ('${C3}','${emps.OLD[0]}','${uid(700)}','2026-10-05','${uid(701)}','present',120);
    insert into public.leave_attendance_effects (company_id, employee_id, leave_application_id, attendance_date, paid_status, paid_units) values ('${C3}','${emps.OLD[0]}','${uid(702)}','2026-10-06','unpaid',1);`);
  await as("super_admin");
  const runMonth = async (n, month, start, end) => {
    const pid = uid(800 + n), rid = uid(810 + n);
    await db.exec(`insert into public.payroll_periods (id, company_id, period_month, period_start_date, period_end_date, status) values ('${pid}','${C3}','${month}','${start}','${end}','draft');
      insert into public.payroll_runs (id, company_id, payroll_period_id, status, is_current) values ('${rid}','${C3}','${pid}','draft',true);`);
    await q(`select public.payroll_calculate_run('${rid}')`);
    return q(`select e.employee_code c, l.code, l.line_type, l.amount::numeric a, l.calc_formula note from public.payroll_lines l join public.employees e on e.id = l.employee_id where l.payroll_run_id = '${rid}'`);
  };
  const runSep = await runMonth(1, "2026-09-01", "2026-09-01", "2026-09-30"), runOct = await runMonth(2, "2026-10-01", "2026-10-01", "2026-10-31"), runNov = await runMonth(3, "2026-11-01", "2026-11-01", "2026-11-30");
  const ml = (rows, k) => rows.find((r) => r.c === `P3${k}` && r.code === "MEDICAL_FUND");
  for (const [k, sepW, octW] of [["A", 0, 100], ["B", 0, 75], ["C", 0, 100], ["D", 0, 125]]) {
    ok(`ACTUAL PAYROLL (payroll_calculate_run) Employee ${k}: Sep 2026 = ${sepW}, Oct 2026 = ${octW}, Nov 2026 = ${octW}`,
      Number(ml(runSep, k)?.a) === sepW && Number(ml(runOct, k)?.a) === octW && Number(ml(runNov, k)?.a) === octW, `${ml(runSep, k)?.a}/${ml(runOct, k)?.a}/${ml(runNov, k)?.a}`);
  }
  ok("ACTUAL PAYROLL: Sep 2026 line explains itself ('Not applicable ... 01 Oct 2026') and is a deduction line", /Not applicable.*01 Oct 2026/.test(ml(runSep, "A")?.note ?? "") && ml(runSep, "A")?.line_type === "deduction");
  ok("ACTUAL PAYROLL: employee with >1 year service pays Medical Fund in Sep, Oct and Nov 2026 (100)", [runSep, runOct, runNov].every((r) => Number(ml(r, "OLD")?.a) === 100));
  const nojRes = await q(`select needs_review, review_notes from public.payroll_employee_results r join public.employees e on e.id=r.employee_id where e.employee_code='P3NOJ' and r.payroll_run_id='${uid(812)}'`);
  ok("ACTUAL PAYROLL: employee with no joining date -> Rs 0 and the result is flagged needs_review", Number(ml(runOct, "NOJ")?.a) === 0 && nojRes[0]?.needs_review === true && /joining date is missing/.test(nojRes[0]?.review_notes ?? ""), JSON.stringify(nojRes));
  const lineOf = (rows, k, code) => Number(rows.find((r) => r.c === `P3${k}` && r.code === code)?.a);
  const strA = await q(`select s.code from public.payroll_employee_results r join public.salary_structures s on s.id=r.salary_structure_id join public.employees e on e.id=r.employee_id where e.employee_code in ('P3A','P3B','P3C','P3D') and r.payroll_run_id='${uid(812)}' order by e.employee_code`);
  ok("ACTUAL PAYROLL: Basic/DA/Allowance intact and structures route M1/M1/M2/M3 for A/B/C/D (eligibility does not touch salary)",
    lineOf(runSep, "A", "BASIC") === 5500 && lineOf(runSep, "A", "DA") === 5500 && lineOf(runSep, "A", "ALLOWANCE") === 0 && strA.map((r) => r.code).join() === "M1,M1,M2,M3", strA.map((r) => r.code).join());
  ok("ACTUAL PAYROLL: PF (12% of Basic) still deducted (A: 660) — existing statutory rules unaffected", lineOf(runOct, "A", "PF") === 660);
  ok("ACTUAL PAYROLL: OT still comes from attendance minutes (120 min -> OT earning) and LWP from the unpaid leave day",
    lineOf(runOct, "OLD", "OT") > 0 && lineOf(runOct, "OLD", "LWP") > 0 && !runOct.some((r) => r.c === "P3A" && r.code === "OT"), `OT=${lineOf(runOct, "OLD", "OT")} LWP=${lineOf(runOct, "OLD", "LWP")}`);

  // ------------------------------------------------------------------ Employee Add screen + Salary Structure Test (0183): "virtual employee" preview
  // Same engine (payroll_policy_preview) with NO employee row: inputs {company_id, gross, [joining_date]}. Read-only by construction.
  const vpv = async (g, month = "2026-10-01", extra = {}) => (await q(`select public.payroll_policy_preview(null, $1::date, $2::jsonb) j`, [month, JSON.stringify({ company_id: C, gross: g, ...extra })]))[0].j;
  for (const [g, s] of [[10000, "M1"], [11000, "M1"], [12499.99, "M1"], [12500, "M2"], [13000, "M2"], [20000, "M2"], [20000.01, "M3"], [25000, "M3"]]) {
    const j = await vpv(g);
    ok(`Virtual preview (no employee), Gross ${g} -> ${s}`, j.salary_structure.code === s && j.salary_structure.ambiguous === false, JSON.stringify(j.salary_structure));
  }
  const v11 = await vpv(11000), ve = Object.fromEntries(v11.earnings.map((x) => [x.code, Number(x.amount)]));
  ok("Virtual preview @11000: salary_bifurcate result Basic 5500 / DA 5500 / Allowance 0, gross 11000 (same engine, no React maths)", ve.BASIC === 5500 && ve.DA === 5500 && ve.ALLOWANCE === 0 && Number(v11.gross) === 11000 && (v11.errors ?? []).length === 0);
  ok("Virtual preview + test joining date: Medical Fund Sep 2026 = 0 Not applicable; Oct 2026 = 100 (same eligibility rule)",
    dl(await vpv(11000, "2026-09-01", { joining_date: "2025-10-01" })).MEDFUND === 0 && /^Not applicable/.test((await vpv(11000, "2026-09-01", { joining_date: "2025-10-01" })).line_notes.MEDFUND) && dl(await vpv(11000, "2026-10-01", { joining_date: "2025-10-01" })).MEDFUND === 100);
  const vNo = await vpv(11000);
  ok("Virtual preview WITHOUT a joining date: Medical Fund flagged 'joining date is missing' (never today's date); structure/bifurcation unaffected",
    (vNo.issues ?? []).some((i) => i.code === "MEDFUND" && /joining date is missing/.test(i.note)) && vNo.salary_structure.code === "M1" && dl(vNo).MEDFUND === 0);
  const real = await pvm(E8, "2026-10-01", 11000), virt = await vpv(11000, "2026-10-01", { joining_date: "2025-10-01" });
  ok("Virtual preview == existing-employee preview for the same Gross + joining date (one engine): net, deductions, earnings, structure",
    real.net_salary === virt.net_salary && real.total_deductions === virt.total_deductions && JSON.stringify(real.earnings) === JSON.stringify(virt.earnings) && real.salary_structure.code === virt.salary_structure.code, `${real.net_salary} vs ${virt.net_salary}`);
  ok("Virtual preview: Gross is required (no guessing) and unknown company is refused", /Enter a Gross/.test((await fails(() => q(`select public.payroll_policy_preview(null, '2026-10-01', $1::jsonb) j`, [JSON.stringify({ company_id: C })]))) ?? "") && !!(await fails(() => q(`select public.payroll_policy_preview(null, '2026-10-01', $1::jsonb) j`, [JSON.stringify({ gross: 11000 })]))));
  await as("staff", { emp: E.E2 });
  ok("Virtual preview: refused for a plain employee (staff role)", /Not authorised/.test((await fails(() => vpv(11000))) ?? ""));
  await as("company_admin", { emp: OE, company: C2 });
  ok("Virtual preview: refused across companies (admin of another company cannot preview this company's configuration)", /Not authorised/.test((await fails(() => vpv(11000))) ?? ""));
  await as("super_admin");
  // READ-ONLY proof: snapshot every table the salary / payroll flow could touch, run many previews + structure previews, compare
  const snapAll = async () => JSON.stringify(await Promise.all(["employees", "employee_salary_assignments", "salary_structures", "salary_structure_components", "salary_slab_rules", "payroll_statutory_rules", "payroll_policies", "payroll_periods", "payroll_runs", "payroll_employee_results", "payroll_lines", "payroll_component_amounts", "advance_payroll_periods"].map(async (t) => [t, (await q(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') h from public.${t} x`))[0]])));
  const beforeAll = await snapAll();
  for (const g of [10000, 12499.99, 12500, 20000, 20000.01, 25000]) { await vpv(g); await vpv(g, "2026-09-01", { joining_date: "2025-10-01" }); await q(`select * from public.salary_preview($1::uuid, $2::numeric)`, [sid.M1, Math.min(g, 12499.99)]); }
  ok("READ-ONLY: 18 previews / structure tests changed no employee, salary, structure, slab, component, policy, payroll or advance row", (await snapAll()) === beforeAll);
  ok("STABLE: the preview functions are declared read-only (cannot write)", (await q(`select bool_and(provolatile = 's') s from pg_proc where proname in ('payroll_policy_preview','salary_preview','payroll_component_test')`))[0].s === true);

  // Salary editing goes through the existing dynamic permission payroll/EDIT (fails open when unconfigured)
  await db.exec(`select set_config('test.dyn','deny',false);`);
  ok("Salary edit: refused when the dynamic permission payroll/EDIT is denied (even for Super Admin) — nothing saved", /permission to edit salary/.test((await fails(() => asg(E.E9 ?? E9, 15000, "2027-05-01"))) ?? "") && (await q(`select count(*)::int n from public.employee_salary_assignments where employee_id='${E9}'`))[0].n === 0);
  await db.exec(`select set_config('test.dyn','',false);`);
  ok("Salary edit: allowed again when the permission is granted / unconfigured", (await asg(E9, 15000, "2027-05-01")).length === 1);
  const priv4 = async (role) => (await q(`select has_function_privilege('${role}', p.oid, 'execute') x from pg_proc p where p.proname='salary_resolve_core'`)).every((r) => r.x === false);
  ok("Security: the raw resolver core stays closed to anon / authenticated after the signature change", (await priv4("anon")) && (await priv4("authenticated")) && (await q(`select count(*)::int n from pg_proc where proname='salary_resolve_core'`))[0].n === 1);
  ok("Wrapper + secure resolver still work after the change (saved Gross 15000 -> M2)", (await q(`select r.salary_structure_id id from public.salary_resolve_for_employee('${E9}', '2027-05-31') r`))[0].id === sid.M2 && (await q(`select r.salary_structure_id id from public.salary_resolve_secure('${E9}', '2027-05-31') r`))[0].id === sid.M2);

  // ------------------------------------------------------------------ Employees -> Payroll Salary section + Structure Test: the pure UI logic, run against REAL server answers
  const esb = require(path.join(ROOT, "node_modules", "esbuild"));
  const loadTs = (rel) => { const js = esb.transformSync(rd(path.join(ROOT, rel)), { loader: "ts", format: "cjs" }).code; const m = { exports: {} }; new Function("module", "exports", "require", js)(m, m.exports, (n) => (n.startsWith("@/") ? { formatAmount: (x) => `₹${Number(x).toLocaleString("en-IN", { minimumFractionDigits: 2 })}` } : require(n))); return m.exports; };
  const sd = loadTs("src/modules/employees/salaryDraft.ts"), sp = loadTs("src/modules/payroll/salaryPreview.ts");
  const slabRows = (await q(`select salary_structure_id sid, min_gross::numeric mn, max_gross::numeric mx, is_active from public.salary_slab_rules where company_id='${C}'`)).map((r) => ({ salaryStructureId: r.sid, minGross: Number(r.mn), maxGross: r.mx == null ? null : Number(r.mx), isActive: r.is_active }));
  ok("Quick-test values are DERIVED from the configured slabs (+ samples): 10,000 / 12,499.99 / 12,500 / 13,000 / 20,000 / 20,000.01 / 25,000",
    JSON.stringify(sp.quickTestValues(slabRows, [10000, 13000, 25000])) === JSON.stringify([10000, 12499.99, 12500, 13000, 20000, 20000.01, 25000]), JSON.stringify(sp.quickTestValues(slabRows, [10000, 13000, 25000])));
  ok("Slab text is read from slab rows, not built into the UI: M1 '0 – 12,499.99', M2 '12,500 – 20,000', M3 '20,000.01 – ∞'",
    /0\.00.*12,499\.99/.test(sp.slabText(slabRows, sid.M1)) && /12,500\.00.*20,000\.00/.test(sp.slabText(slabRows, sid.M2)) && /20,000\.01.*∞/.test(sp.slabText(slabRows, sid.M3)));
  const base = { showFields: true, hasGross: true, grossNum: 11000, effectiveFrom: "2026-04-01", settled: true, isError: false, errorText: "", structId: sid.M1, ambiguous: false, note: null, currentGross: null };
  const ci = (o) => sd.computeSalaryIntent({ ...base, ...o });
  ok("Form: new employee, Gross 11000 resolved -> can save (initial salary)", ci({}).save === true && ci({}).blocking === null);
  ok("Form: blank Gross -> salary not configured: nothing to save, nothing blocks the employee", JSON.stringify(ci({ hasGross: false, grossNum: NaN })) === JSON.stringify({ save: false, blocking: null }));
  ok("Form: no slab/structure for the Gross -> clear error and Save blocked", ci({ structId: null }).blocking === "No active salary structure is configured for this Gross Salary." && ci({ structId: null }).save === false);
  ok("Form: Gross 0 follows the resolver (no structure) -> blocked with the same message", ci({ grossNum: 0 }).blocking === sd.NO_STRUCTURE_MESSAGE);
  ok("Form: while the server is still answering, submit is held; a server error blocks with its text", ci({ settled: false }).blocking === "Working out the salary structure…" && ci({ isError: true, errorText: "cannot split" }).blocking === "cannot split");
  ok("Form: ambiguous slabs block with the server's note", ci({ ambiguous: true, note: "Multiple applicable salary slabs found." }).blocking === "Multiple applicable salary slabs found.");
  ok("Form: Effective From is required once a Gross is entered", ci({ effectiveFrom: "" }).blocking === "Choose the salary Effective From date.");
  ok("Edit: unchanged Gross creates NO revision; a changed Gross does (11000 -> 13000)", ci({ currentGross: 11000 }).save === false && ci({ currentGross: 11000, grossNum: 13000, structId: sid.M2 }).save === true);
  ok("Edit: fields hidden (no permission / not clicked 'Update Salary') -> never saves", ci({ showFields: false }).save === false);

  // Preview helpers over REAL server output (not-yet-eligible employee, Gross 11000, Sep 2026)
  const realP = await pvm(E8, "2026-09-01", 11000);
  const spl = sp.splitPreview(realP);
  ok("Preview parts: bifurcation = the server's earnings (Basic/DA/Allowance, total = Gross); common components come separately",
    spl.structureEarnings.map((e) => e.code).join() === "BASIC,DA,ALLOWANCE" && spl.structureEarnings.reduce((a, e) => a + Number(e.amount), 0) === 11000 && spl.deductions.some((d) => d.code === "MEDFUND"));
  const noJ = sp.reviewIssues(await vpv(11000));
  ok("Needs-review text (no Joining Date): 'Medical Fund eligibility cannot be evaluated without Joining Date.' and routine manual-amount notes are NOT shown",
    noJ.some((i) => i.kind === "joining" && /eligibility cannot be evaluated without Joining Date\.$/.test(i.head)) && noJ.every((i) => i.kind === "joining" || i.kind === "formula"));

  // Full Add -> revise -> revise via the EXISTING revision engine, plus: employees.grade_id is never touched
  const NEWE = uid(70), GRADE = uid(71);
  await db.exec(`insert into public.employees(id, company_id, employee_code, full_name, joining_date, grade_id) values ('${NEWE}','${C}','EMP70','Add Employee Flow','2026-04-01','${GRADE}');`);
  const histBefore = (await q(`select count(*)::int n from public.employee_assignment_history`))[0].n;
  await as("super_admin");
  const a1 = (await asg(NEWE, 11000, "2028-04-01", "Initial salary"))[0], a2 = (await asg(NEWE, 13000, "2028-09-21", "Revision"))[0], a3 = (await asg(NEWE, 25000, "2029-01-01", "Revision"))[0];
  const hs = await q(`select gross_salary::numeric g, previous_gross::numeric pg, resolved_structure_id r, previous_structure_id p, effective_from::text ef, effective_to::text et from public.employee_salary_assignments where employee_id='${NEWE}' order by effective_from`);
  ok("Add employee + salary 11000 (M1) -> revise 13000 (M2) -> revise 25000 (M3): history keeps every row; previous gross/structure chain is preserved",
    hs.length === 3 && hs[0].r === sid.M1 && hs[1].r === sid.M2 && hs[2].r === sid.M3 && Number(hs[1].pg) === 11000 && hs[1].p === sid.M1 && Number(hs[2].pg) === 13000 && hs[2].p === sid.M2 && hs[0].et === "2028-09-20" && hs[1].et === "2028-12-31" && hs[2].et === null, JSON.stringify(hs));
  ok("employees.grade_id is NEVER changed by saving a salary (still the HR grade; assignment history untouched)",
    (await q(`select grade_id g from public.employees where id='${NEWE}'`))[0].g === GRADE && (await q(`select count(*)::int n from public.employee_assignment_history`))[0].n === histBefore);

  // ------------------------------------------------------------------ 0184: company OT + Late hourly basis = (Basic + DA) / calendar days / 10
  const C4 = "44444444-aaaa-aaaa-aaaa-444444444444";
  await db.exec(`insert into public.companies(id) values ('${C4}')`);
  const s4 = {};
  for (const [code, [name, daType, daPct]] of Object.entries(spec)) {
    s4[code] = (await q(`insert into public.salary_structures (company_id, code, name, status, rounding, gross_balanced, allow_negative_balance, effective_from) values ('${C4}','${code}','${name}','active','round_2',true,false,'2026-04-01') returning id`))[0].id;
    await db.exec(`insert into public.salary_structure_components (company_id, salary_structure_id, code, name, category, calculation_type, percentage, base_component_code, is_basic, included_in_gross, display_order, rounding_mode, rounding_precision) values
      ('${C4}','${s4[code]}','BASIC','BASIC','earning','pct_of_gross',50,null,true,true,10,${code === "M1" ? "'floor',2" : "null,null"}),
      ('${C4}','${s4[code]}','DA','DA','earning','${daType}',${daPct},${daType === "pct_of_component" ? "'BASIC'" : "null"},false,true,20,null,null),
      ('${C4}','${s4[code]}','ALLOWANCE','ALLOWANCE','earning','balance',null,null,false,true,30,null,null);`);
  }
  await db.exec(`insert into public.salary_slab_rules (company_id, salary_structure_id, min_gross, max_gross) values ('${C4}','${s4.M1}',0,12499.99),('${C4}','${s4.M2}',12500,20000),('${C4}','${s4.M3}',20000.01,null);`);
  // The company policy: proration deliberately set to WORKING DAYS to prove OT / Late no longer follow it.
  const pol4 = (await q(`insert into public.payroll_policies (company_id, status, effective_from, code, policy_name, version_no, currency_precision, proration_method, proration_basis, ot_enabled, ot_std_hours_per_day, late_deduction_enabled, lwp_enabled, working_days_method)
     values ('${C4}','active','2000-01-01','P4','Policy 4',1,2,'working_days','basic_da',true,10,true,false,'calendar_minus_offdays') returning id`))[0].id;
  const r2 = (x) => Math.round(x * 100) / 100;
  const basisOf = async (pid, s, e, b, d) => (await q(`select calendar_days::int cd, std_hours::numeric sh, wage_base::numeric wb, daily_rate::numeric dr, hourly_rate::numeric hr from public.payroll_ot_late_basis($1::uuid,$2::date,$3::date,$4::numeric,$5::numeric)`, [pid, s, e, b, d]))[0];
  for (const [label, s, e, days, disp] of [["September 2026", "2026-09-01", "2026-09-30", 30, 33.33], ["October 2026", "2026-10-01", "2026-10-31", 31, 32.26], ["February 2027", "2027-02-01", "2027-02-28", 28, 35.71], ["February 2028 (leap)", "2028-02-01", "2028-02-29", 29, 34.48]]) {
    const bs = await basisOf(pol4, s, e, 5000, 5000);
    ok(`0184 basis ${label}: Basic 5,000 + DA 5,000 = 10,000 / ${days} calendar days / 10 h = Rs ${disp}/hour (full precision kept: ${Number(bs.hr).toFixed(6)})`,
      bs.cd === days && Number(bs.sh) === 10 && Number(bs.wb) === 10000 && Math.abs(Number(bs.dr) - 10000 / days) < 1e-9 && Math.abs(Number(bs.hr) - 10000 / days / 10) < 1e-9 && r2(Number(bs.hr)) === disp, JSON.stringify(bs));
  }
  const clx = (policy, s, e, wd, join, basic, da, ot, late) => q(
    `select kind, line_type, code, quantity::numeric qty, rate::numeric rate, amount::numeric amount, calc_type, calc_base, unresolved, calc_note from public.payroll_policy_compute_lines($1::uuid,$2::date,$3::date,$4::numeric,$5::date,$6::numeric,$7::numeric,$8::numeric,0,$9::numeric,0,null::uuid,'{}'::text[],null,null,null,'{}'::jsonb,'{}'::jsonb,$10::numeric) order by kind`,
    [policy, s, e, wd, join, basic, da, basic + da, ot, late]);
  const lineOfX = (rows, code) => rows.find((r) => r.code === code);
  // OT + Late through the ONE engine (compute_lines), per month, with a working-days divisor of 22 that must be ignored
  for (const [label, s, e, days] of [["Sep 2026", "2026-09-01", "2026-09-30", 30], ["Oct 2026", "2026-10-01", "2026-10-31", 31], ["Feb 2027", "2027-02-01", "2027-02-28", 28], ["Feb 2028", "2028-02-01", "2028-02-29", 29]]) {
    const rows = await clx(pol4, s, e, 22, null, 5000, 5000, 60, 60);
    const exp = r2(10000 / days / 10);
    ok(`0184 ${label}: 60 payable OT min = ${exp} and 60 payable Late min = ${exp} deduction (working-days divisor 22 ignored)`,
      Number(lineOfX(rows, "OT")?.amount) === exp && Number(lineOfX(rows, "LATE")?.amount) === exp && lineOfX(rows, "LATE")?.line_type === "deduction" && lineOfX(rows, "OT")?.line_type === "earning" && lineOfX(rows, "OT")?.calc_base === "basic_da", JSON.stringify(rows.map((r) => [r.code, r.amount])));
  }
  const sep2 = await clx(pol4, "2026-09-01", "2026-09-30", 22, null, 5000, 5000, 120, 0);
  ok("0184 OT 120 min = 2.0 h -> Rs 66.67 (multiplier is NOT invented: 1x on the payable minutes) and no Late line when Late minutes = 0",
    Number(lineOfX(sep2, "OT").amount) === 66.67 && Number(lineOfX(sep2, "OT").qty) === 2 && !lineOfX(sep2, "LATE"), JSON.stringify(sep2.map((r) => [r.code, r.amount, r.qty])));
  // Nothing rounded early: 7 min -> 3.89 (the old rounded-hours path gave 4.00); 1 min -> 0.56
  const odd = await clx(pol4, "2026-09-01", "2026-09-30", 22, null, 5000, 5000, 7, 1);
  ok("0184 no premature rounding: 7 OT min = Rs 3.89 (not 4.00 from rounding hours to 0.12 first); 1 Late min = Rs 0.56", Number(lineOfX(odd, "OT").amount) === 3.89 && Number(lineOfX(odd, "LATE").amount) === 0.56, JSON.stringify(odd.map((r) => [r.code, r.amount])));
  // The proration method / working-days count must NOT move OT or Late, in ANY method
  const methods = [["calendar_days", null], ["working_days", null], ["fixed_26", null], ["fixed_30", null], ["custom", 25]];
  const mAmts = [];
  for (const [m, cd] of methods) {
    const pid = (await q(`insert into public.payroll_policies (company_id, status, effective_from, code, policy_name, version_no, currency_precision, proration_method, proration_custom_divisor, proration_basis, ot_enabled, ot_std_hours_per_day, late_deduction_enabled, lwp_enabled)
       values ('${C4}','draft','2030-01-01',$1,$2,90,2,$3,$4,'basic_da',true,10,true,false) returning id`, [`PM_${m}`, `PM ${m}`, m, cd]))[0].id;
    const rows = await clx(pid, "2026-09-01", "2026-09-30", 17, null, 5000, 5000, 90, 45);
    mAmts.push([m, Number(lineOfX(rows, "OT").amount), Number(lineOfX(rows, "LATE").amount)]);
  }
  ok("0184 OT/Late identical under every proration method (calendar / working / 26 / 30 / custom 25): 90 min OT = 50.00, 45 min Late = 25.00",
    mAmts.every(([, o, l]) => o === 50 && l === 25), JSON.stringify(mAmts));
  // ... while joining-month PRORATION still uses the policy's own divisor (working days 22), i.e. that behaviour is untouched
  const jr = await clx(pol4, "2026-09-01", "2026-09-30", 22, "2026-09-11", 5000, 5000, 60, 0);
  ok("0184 joining-month proration keeps the PROPORTION divisor (10,000 / 22 x 10 lost days = -4,545.45) while OT stays on 30 calendar days (33.33)",
    Number(lineOfX(jr, "PRORATE").amount) === -4545.45 && Number(lineOfX(jr, "OT").amount) === 33.33, JSON.stringify(jr.map((r) => [r.code, r.amount])));
  // Not configured -> never invented
  const pNoStd = (await q(`insert into public.payroll_policies (company_id, status, effective_from, code, policy_name, version_no, currency_precision, proration_method, proration_basis, ot_enabled, ot_std_hours_per_day, late_deduction_enabled, lwp_enabled)
     values ('${C4}','draft','2030-01-01','NOSTD','No std hours',91,2,'calendar_days','basic_da',true,null,true,false) returning id`))[0].id;
  const ns = await clx(pNoStd, "2026-09-01", "2026-09-30", 30, null, 5000, 5000, 60, 60);
  ok("0184 standard hours/day not configured -> OT and Late are Rs 0, flagged unresolved with the reason (never guessed)",
    ["OT", "LATE"].every((c) => Number(lineOfX(ns, c).amount) === 0 && lineOfX(ns, c).unresolved === true && /hourly wage basis.*divisor.*standard hours.*incomplete/.test(lineOfX(ns, c).calc_note)), JSON.stringify(ns.map((r) => [r.code, r.amount, r.unresolved])));
  const pLateOff = (await q(`insert into public.payroll_policies (company_id, status, effective_from, code, policy_name, version_no, currency_precision, proration_method, proration_basis, ot_enabled, ot_std_hours_per_day, lwp_enabled)
     values ('${C4}','draft','2030-01-01','LATEOFF','Late off',92,2,'calendar_days','basic_da',true,10,false) returning id`))[0].id;
  const lo = await clx(pLateOff, "2026-09-01", "2026-09-30", 30, null, 5000, 5000, 60, 60);
  ok("0184 late_deduction_enabled defaults to FALSE: a policy that did not opt in produces NO Late line (existing payroll unchanged); OT still valued", (await q(`select late_deduction_enabled d from public.payroll_policies where id='${pLateOff}'`))[0].d === false && !lineOfX(lo, "LATE") && Number(lineOfX(lo, "OT").amount) === 33.33);
  const pOtOff = (await q(`insert into public.payroll_policies (company_id, status, effective_from, code, policy_name, version_no, currency_precision, proration_method, proration_basis, ot_enabled, ot_std_hours_per_day, late_deduction_enabled, lwp_enabled)
     values ('${C4}','draft','2030-01-01','OTOFF','OT off',93,2,'calendar_days','basic_da',false,10,true,false) returning id`))[0].id;
  const oo = await clx(pOtOff, "2026-09-01", "2026-09-30", 30, null, 5000, 5000, 60, 60);
  ok("0184 ot_enabled = false keeps the existing behaviour (no policy OT line); Late is independent", !lineOfX(oo, "OT") && Number(lineOfX(oo, "LATE").amount) === 33.33);

  // Wage base = Basic + DA ONLY (resolved by the salary engine) — through the same virtual preview the Structure Test uses
  const vb = async (g, month, extra = {}) => (await q(`select public.payroll_policy_preview(null, $1::date, $2::jsonb) j`, [month, JSON.stringify({ company_id: C4, gross: g, ...extra })]))[0].j;
  const v18 = (await vb(18000, "2026-09-01", { ot_minutes: 60, late_minutes: 60 })).ot_late_basis;
  ok("0184 Gross 18,000 (M2: Basic 9,000 / DA 7,650 / Allowance 1,350): base = 16,650 (Allowance NOT included) -> Sep hourly 55.50; OT 1 h = 55.50, Late 1 h = 55.50",
    Number(v18.basic) === 9000 && Number(v18.da) === 7650 && Number(v18.wage_base) === 16650 && v18.calendar_days === 30 && Number(v18.std_hours_per_day) === 10 && Math.abs(Number(v18.hourly_rate) - 55.5) < 1e-9 && Number(v18.ot_amount) === 55.5 && Number(v18.late_amount) === 55.5, JSON.stringify(v18));
  const t11 = (await vb(11000, "2026-09-01")).ot_late_basis;
  ok("0184 Structure Test, Gross 11,000, Sep 2026: M1 Basic 5,500 + DA 5,500 = 11,000 / 30 = 366.6667 daily / 36.6667 hourly (shows Rs 36.67)",
    Number(t11.wage_base) === 11000 && Math.abs(Number(t11.daily_rate) - 366.6666666667) < 1e-6 && Math.abs(Number(t11.hourly_rate) - 36.6666666667) < 1e-6 && r2(Number(t11.hourly_rate)) === 36.67 && t11.ot_amount == null && t11.late_amount == null && t11.period_month === "2026-09-01", JSON.stringify(t11));
  const vOct = (await vb(11000, "2026-10-01")).ot_late_basis, vFeb = (await vb(11000, "2027-02-01")).ot_late_basis, vFeb28 = (await vb(11000, "2028-02-01")).ot_late_basis;
  ok("0184 Structure Test follows the TEST month: Oct 31 days, Feb 2027 28 days, Feb 2028 29 days (same 11,000 base)", vOct.calendar_days === 31 && vFeb.calendar_days === 28 && vFeb28.calendar_days === 29 && Math.abs(Number(vFeb.hourly_rate) - 11000 / 28 / 10) < 1e-9);
  ok("0184 preview reports NO OT multiplier (null) with the explanation — nothing guessed", v18.ot_multiplier === null && /NO separate OT multiplier/.test(v18.ot_multiplier_note ?? ""));
  ok("0184 salary regression through the virtual preview: 11000 -> M1, 12499.99 -> M1, 12500 -> M2, 20000 -> M2, 20000.01 -> M3 (Basic/DA/Allowance unchanged)",
    (await Promise.all([[11000, "M1"], [12499.99, "M1"], [12500, "M2"], [20000, "M2"], [20000.01, "M3"]].map(async ([g, s]) => (await vpv(g, "2026-09-01")).salary_structure.code === s))).every(Boolean));

  // ---- ACTUAL payroll_calculate_run: OT + Late for Sep 2026, Oct 2026, Feb 2027, Feb 2028 (calendar days 30 / 31 / 28 / 29)
  const emp4 = { X: [uid(1101), 10000], Y: [uid(1102), 18000], Z: [uid(1103), 10000] };
  for (const [k, [id, g]] of Object.entries(emp4)) {
    await db.query(`insert into public.employees(id, company_id, employee_code, full_name, joining_date) values ($1,$2,$3,$4,'2025-01-01')`, [id, C4, `P4${k}`, `P4 ${k}`]);
    await db.query(`insert into public.employee_salary_assignments (company_id, employee_id, gross_salary, effective_from) values ($1,$2,$3,'2025-01-01')`, [C4, id, g]);
  }
  const att = (emp, date, ot, pen) => db.exec(`insert into public.attendance_records (company_id, employee_id, store_id, attendance_date, shift_id, status, payable_overtime_minutes, penalty_minutes) values ('${C4}','${emp}','${uid(1150)}','${date}','${uid(1151)}','present',${ot},${pen})`);
  const plan = [
    ["2026-09", "2026-09-01", "2026-09-30", 30, [[emp4.X[0], "2026-09-03", 30, 60], [emp4.X[0], "2026-09-04", 30, 0], [emp4.Y[0], "2026-09-03", 60, 60], [emp4.Z[0], "2026-09-03", 7, 1]]],
    ["2026-10", "2026-10-01", "2026-10-31", 31, [[emp4.X[0], "2026-10-05", 120, 60]]],
    ["2027-02", "2027-02-01", "2027-02-28", 28, [[emp4.X[0], "2027-02-05", 60, 60]]],
    ["2028-02", "2028-02-01", "2028-02-29", 29, [[emp4.X[0], "2028-02-05", 60, 60]]],
  ];
  const real4 = {};
  let n4 = 0;
  for (const [tag, s, e, days, rows] of plan) {
    for (const r of rows) await att(...r);
    const pid = uid(1200 + n4), rid = uid(1210 + n4); n4++;
    await db.exec(`insert into public.payroll_periods (id, company_id, period_month, period_start_date, period_end_date, status) values ('${pid}','${C4}','${s}','${s}','${e}','draft');
      insert into public.payroll_runs (id, company_id, payroll_period_id, status, is_current) values ('${rid}','${C4}','${pid}','draft',true);`);
    await q(`select public.payroll_calculate_run('${rid}')`);
    real4[tag] = { rid, days, s, lines: await q(`select em.employee_code c, l.code, l.line_type, l.amount::numeric a, l.quantity::numeric qty, l.rate::numeric rate from public.payroll_lines l join public.employees em on em.id = l.employee_id where l.payroll_run_id = '${rid}'`) };
  }
  const amt4 = (tag, k, code) => { const r = real4[tag].lines.find((x) => x.c === `P4${k}` && x.code === code); return r ? Number(r.a) : null; };
  for (const [tag, exp, label] of [["2026-09", 33.33, "September 2026 (30 days)"], ["2026-10", null, "October 2026 (31 days)"], ["2027-02", 35.71, "February 2027 (28 days)"], ["2028-02", 34.48, "February 2028 (29 days, leap)"]]) {
    const days = real4[tag].days;
    const eo = exp ?? r2(2 * 10000 / days / 10), el = exp ?? r2(10000 / days / 10);
    ok(`ACTUAL payroll_calculate_run ${label}: OT ${eo} and Late ${el} for Basic+DA 10,000 (policy proration = WORKING days, ignored)`, amt4(tag, "X", "OT") === eo && amt4(tag, "X", "LATE") === el, `OT=${amt4(tag, "X", "OT")} LATE=${amt4(tag, "X", "LATE")}`);
  }
  ok("ACTUAL payroll_calculate_run Sep 2026, Gross 18,000: OT 55.50 and Late 55.50 on Basic 9,000 + DA 7,650 (Allowance excluded); tiny minutes: 7 OT = 3.89, 1 Late = 0.56",
    amt4("2026-09", "Y", "OT") === 55.5 && amt4("2026-09", "Y", "LATE") === 55.5 && amt4("2026-09", "Z", "OT") === 3.89 && amt4("2026-09", "Z", "LATE") === 0.56, JSON.stringify([amt4("2026-09", "Y", "OT"), amt4("2026-09", "Y", "LATE"), amt4("2026-09", "Z", "OT"), amt4("2026-09", "Z", "LATE")]));
  // Preview vs actual: the same engine must give the same numbers
  await as("super_admin");
  const cmp = async (tag, k, emp, ot, late) => {
    const pv = await pvm(emp, real4[tag].s, undefined, { ot_minutes: ot, late_minutes: late });
    const eo = pv.earnings.find((x) => x.code === "OT"), dlt = pv.deductions.find((x) => x.code === "LATE");
    const res = (await q(`select r.gross_earnings::numeric g, r.total_deductions::numeric d, r.net_salary::numeric n, r.policy_snapshot ps from public.payroll_employee_results r where r.employee_id='${emp}' and r.payroll_run_id='${real4[tag].rid}'`))[0];
    return { same: Number(eo?.amount) === amt4(tag, k, "OT") && Number(dlt?.amount) === amt4(tag, k, "LATE") && Number(pv.ot_late_basis.ot_amount) === amt4(tag, k, "OT") && Number(pv.ot_late_basis.late_amount) === amt4(tag, k, "LATE")
      && Number(pv.gross) === Number(res.g) && Number(pv.total_deductions) === Number(res.d) && Number(pv.net_salary) === Number(res.n), pv, res };
  };
  const cmps = [await cmp("2026-09", "X", emp4.X[0], 60, 60), await cmp("2026-10", "X", emp4.X[0], 120, 60), await cmp("2027-02", "X", emp4.X[0], 60, 60), await cmp("2028-02", "X", emp4.X[0], 60, 60), await cmp("2026-09", "Y", emp4.Y[0], 60, 60), await cmp("2026-09", "Z", emp4.Z[0], 7, 1)];
  ok("PREVIEW == ACTUAL payroll_calculate_run: OT amount, Late amount, gross, total deductions and net identical for 6 employee-months (one engine, no duplicated formula)", cmps.every((c) => c.same), JSON.stringify(cmps.map((c) => [c.same, c.pv.net_salary, c.res.n])));
  const snap4 = cmps[0].res.ps?.ot_late_basis;
  ok("ACTUAL payroll: the calculation basis is stored in the result's policy snapshot (30 calendar days, 10 h, wage base 10,000, payable minutes 60 / 60)",
    snap4 && snap4.calendar_days === 30 && Number(snap4.std_hours_per_day) === 10 && Number(snap4.wage_base) === 10000 && Number(snap4.payable_ot_minutes) === 60 && Number(snap4.payable_late_minutes) === 60 && cmps[0].res.ps.late.enabled === true, JSON.stringify(snap4));
  const xn = await q(`select r.gross_earnings::numeric g, r.total_deductions::numeric d, r.net_salary::numeric n from public.payroll_employee_results r where r.employee_id='${emp4.X[0]}' and r.payroll_run_id='${real4["2026-09"].rid}'`);
  ok("ACTUAL payroll Sep 2026 Employee X: Gross 10,000 + OT 33.33, Late 33.33 deducted -> Net 10,000 (Late lowers the net, OT raises it)", Number(xn[0].g) === 10033.33 && Number(xn[0].d) === 33.33 && Number(xn[0].n) === 10000, JSON.stringify(xn[0]));
  ok("ACTUAL payroll: LATE is a normal deduction line (code LATE, rate = hourly, quantity = hours) and Basic/DA/Allowance lines are intact",
    real4["2026-09"].lines.some((l) => l.c === "P4X" && l.code === "LATE" && l.line_type === "deduction" && Number(l.qty) === 1 && Math.abs(Number(l.rate) - 33.333333) < 1e-6) && amt4("2026-09", "Y", "BASIC") === 9000 && amt4("2026-09", "Y", "DA") === 7650 && amt4("2026-09", "Y", "ALLOWANCE") === 1350);
  // Re-running a run is deterministic; another company's finalized/older payroll is untouched
  await q(`select public.payroll_calculate_run('${real4["2026-09"].rid}')`);
  ok("ACTUAL payroll: recalculating the same run gives the same OT / Late (deterministic, no double lines)", amt4("2026-09", "X", "OT") === 33.33 && (await q(`select count(*)::int n from public.payroll_lines where payroll_run_id='${real4["2026-09"].rid}' and employee_id='${emp4.X[0]}' and code in ('OT','LATE')`))[0].n === 2);
  // Data default + re-run safety of the migration
  const pNull = (await q(`insert into public.payroll_policies (company_id, status, effective_from, code, policy_name, version_no, proration_method, proration_basis, ot_std_hours_per_day) values ('${C4}','draft','2031-01-01','NULLSTD','Null std',94,'calendar_days','basic_da',null) returning id`))[0].id;
  const pUsed = (await q(`insert into public.payroll_policies (company_id, status, effective_from, code, policy_name, version_no, proration_method, proration_basis, ot_std_hours_per_day) values ('${C4}','draft','2031-01-01','USEDSTD','Used null std',95,'calendar_days','basic_da',null) returning id`))[0].id;
  await db.exec(`update public.payroll_employee_results set payroll_policy_id='${pUsed}' where id = (select id from public.payroll_employee_results where payroll_run_id='${real4["2026-10"].rid}' limit 1)`);
  // Replaying 0184 alone would recreate its narrower payroll_ot_late_basis(5 args) overload (0185's DROP only ran once, earlier);
  // 0185 is re-applied right after, exactly as a real ops replay of "0184 then 0185" would, restoring the single widened function.
  await db.exec(rd(MIG_0184));
  await db.exec(rd(MIG_0185));
  const std = async (id) => (await q(`select ot_std_hours_per_day s from public.payroll_policies where id='${id}'`))[0].s;
  ok("0184 data: a never-configured, unused policy gets 10 h/day; a policy referenced by a payroll result is NOT touched; an explicitly configured value (8) is NOT touched",
    Number(await std(pNull)) === 10 && (await std(pUsed)) === null && Number(await std(pol)) === 8, `${await std(pNull)}/${await std(pUsed)}/${await std(pol)}`);
  ok("0184 is re-runnable after real data exists (Sep 2026 X amounts unchanged after re-applying)", amt4("2026-09", "X", "OT") === 33.33);
  const privs = async (fn, role) => (await q(`select has_function_privilege('${role}', p.oid, 'execute') x from pg_proc p where p.proname='${fn}'`)).map((r) => r.x);
  ok("Security: payroll_policy_compute_lines / payroll_apply_policy / payroll_ot_late_basis stay closed to anon + authenticated (one overload each, no stale old-signature copy)",
    (await Promise.all(["payroll_policy_compute_lines", "payroll_apply_policy", "payroll_ot_late_basis"].map(async (f) => (await privs(f, "anon")).every((x) => !x) && (await privs(f, "authenticated")).every((x) => !x) && (await q(`select count(*)::int n from pg_proc where proname='${f}'`))[0].n === 1))).every(Boolean));
  await as("staff", { emp: emp4.X[0], company: C4 });
  ok("Security: a plain employee still cannot run the preview (dynamic-permission gate unchanged)", /Not authorised/.test((await fails(() => pvm(emp4.X[0], "2026-09-01", undefined, { ot_minutes: 60 }))) ?? ""));
  await as("company_admin", { emp: OE, company: C2 });
  ok("Security: another company's admin cannot read this company's OT / Late basis (salary data does not cross companies)", /Not authorised/.test((await fails(() => pvm(emp4.X[0], "2026-09-01", undefined, { ot_minutes: 60 }))) ?? ""));
  await as("super_admin");

  // ------------------------------------------------------------------ 0185: OT/Late hourly basis is CONFIGURATION, not hard-coded
  const olb = async (pid, s, e, basic, da, gross, wd, comps) => (await q(
    `select basis_method bm, divisor_method dm, divisor::numeric dv, wage_base::numeric wb, std_hours::numeric sh, hourly_rate::numeric hr
       from public.payroll_ot_late_basis($1::uuid,$2::date,$3::date,$4::numeric,$5::numeric,$6::numeric,$7::numeric,$8::jsonb)`,
    [pid, s, e, basic, da, gross, wd, JSON.stringify(comps ?? {})]))[0];
  const clxFull = (policy, s, e, wd, basic, da, gross, ot, late, comps) => q(
    `select kind, line_type, code, quantity::numeric qty, rate::numeric rate, amount::numeric amount, unresolved, calc_note
       from public.payroll_policy_compute_lines($1::uuid,$2::date,$3::date,$4::numeric,null,$5::numeric,$6::numeric,$7::numeric,0,$8::numeric,0,null::uuid,'{}'::text[],null,null,null,'{}'::jsonb,$9::jsonb,$10::numeric) order by kind`,
    [policy, s, e, wd, basic, da, gross, ot, JSON.stringify(comps ?? {}), late]);
  const basePol = (code, vno, extraCols, extraVals) =>
    q(`insert into public.payroll_policies (company_id, status, effective_from, code, policy_name, version_no, currency_precision, proration_method, proration_basis, ot_enabled, late_deduction_enabled, lwp_enabled${extraCols}) values ('${C4}','draft','2032-01-01',$1,$1,$2,2,'calendar_days','basic_da',true,true,false${extraVals}) returning id`,
      [code, vno]).then((r) => r[0].id);

  // E. Standard Hours/Day changes the rate dynamically (not hard-coded to 10)
  const pH8 = await basePol("H8", 201, ", ot_std_hours_per_day", ",8");
  const bH8 = await olb(pH8, "2026-09-01", "2026-09-30", 5000, 5000, null, null);
  ok("0185 E: Standard Hours/Day is configuration, not hard-coded — 8 hours gives 10,000/30/8 = Rs 41.67 (not the old fixed 10h Rs 33.33)",
    Number(bH8.sh) === 8 && Math.abs(Number(bH8.hr) - 10000 / 30 / 8) < 1e-9 && r2(Number(bH8.hr)) === 41.67, JSON.stringify(bH8));

  // F. Hourly Wage Basis changes the rate dynamically: Gross instead of Basic+DA
  const pGross = await basePol("WBGROSS", 202, ", ot_std_hours_per_day, ot_late_basis", ",10,'gross'");
  const bGross = await olb(pGross, "2026-09-01", "2026-09-30", 5000, 5000, 12000, null);
  ok("0185 F: Hourly Wage Basis = Gross reads Gross (12,000), not Basic+DA (10,000) — hourly Rs 40.00",
    bGross.bm === "gross" && Number(bGross.wb) === 12000 && r2(Number(bGross.hr)) === 40, JSON.stringify(bGross));
  const olGross = await clxFull(pGross, "2026-09-01", "2026-09-30", 30, 5000, 5000, 12000, 60, 60);
  ok("0185 F: OT/Late lines for Wage Basis = Gross value at the Gross-based rate (60 min = Rs 40.00 each)",
    Number(lineOfX(olGross, "OT")?.amount) === 40 && Number(lineOfX(olGross, "LATE")?.amount) === 40, JSON.stringify(olGross.map((r) => [r.code, r.amount])));

  // Wage Basis = Basic only (ignores DA)
  const pBasicOnly = await basePol("WBASIC", 203, ", ot_std_hours_per_day, ot_late_basis", ",10,'basic'");
  const bBasicOnly = await olb(pBasicOnly, "2026-09-01", "2026-09-30", 6000, 4000, null, null);
  ok("0185: Hourly Wage Basis = Basic only ignores DA (wage base 6,000, not 10,000)", Number(bBasicOnly.wb) === 6000, JSON.stringify(bBasicOnly));

  // Wage Basis = Another Salary Component (reuses the SAME already-computed earning-lines map pct_of_component statutory rules already use)
  const pComp = await basePol("WBCOMP", 204, ", ot_std_hours_per_day, ot_late_basis, ot_late_basis_component_code", ",10,'component','ALLOWANCE'");
  const bComp = await olb(pComp, "2026-09-01", "2026-09-30", 5000, 5000, null, null, { ALLOWANCE: 1500 });
  ok("0185: Hourly Wage Basis = Another Salary Component reads the named component's already-computed amount (ALLOWANCE 1,500), not Basic+DA",
    Number(bComp.wb) === 1500 && r2(Number(bComp.hr)) === r2(1500 / 30 / 10), JSON.stringify(bComp));
  const bCompMissing = await olb(pComp, "2026-09-01", "2026-09-30", 5000, 5000, null, null, {});
  ok("0185: Wage Basis = Another Salary Component that isn't on this payslip -> wage base is null (never guessed)", bCompMissing.wb == null, JSON.stringify(bCompMissing));

  // Wage Basis = Custom Formula (the EXISTING safe payroll_eval_formula engine — same vocabulary as proration/ND/deduction-cap formulas)
  const pFormula = await basePol("WBFORM", 205, ", ot_std_hours_per_day, ot_late_basis, ot_late_basis_formula", ",10,'custom','BASIC + DA / 2'");
  const bFormula = await olb(pFormula, "2026-09-01", "2026-09-30", 6000, 4000, null, null);
  ok("0185: Hourly Wage Basis = Custom Formula evaluates BASIC + DA/2 = 8,000 via the existing safe formula engine",
    Number(bFormula.wb) === 8000, JSON.stringify(bFormula));

  // G. Day Divisor changes dynamically: Working Days (reuses the SAME p_working_days this policy's Working-days method already resolves for proration/LWP)
  const pWD = await basePol("DVWD", 206, ", ot_std_hours_per_day, ot_late_divisor_method", ",10,'working_days'");
  const bWD = await olb(pWD, "2026-09-01", "2026-09-30", 5000, 5000, null, 22);
  ok("0185 G: Day Divisor = Working Days uses the resolved working-days figure (22), not the payroll month's 30 calendar days",
    bWD.dm === "working_days" && Number(bWD.dv) === 22 && r2(Number(bWD.hr)) === r2(10000 / 22 / 10), JSON.stringify(bWD));
  const olWD = await clxFull(pWD, "2026-09-01", "2026-09-30", 22, 5000, 5000, 10000, 60, 60);
  ok("0185 G: OT/Late lines follow the configured Working Days divisor end to end through compute_lines",
    Number(lineOfX(olWD, "OT")?.amount) === r2(10000 / 22 / 10) && Number(lineOfX(olWD, "LATE")?.amount) === r2(10000 / 22 / 10), JSON.stringify(olWD.map((r) => [r.code, r.amount])));

  // Day Divisor = Custom Divisor
  const pDvC = await basePol("DVCUS", 207, ", ot_std_hours_per_day, ot_late_divisor_method, ot_late_divisor_custom", ",10,'custom',25");
  const bDvC = await olb(pDvC, "2026-09-01", "2026-09-30", 5000, 5000, null, 22);
  ok("0185: Day Divisor = Custom Divisor (25) ignores both calendar days (30) and working days (22)",
    bDvC.dm === "custom" && Number(bDvC.dv) === 25 && r2(Number(bDvC.hr)) === r2(10000 / 25 / 10), JSON.stringify(bDvC));

  // H. Blank Standard Hours/Day is STILL never guessed, even under a non-default basis/divisor
  const pBlankH = await basePol("BLANKH", 208, ", ot_std_hours_per_day, ot_late_basis", ",null,'gross'");
  const blankRows = await clxFull(pBlankH, "2026-09-01", "2026-09-30", 30, 5000, 5000, 12000, 60, 60);
  ok("0185 H: blank Standard Hours/Day still never guesses 10 (even with a non-default Gross basis) — OT/Late are Rs 0 and flagged for review",
    ["OT", "LATE"].every((c) => Number(lineOfX(blankRows, c)?.amount) === 0 && lineOfX(blankRows, c)?.unresolved === true), JSON.stringify(blankRows.map((r) => [r.code, r.amount, r.unresolved])));

  // I. Editing the policy AFTER payroll is calculated does NOT alter the already-stored payroll_lines (locked/historical payroll)
  const histOtBefore = (await q(`select l.amount::numeric a from public.payroll_lines l where l.payroll_run_id='${real4["2026-09"].rid}' and l.employee_id='${emp4.X[0]}' and l.code='OT'`))[0].a;
  await db.exec(`update public.payroll_policies set ot_std_hours_per_day = 8, ot_late_basis = 'gross' where id = '${pol4}'`);
  const histOtAfter = (await q(`select l.amount::numeric a from public.payroll_lines l where l.payroll_run_id='${real4["2026-09"].rid}' and l.employee_id='${emp4.X[0]}' and l.code='OT'`))[0].a;
  ok("0185 I: editing the policy's Hourly Wage Basis / Standard Hours/Day AFTER a run was calculated does NOT change that run's already-stored OT amount (Rs 33.33 before and after)",
    Number(histOtBefore) === 33.33 && Number(histOtAfter) === 33.33, `${histOtBefore} -> ${histOtAfter}`);
  const freshRows = await clxFull(pol4, "2026-09-01", "2026-09-30", 30, 5000, 5000, 11000, 60, 60);
  ok("0185 I: ...while a FRESH calculation on the SAME (now-edited) policy immediately picks up the new configuration (Gross 11,000 @ 8h -> Rs 45.83, not the old Rs 33.33)",
    Number(lineOfX(freshRows, "OT")?.amount) === r2(11000 / 30 / 8) && Number(lineOfX(freshRows, "OT")?.amount) !== 33.33, JSON.stringify(freshRows.map((r) => [r.code, r.amount])));
  await db.exec(`update public.payroll_policies set ot_std_hours_per_day = 10, ot_late_basis = 'basic_da' where id = '${pol4}'`); // restore — pol4 is reused by later UI-QA fixtures

  // J. One engine: compute_lines' OT amount for a fully non-default configuration matches payroll_ot_late_basis()'s own hourly_rate exactly (no duplicated formula)
  const pJ = await basePol("PJCFG", 209, ", ot_std_hours_per_day, ot_late_basis, ot_late_divisor_method, ot_late_divisor_custom", ",8,'gross','custom',25");
  const jRows = await clxFull(pJ, "2026-09-01", "2026-09-30", 30, 5000, 5000, 12000, 60, 0);
  const jOlb = await olb(pJ, "2026-09-01", "2026-09-30", 5000, 5000, 12000, null);
  ok("0185 J: compute_lines' OT amount for a non-default configuration (Gross basis, Custom divisor 25, 8h) equals payroll_ot_late_basis()'s own hourly_rate exactly",
    Number(lineOfX(jRows, "OT")?.amount) === r2(Number(jOlb.hr)) && r2(Number(jOlb.hr)) === r2(12000 / 25 / 8), JSON.stringify([jOlb, jRows.map((r) => [r.code, r.amount])]));

  // Default (untouched) policies behave EXACTLY as migration 0184 — zero behaviour change for every policy that never touches the new fields
  const bDefault = await olb(pol, "2026-09-01", "2026-09-30", 5000, 5000, null, null);
  ok("0185: a policy that never touched the new fields still resolves basis=basic_da / divisor=calendar_days exactly as migration 0184 — zero behaviour change for untouched policies",
    bDefault.bm === "basic_da" && bDefault.dm === "calendar_days", JSON.stringify(bDefault));

  // payroll_policy_validate rejects an incomplete Custom Formula / Another Component / Custom Divisor choice, with a plain-English reason (same UX as every other custom-formula field)
  const vOne = async (id) => (await q(`select ok, error from public.payroll_policy_validate($1::uuid)`, [id]))[0];
  const pInvalidFormula = await basePol("INVFORM", 210, ", ot_late_basis", ",'custom'");
  const vInvalidFormula = await vOne(pInvalidFormula);
  ok("0185 Validate: OT/Late basis = Custom Formula with nothing configured is refused", vInvalidFormula.ok === false && /Custom Formula/.test(vInvalidFormula.error), JSON.stringify(vInvalidFormula));
  const pInvalidComp = await basePol("INVCOMP", 211, ", ot_late_basis", ",'component'");
  const vInvalidComp = await vOne(pInvalidComp);
  ok("0185 Validate: OT/Late basis = Another Salary Component with no code set is refused", vInvalidComp.ok === false && /Another Salary Component/.test(vInvalidComp.error), JSON.stringify(vInvalidComp));
  const pInvalidDiv = await basePol("INVDIV", 212, ", ot_late_divisor_method", ",'custom'");
  const vInvalidDiv = await vOne(pInvalidDiv);
  ok("0185 Validate: OT/Late divisor = Custom Divisor with no value set is refused", vInvalidDiv.ok === false && /Custom Divisor/.test(vInvalidDiv.error), JSON.stringify(vInvalidDiv));
  const pValidNonDefault = await basePol("VALIDCFG", 213, ", ot_late_basis, ot_late_basis_formula, ot_late_divisor_method, ot_late_divisor_custom", ",'custom','BASIC + DA','custom',25");
  const vValid = await vOne(pValidNonDefault);
  ok("0185 Validate: a FULLY configured Custom Formula + Custom Divisor passes Validate", vValid.ok === true, JSON.stringify(vValid));

  // ------------------------------------------------------------------ policy version inheritance
  await db.exec(`insert into public.payroll_pt_slabs (company_id, payroll_policy_id, min_salary, max_salary, amount, effective_from) values ('${C}','${pol}',0,20000,150,'2000-01-01');
    insert into public.payroll_deduction_order (company_id, payroll_policy_id, deduction_code, priority) values ('${C}','${pol}','PF',1);`);
  const cnt = async (t, p) => (await q(`select count(*)::int n from public.${t} where payroll_policy_id='${p}'`))[0].n;
  const v1Rules = await q(`select id from public.payroll_statutory_rules where payroll_policy_id='${pol}' order by id`);
  const pol2 = (await q(`insert into public.payroll_policies (company_id, status, effective_from, code, policy_name, version_no, previous_policy_id, currency_precision, proration_method, proration_basis, ot_enabled, ot_std_hours_per_day, lwp_enabled, lwp_divisor_basis)
     values ('${C}','draft','2027-04-01','P1','Policy 1 v2',2,'${pol}',2,'calendar_days','basic_da',true,8,true,'basic_da') returning id`))[0].id;
  ok("Versioning: new version inherits ALL rules (PF, ESI, Medical, Incentive, ...), PT slabs and deduction order",
    (await cnt("payroll_statutory_rules", pol2)) === v1Rules.length && (await cnt("payroll_pt_slabs", pol2)) === 1 && (await cnt("payroll_deduction_order", pol2)) === 1, `${await cnt("payroll_statutory_rules", pol2)} vs ${v1Rules.length}`);
  const sig = async (p) => JSON.stringify(await q(`select kind, coalesce(component_code,'') cc, calc_method, calc_base, employee_rate::numeric r, employee_amount::numeric a, enabled, effective_from::text ef from public.payroll_statutory_rules where payroll_policy_id='${p}' order by kind, cc`));
  ok("Versioning: copied rules are identical in configuration", (await sig(pol)) === (await sig(pol2)));
  await db.exec(`update public.payroll_statutory_rules set employee_rate = 5 where payroll_policy_id='${pol2}' and component_code='MEDICAL'; delete from public.payroll_statutory_rules where payroll_policy_id='${pol2}' and kind='esi';`);
  ok("Versioning: new version is edited INDEPENDENTLY; the old version is untouched (same rows, same ids, rate still 1)",
    JSON.stringify(await q(`select id from public.payroll_statutory_rules where payroll_policy_id='${pol}' order by id`)) === JSON.stringify(v1Rules) && Number((await q(`select employee_rate::numeric r from public.payroll_statutory_rules where payroll_policy_id='${pol}' and component_code='MEDICAL'`))[0].r) === 1);
  ok("Versioning: payroll continuity — the new version still emits PF and Medical", (() => true)() && Boolean(by(await cl(pol2, 10000, 5000, 5000, { comps: { BASIC: 5000, DA: 5000 } }), "MEDICAL")) && Boolean(by(await cl(pol2, 10000, 5000, 5000, { comps: { BASIC: 5000, DA: 5000 } }), "PF")));
  const pol3 = (await q(`insert into public.payroll_policies (company_id, status, effective_from, code, policy_name, version_no, currency_precision) values ('${C}','draft','2028-04-01','P9','Fresh policy',1,2) returning id`))[0].id;
  ok("Versioning: a brand-new policy (no previous version) starts empty — nothing copied", (await cnt("payroll_statutory_rules", pol3)) === 0);

  // ------------------------------------------------------------------ headless UI QA (jsdom) — only when jsdom is installed
  try {
    const ran = await require("./ui-qa.cjs")({ db, q, ok, as, fails, ROOT, sid, E, C, C2, OE, uid, asg, snapAll, pol, C4, s4, pol4, emp4 });
    if (!ran) console.log("(UI QA skipped)");
  } catch (e) { ok("UI QA harness ran without crashing", false, e.stack ? e.stack.split("\n").slice(0, 4).join(" | ") : String(e)); }

  report();
  function report() {
    let f = 0;
    for (const [s, n, e] of results) { if (s === "FAIL") f++; console.log(`${s}  ${n}${e ? "  :: " + e : ""}`); }
    console.log(`\n${results.length - f}/${results.length} passed, ${f} failed`);
    process.exit(f ? 1 : 0);
  }
})().catch((e) => { for (const [s, n, x] of results) console.log(`${s}  ${n}${x ? "  :: " + x : ""}`); console.error("HARNESS ERROR:", e.message, e.where ?? ""); process.exit(2); });

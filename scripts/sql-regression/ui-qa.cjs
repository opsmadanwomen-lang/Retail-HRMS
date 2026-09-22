// Headless UI QA (jsdom) — NOT a real-browser test. It mounts the app's REAL React components and hooks in a headless DOM and drives them
// like a user (typing, clicking), while every rpc()/table call executes against the same PGlite database that runs the real migrations
// and the live function bodies. Called from run.cjs when jsdom is installed (PGLITE_DIR/node_modules/jsdom or `npm i --no-save jsdom`).
const fs = require("fs");
const os = require("os");
const path = require("path");

module.exports = async function runUiQa(env) {
  const { db, q, ok, as, fails, ROOT, sid, E, C, C2, OE, uid, asg, snapAll, pol, C4, s4, pol4, emp4 } = env;

  // ---------------------------------------------------------------- jsdom + globals (must exist BEFORE React is loaded)
  let JSDOM;
  try { ({ JSDOM } = require(path.join(process.env.PGLITE_DIR || ROOT, "node_modules", "jsdom"))); } catch { try { ({ JSDOM } = require("jsdom")); } catch { console.log("UI QA skipped: jsdom is not installed."); return false; } }
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
  const w = dom.window;
  globalThis.window = w; globalThis.document = w.document;
  for (const k of Object.getOwnPropertyNames(w)) { if (!(k in globalThis)) { try { globalThis[k] = w[k]; } catch { /* read-only */ } } }
  try { Object.defineProperty(globalThis, "navigator", { value: w.navigator, configurable: true }); } catch { /* keep node's */ }
  // Node ships its own Event / CustomEvent; libraries (Radix) must create jsdom events for jsdom's dispatchEvent.
  for (const k of ["Event", "CustomEvent"]) globalThis[k] = w[k];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  w.ResizeObserver = globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.IntersectionObserver = globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.matchMedia = globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  for (const fn of ["scrollIntoView", "hasPointerCapture", "releasePointerCapture", "setPointerCapture"]) w.Element.prototype[fn] = function () { return false; };

  // ---------------------------------------------------------------- Supabase stand-in backed by the real database
  const ctx = { calls: [], dyn: "", errors: [] };
  const norm = (v) => (v instanceof Date ? (v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0 && v.getUTCMilliseconds() === 0 ? v.toISOString().slice(0, 10) : v.toISOString()) : v);
  const normRows = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, norm(v)])));
  const custom = {
    my_dynamic_permission: async () => ctx.dyn !== "deny",
    payroll_policy_list: async ({ p_company_id }) => normRows((await db.query(`select * from public.payroll_policies where company_id = $1 order by version_no desc`, [p_company_id])).rows),
    salary_list_structures: async ({ p_company_id }) => normRows((await db.query(`select * from public.salary_structures where company_id = $1 order by code, effective_from desc`, [p_company_id])).rows),
    salary_list_structure_components: async ({ p_structure_id }) => normRows((await db.query(`select * from public.salary_structure_components where salary_structure_id = $1 order by display_order, code`, [p_structure_id])).rows),
  };
  const supabase = {
    async rpc(name, args = {}) {
      ctx.calls.push({ kind: "rpc", name });
      try {
        if (custom[name]) return { data: await custom[name](args), error: null };
        const meta = (await db.query(`select p.proretset rs, t.typtype tt from pg_proc p join pg_type t on t.oid = p.prorettype where p.proname = $1 and p.pronamespace = 'public'::regnamespace`, [name])).rows[0];
        if (!meta) return { data: null, error: { message: `function ${name} does not exist` } };
        const keys = Object.keys(args);
        const params = keys.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
        const rows = normRows((await db.query(`select * from public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`, params)).rows);
        if (meta.rs) return { data: rows, error: null };
        if (meta.tt === "c") return { data: rows[0] ?? null, error: null };
        return { data: rows[0] ? Object.values(rows[0])[0] : null, error: null };
      } catch (e) { return { data: null, error: { message: e.message.split("\n")[0], code: e.code } }; }
    },
    from(table) {
      if (!/^[a-z_]+$/.test(table)) throw new Error("bad table");
      const st = { op: "select", wheres: [], order: null, single: false, payload: null };
      const b = {
        select() { return b; },
        eq(c, v) { st.wheres.push([c, "=", v]); return b; },
        not(c, op, v) { st.wheres.push([c, `not ${op}`, v]); return b; },
        order(c, o) { st.order = [c, !(o && o.ascending === false)]; return b; },
        limit() { return b; },
        neq(c, v) { st.wheres.push([c, "<>", v]); return b; },
        in(c, arr) { st.wheres.push([c, "in", arr]); return b; },
        gte(c, v) { st.wheres.push([c, ">=", v]); return b; },
        lte(c, v) { st.wheres.push([c, "<=", v]); return b; },
        or() { return b; },
        maybeSingle() { st.single = true; return b; },
        single() { st.single = true; return b; },
        insert(p) { st.op = "insert"; st.payload = p; return b; },
        update(p) { st.op = "update"; st.payload = p; return b; },
        delete() { st.op = "delete"; return b; },
        then(res, rej) { return exec().then(res, rej); },
      };
      async function exec() {
        ctx.calls.push({ kind: "from", table, op: st.op, t: Date.now() });
        try {
          const params = []; const ph = (v) => { params.push(v); return `$${params.length}`; };
          const where = st.wheres.length ? " where " + st.wheres.map(([c, op, v]) => (op === "not is" ? `${c} is not null` : op === "in" ? `${c} = any(${ph(v)})` : `${c} ${op} ${ph(v)}`)).join(" and ") : "";
          let sql;
          if (st.op === "select") sql = `select * from public.${table}${where}${st.order ? ` order by ${st.order[0]} ${st.order[1] ? "asc" : "desc"}` : ""}`;
          else if (st.op === "insert") { const ks = Object.keys(st.payload); sql = `insert into public.${table} (${ks.join(", ")}) values (${ks.map((k) => ph(st.payload[k])).join(", ")}) returning *`; }
          else if (st.op === "update") { const ks = Object.keys(st.payload); sql = `update public.${table} set ${ks.map((k) => `${k} = ${ph(st.payload[k])}`).join(", ")}${where} returning *`; }
          else sql = `delete from public.${table}${where} returning *`;
          const rows = normRows((await db.query(sql, params)).rows);
          if (st.op === "update") ctx.calls.push({ kind: "done", table, op: "update", t: Date.now(), sql: sql.slice(0, 70), keys: Object.keys(st.payload).join(",") });
          return { data: st.single ? rows[0] ?? null : rows, error: null };
        } catch (e) { ctx.errors.push(`${st.op} ${table}: ${e.message.split("\n")[0]}`); return { data: null, error: { message: e.message.split("\n")[0], code: e.code } }; }
      }
      return b;
    },
  };
  globalThis.__SB = supabase;
  globalThis.__AUTH = { user: { id: uid(900), role: "super_admin", companyId: C } };

  // ---------------------------------------------------------------- bundle the real app modules
  const esbuild = require(path.join(ROOT, "node_modules", "esbuild"));
  const virt = {
    name: "virt",
    setup(b) {
      b.onResolve({ filter: /^@\/lib\/supabaseClient$/ }, () => ({ path: "supabase", namespace: "virt" }));
      b.onResolve({ filter: /^@\/hooks\/useAuth$/ }, () => ({ path: "auth", namespace: "virt" }));
      b.onLoad({ filter: /.*/, namespace: "virt" }, (a) => ({ loader: "js", contents: a.path === "supabase" ? "export const supabase = globalThis.__SB;" : "export function useAuth() { return globalThis.__AUTH; }" }));
    },
  };
  const out = path.join(os.tmpdir(), `ui_qa_bundle_${process.pid}.cjs`);
  await esbuild.build({
    entryPoints: [path.join(__dirname, "ui", "entry.mjs")], bundle: true, platform: "node", format: "cjs", outfile: out, jsx: "automatic", logLevel: "silent",
    alias: { "@": path.join(ROOT, "src") }, plugins: [virt], define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" }, nodePaths: [path.join(ROOT, "node_modules")],
  });
  const ui = require(out);
  const { h } = ui;

  // ---------------------------------------------------------------- helpers
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const waitFor = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { let v = null; try { v = fn(); } catch { /* not yet */ } if (v) return v; if (Date.now() - t0 > ms) return null; await ui.flush(120); } };
  const btn = (root, label) => [...root.querySelectorAll("button")].find((b) => txt(b) === label || txt(b).startsWith(label));
  const fieldValue = (root, labelStart) => { const l = [...root.querySelectorAll("label")].find((x) => txt(x).startsWith(labelStart)); return txt(l?.parentElement?.querySelector("[aria-readonly]")); };
  const cleanup = () => { for (const el of [...document.body.children]) el.remove(); };
  ctx.pm = "1";

  // ---------------------------------------------------------------- data for the scenarios
  await as("super_admin");
  const UI1 = uid(90), UI2 = uid(91);
  await db.exec(`insert into public.employees(id, company_id, employee_code, full_name, joining_date) values ('${UI1}','${C}','UIQA1','UI With Salary','2025-10-01'),('${UI2}','${C}','UIQA2','UI Without Salary','2025-10-01');`);
  await asg(UI1, 11000, "2031-01-01", "Initial salary");
  const snapDb = async () => snapAll();

  // ================================================================ A. EMPLOYEE ADD — Payroll Salary section
  let intent = null;
  let m = ui.mount(h(ui.SalaryHarness, { companyId: C, joiningDate: undefined, onIntent: (i) => { intent = i; } }));
  const gross = await waitFor(() => m.container.querySelector("#ps-gross"));
  ok("UI-A Add Employee: the Payroll Salary section renders for an authorised payroll user with Gross + Effective From inputs", Boolean(gross) && Boolean(m.container.querySelector("#ps-eff")) && /Payroll Salary/.test(txt(m.container)), `rendered: "${txt(m.container).slice(0, 260)}" | calls: ${JSON.stringify(ctx.calls.slice(0, 8))}`);
  if (!gross) return true;   // the failing assertion above already reports what rendered
  ok("UI-A Add Employee: NO Grade dropdown / select exists in the salary section (Grade is automatic)", m.container.querySelectorAll('select, [role="combobox"]').length === 0 && !/Select grade/i.test(txt(m.container)));
  ok("UI-A Add Employee: Grade / Structure / Slab are read-only display cells (no <input>)", ["ps-grade", "ps-structure", "ps-slab"].every((id) => { const el = m.container.querySelector(`#${id}`); return el && el.tagName === "DIV" && el.getAttribute("aria-readonly") === "true" && !el.querySelector("input"); }));
  ok("UI-A Add Employee: blank Gross -> 'Salary not configured yet', nothing to save, nothing blocking", /Salary not configured yet/.test(txt(m.container)) && intent.save === false && intent.blocking === null);
  const setGross = async (v, code) => { ui.setValue(m.container.querySelector("#ps-gross"), String(v)); return waitFor(() => new RegExp(`^${code} - `).test(txt(m.container.querySelector("#ps-structure")))); };
  const rowsExpected = [[11000, "M1", "Unskilled"], [12499.99, "M1", "Unskilled"], [12500, "M2", "Semi Skilled"], [13000, "M2", "Semi Skilled"], [20000, "M2", "Semi Skilled"], [20000.01, "M3", "Skilled"], [25000, "M3", "Skilled"]];
  for (const [g, code, name] of rowsExpected) {
    const hit = await setGross(g, code);
    const grade = txt(m.container.querySelector("#ps-grade")), st = txt(m.container.querySelector("#ps-structure"));
    ok(`UI-A Add Employee: Gross ${g} -> Auto Grade '${code} - ${name}', Structure '${code} - ${name}' (read-only)`, Boolean(hit) && grade === `${code} - ${name}` && st === `${code} - ${name}` && intent.save === true && intent.blocking === null, `${grade} | ${st} | ${JSON.stringify(intent)}`);
  }
  await setGross(11000, "M1");
  const s11 = txt(m.container.querySelector("#ps-slab")), body11 = txt(m.container);
  ok("UI-A Gross 11,000: Slab '₹0 – ₹12,499.99' and bifurcation BASIC ₹5,500 / DA ₹5,500 / ALLOWANCE ₹0 with Gross ₹11,000 (server's salary_bifurcate)",
    s11 === "₹0 – ₹12,499.99" && /BASIC\s*₹5,500\s*DA\s*₹5,500\s*ALLOWANCE\s*₹0/.test(body11) && /Gross\s*₹11,000/.test(body11), `${s11} :: ${body11.slice(body11.indexOf("Salary Bifurcation"), body11.indexOf("Salary Bifurcation") + 120)}`);
  await setGross(20000.01, "M3");
  ok("UI-A Gross 20,000.01: Slab '₹20,000.01 – ∞'", txt(m.container.querySelector("#ps-slab")) === "₹20,000.01 – ∞");
  // outside every active slab -> clear error, Save blocked
  await db.exec(`delete from public.salary_slab_rules where salary_structure_id='${sid.M3}';`);
  m.unmount(); intent = null;
  m = ui.mount(h(ui.SalaryHarness, { companyId: C, onIntent: (i) => { intent = i; } }));
  await waitFor(() => m.container.querySelector("#ps-gross"));
  ui.setValue(m.container.querySelector("#ps-gross"), "30000");
  const alertEl = await waitFor(() => [...m.container.querySelectorAll('[role="alert"]')].find((e) => /No active salary structure is configured/.test(txt(e))));
  ok("UI-A Gross outside all active slabs: clear error 'No active salary structure is configured for this Gross Salary.', Grade/Structure/Slab empty, Save blocked",
    Boolean(alertEl) && intent.save === false && intent.blocking === "No active salary structure is configured for this Gross Salary." && txt(m.container.querySelector("#ps-structure")) === "—");
  await db.exec(`insert into public.salary_slab_rules (company_id, salary_structure_id, min_gross, max_gross) values ('${C}','${sid.M3}',20000.01,null);`);
  m.unmount();

  // ================================================================ B. EMPLOYEE EDIT — current salary, Update Salary, revisions
  const asgCount = async (id) => (await q(`select count(*)::int n from public.employee_salary_assignments where employee_id='${id}'`))[0].n;
  intent = null;
  m = ui.mount(h(ui.SalaryHarness, { employeeId: UI1, companyId: C, onIntent: (i) => { intent = i; } }));
  await waitFor(() => /Current Gross Salary/.test(txt(m.container)));
  const cur = txt(m.container.querySelector('[aria-label="Current salary"]'));
  ok("UI-B Edit Employee: current salary shown (Gross ₹11,000, M1 - Unskilled, Effective From 2031-01-01) and an 'Update Salary' button", /₹11,000/.test(cur) && /M1 - Unskilled/.test(cur) && /2031-01-01/.test(cur) && Boolean(btn(m.container, "Update Salary")));
  ok("UI-B Edit Employee: nothing editable until 'Update Salary' is pressed", !m.container.querySelector("#ps-gross") && intent.save === false);
  ui.click(btn(m.container, "Update Salary"));
  await waitFor(() => m.container.querySelector("#ps-gross"));
  ok("UI-B Edit Employee: Update Salary opens Gross prefilled with the current value; unchanged Gross creates NO revision", m.container.querySelector("#ps-gross").value === "11000" && (await waitFor(() => intent && intent.save === false && intent.blocking === null)) !== null);
  ui.setValue(m.container.querySelector("#ps-eff"), "2031-06-01");
  ui.setValue(m.container.querySelector("#ps-gross"), "13000");
  const chg = await waitFor(() => /Previous: M1 - Unskilled → New: M2 - Semi Skilled/.test(txt(m.container)));
  ok("UI-B Edit Employee: Gross 11,000 -> 13,000 immediately previews 'Previous: M1 - Unskilled → New: M2 - Semi Skilled'; a revision can be saved", Boolean(chg) && intent.save === true && intent.gross === 13000);
  ui.setValue(m.container.querySelector("#ps-reason"), "Annual revision");
  await ui.flush(150);
  // the form saves through the EXISTING revision function with exactly this intent
  const beforeRows = await asgCount(UI1);
  const saved13 = await ui.payrollService.assignEmployeeSalary({ employeeId: UI1, grossSalary: intent.gross, effectiveFrom: intent.effectiveFrom, salaryStructureId: null, reason: intent.reason }).then(() => null, (e) => e.message);
  ok("UI-B Edit Employee: saving 13,000 creates ONE new revision through salary_assign_employee (no duplicate)", saved13 === null && (await asgCount(UI1)) === beforeRows + 1);
  m.unmount();
  m = ui.mount(h(ui.SalaryHarness, { employeeId: UI1, companyId: C, onIntent: (i) => { intent = i; } }));
  await waitFor(() => /Current Gross Salary/.test(txt(m.container)));
  ui.click(btn(m.container, "Update Salary")); await waitFor(() => m.container.querySelector("#ps-gross"));
  ui.setValue(m.container.querySelector("#ps-eff"), "2032-01-01"); ui.setValue(m.container.querySelector("#ps-gross"), "25000");
  await waitFor(() => /New: M3 - Skilled/.test(txt(m.container)));
  ok("UI-B Edit Employee: 13,000 -> 25,000 previews 'Previous: M2 - Semi Skilled → New: M3 - Skilled'", /Previous: M2 - Semi Skilled → New: M3 - Skilled/.test(txt(m.container)) && intent.save === true);
  await ui.payrollService.assignEmployeeSalary({ employeeId: UI1, grossSalary: intent.gross, effectiveFrom: intent.effectiveFrom, salaryStructureId: null, reason: "Promotion" });
  m.unmount();
  m = ui.mount(h(ui.SalaryHarness, { employeeId: UI1, companyId: C, onIntent: (i) => { intent = i; } }));
  await waitFor(() => /Salary history \(3\)/.test(txt(m.container)));
  const hist = txt(m.container.querySelector("details"));
  ok("UI-B Salary history (3 rows) keeps Effective From, Gross, Previous Gross, Grade/Structure, Previous structure, Reason and Saved by: M1 -> M2 -> M3",
    /2031-01-01/.test(hist) && /2031-06-01/.test(hist) && /2032-01-01/.test(hist) && /₹11,000/.test(hist) && /₹13,000/.test(hist) && /₹25,000/.test(hist) && /M1 - Unskilled/.test(hist) && /M2 - Semi Skilled/.test(hist) && /M3 - Skilled/.test(hist) && /Annual revision/.test(hist) && /Promotion/.test(hist) && /Admin User/.test(hist), hist.slice(0, 260));
  m.unmount();
  const hrows = await q(`select gross_salary::numeric g, previous_gross::numeric pg, effective_from::text ef, effective_to::text et from public.employee_salary_assignments where employee_id='${UI1}' order by effective_from`);
  ok("UI-B DB after the UI-driven saves: 11000 (closed 2031-05-31) -> 13000 (closed 2031-12-31) -> 25000 (open); previous grosses preserved", hrows.length === 3 && Number(hrows[1].pg) === 11000 && Number(hrows[2].pg) === 13000 && hrows[0].et === "2031-05-31" && hrows[1].et === "2031-12-31" && hrows[2].et === null, JSON.stringify(hrows));
  // closed-period protection as the form would surface it
  await as("staff", { emp: E.E2, pm: "1" });
  const closedMsg = await ui.payrollService.assignEmployeeSalary({ employeeId: UI2, grossSalary: 11000, effectiveFrom: "2026-09-15", salaryStructureId: null, reason: "x" }).then(() => null, (e) => e.message);
  ok("UI-B Saving a salary back-dated into a Finalized period is refused by the server (message reaches the user); nothing saved", /finalized\/locked/.test(closedMsg ?? "") && (await asgCount(UI2)) === 0, closedMsg ?? "saved!");
  await as("super_admin");

  // ================================================================ C. EMPLOYEE PROFILE — Current Salary card
  m = ui.mount(h(ui.EmployeeCurrentSalaryCard, { employeeId: UI1, companyId: C }));
  await waitFor(() => m.container.querySelector('[aria-label="Current salary"]'));
  const card = txt(m.container), link = m.container.querySelector("a");
  ok("UI-C Profile card (has salary): Current Salary ₹25,000, Grade/Structure M3 - Skilled, slab, Effective From, and an 'Edit Salary' link to the Payroll Salary section",
    /Current Salary\s*₹25,000/.test(card) && /M3 - Skilled/.test(card) && /Slab ₹20,000\.01 – ∞/.test(card) && /2032-01-01/.test(card) && link && link.getAttribute("href") === `/employees/${UI1}/edit#payroll-salary` && /Edit Salary/.test(txt(link)), card);
  m.unmount();
  m = ui.mount(h(ui.EmployeeCurrentSalaryCard, { employeeId: UI2, companyId: C }));
  await waitFor(() => /Salary not configured/.test(txt(m.container)));
  ok("UI-C Profile card (no salary): 'Salary not configured' and an 'Add Salary' link", /Salary not configured/.test(txt(m.container)) && /Add Salary/.test(txt(m.container.querySelector("a"))));
  m.unmount();

  // ================================================================ K/L. permissions + security as the screens see them
  await as("staff", { emp: E.E2, pm: "" });
  m = ui.mount(h(ui.SalaryHarness, { employeeId: UI1, companyId: C, onIntent: (i) => { intent = i; } }));
  await waitFor(() => /maintained by payroll administrators/.test(txt(m.container)));
  ok("UI-K A user who is not a payroll administrator sees the salary READ-ONLY: no Gross input, no Update Salary button", !m.container.querySelector("#ps-gross") && !btn(m.container, "Update Salary") && /maintained by payroll administrators/.test(txt(m.container)));
  m.unmount();
  await as("staff", { emp: E.E2, pm: "1" }); ctx.dyn = "deny";
  m = ui.mount(h(ui.SalaryHarness, { employeeId: UI1, companyId: C, onIntent: (i) => { intent = i; } }));
  await waitFor(() => /Current Gross Salary/.test(txt(m.container)));
  ok("UI-K Payroll admin whose dynamic permission payroll/EDIT is DENIED: salary is read-only in the UI", !m.container.querySelector("#ps-gross") && !btn(m.container, "Update Salary"));
  m.unmount();
  await db.exec(`select set_config('test.dyn','deny',false);`);   // the denial the server-side has_dynamic_permission sees
  const denied = await ui.payrollService.assignEmployeeSalary({ employeeId: UI2, grossSalary: 11000, effectiveFrom: "2033-01-01", salaryStructureId: null, reason: "x" }).then(() => null, (e) => e.message);
  ok("UI-K/server: with payroll/EDIT denied the server refuses to create a salary even if the UI were bypassed", /permission to edit salary/.test(denied ?? "") && (await asgCount(UI2)) === 0, `${denied}`);
  await db.exec(`select set_config('test.dyn','',false);`); ctx.dyn = "";
  await as("staff", { emp: OE, company: C2, pm: "1" });
  const cross = await ui.payrollService.assignEmployeeSalary({ employeeId: UI2, grossSalary: 11000, effectiveFrom: "2033-01-01", salaryStructureId: null, reason: "x" }).then(() => null, (e) => e.message);
  const crossPrev = await ui.payrollService.previewPolicy(null, "2026-10-01", { company_id: C, gross: 11000 }).then(() => null, (e) => e.message);
  const crossHist = await ui.payrollService.listEmployeeAssignments(UI1);
  ok("UI-L Security: a payroll user of ANOTHER company cannot create a salary for this company's employee, cannot preview this company's configuration, and reads no salary history",
    /Not authorised/.test(cross ?? "") && /Not authorised/.test(crossPrev ?? "") && crossHist.length === 0 && (await asgCount(UI2)) === 0, `${cross} | ${crossPrev} | ${crossHist.length}`);
  await as("super_admin");

  // ================================================================ E/F/G. SALARY STRUCTURE TEST dialog (read-only) incl. Medical Fund
  const structs = { M1: { id: sid.M1, code: "M1", name: "Unskilled", status: "active" }, M2: { id: sid.M2, code: "M2", name: "Semi Skilled", status: "active" }, M3: { id: sid.M3, code: "M3", name: "Skilled", status: "active" } };
  const before = await snapDb();
  ctx.calls.length = 0;
  m = ui.mount(h(ui.SalaryStructureTestDialog, { structure: structs.M1, companyId: C, onClose: () => {} }));
  await waitFor(() => document.body.querySelector("#st-gross"));
  await waitFor(() => document.body.querySelectorAll('[aria-label="Quick test values"] button').length >= 7);   // chips include the slab boundaries once the slabs have loaded
  const chips = [...document.body.querySelectorAll('[aria-label="Quick test values"] button')].map(txt);
  ok("UI-E Test dialog: quick-test chips = ₹10,000 ₹12,499.99 ₹12,500 ₹13,000 ₹20,000 ₹20,000.01 ₹25,000 (boundaries read from the slabs)", JSON.stringify(chips) === JSON.stringify(["₹10,000", "₹12,499.99", "₹12,500", "₹13,000", "₹20,000", "₹20,000.01", "₹25,000"]), JSON.stringify(chips));
  const expectRoute = { 10000: "M1", 12499.99: "M1", 12500: "M2", 13000: "M2", 20000: "M2", 20000.01: "M3", 25000: "M3" };
  for (const chip of [...document.body.querySelectorAll('[aria-label="Quick test values"] button')]) {
    const g = Number(txt(chip).replace(/[₹,]/g, ""));
    ui.click(chip);
    const want = expectRoute[g];
    const got = await waitFor(() => new RegExp(`^${want} - `).test(fieldValue(document.body, "Structure")));
    const dl = document.body.querySelector('[role="dialog"]');
    ok(`UI-E Test dialog (opened on M1) chip ₹${g.toLocaleString("en-IN")} -> Structure ${want}, Grade ${want}, slab shown, bifurcation shown`,
      Boolean(got) && fieldValue(dl, "Grade").startsWith(`${want} - `) && fieldValue(dl, "Slab").length > 3 && /Salary Bifurcation/.test(txt(dl)) && /BASIC/.test(txt(dl)) && /ALLOWANCE/.test(txt(dl)) && (want === "M1" ? /routes to M1/.test(txt(dl)) : new RegExp(`falls in the slab of ${want}`).test(txt(dl))), `${fieldValue(dl, "Structure")} :: ${txt(dl).slice(0, 200)}`);
  }
  ui.setValue(document.body.querySelector("#st-gross"), "11000");
  await waitFor(() => /routes to M1/.test(txt(document.body.querySelector('[role="dialog"]'))));
  const d11 = txt(document.body.querySelector('[role="dialog"]'));
  ok("UI-E Test M1 @ 11,000: Structure/Grade M1 - Unskilled, Slab ₹0 – ₹12,499.99, Basic ₹5,500, DA ₹5,500, Allowance ₹0, Gross ₹11,000, common components + Gross/Earnings/Deductions/Net shown",
    fieldValue(document.body, "Slab") === "₹0 – ₹12,499.99" && /BASIC\s*₹5,500\s*DA\s*₹5,500\s*ALLOWANCE\s*₹0\s*Gross\s*₹11,000/.test(d11) && /Common Payroll Components/.test(d11) && /Estimated Net/.test(d11) && /Deductions/.test(d11) && /PF|Provident Fund/.test(d11) && /Medical Fund/.test(d11), d11.slice(0, 400));
  ok("UI-F Test dialog without a Joining Date: 'Medical Fund eligibility cannot be evaluated without Joining Date.' (today's date is not used)", /Medical Fund eligibility cannot be evaluated without Joining Date\./.test(d11));
  ui.setValue(document.body.querySelector("#st-join"), "2025-10-01"); ui.setValue(document.body.querySelector("#st-month"), "2026-09");
  await waitFor(() => /Not applicable/.test(txt(document.body.querySelector('[role="dialog"]'))));
  const dSep = txt(document.body.querySelector('[role="dialog"]'));
  ok("UI-F Test M1 @ 11,000, joined 01-Oct-2025, September 2026: Medical Fund 'Not applicable · ₹0 — 12 months of service not completed (completes on 01 Oct 2026)'; structure/bifurcation NOT blanked",
    /Not applicable · ₹0/.test(dSep) && /12 months of service not completed \(completes on 01 Oct 2026\)/.test(dSep) && fieldValue(document.body, "Structure") === "M1 - Unskilled" && /BASIC\s*₹5,500/.test(dSep) && !/cannot be evaluated without Joining Date/.test(dSep));
  ui.setValue(document.body.querySelector("#st-month"), "2026-10");
  const medOct = await waitFor(() => { const t = txt(document.body.querySelector('[role="dialog"]')); return /Medical Fund\s*[−-]\s*₹100/.test(t) && !/12 months of service not completed/.test(t); });
  ok("UI-F Test M1 @ 11,000, joined 01-Oct-2025, October 2026: Medical Fund applicable = ₹100", Boolean(medOct), txt(document.body.querySelector('[role="dialog"]')).slice(300, 700));
  for (const [g, want] of [[9000, 75], [20000.01, 125]]) {
    ui.setValue(document.body.querySelector("#st-gross"), String(g));
    const gotv = await waitFor(() => { const t = txt(document.body.querySelector('[role="dialog"]')); return new RegExp(`Medical Fund\\s*[−-]\\s*₹${want}(?!\\d)`).test(t) && !/₹100\b.*Medical/.test("") ; });
    ok(`UI-G Test dialog, October 2026, eligible: Gross ${g} -> Medical Fund ₹${want}`, Boolean(gotv), txt(document.body.querySelector('[role="dialog"]')).slice(300, 600));
  }
  const afterCalls = ctx.calls.filter((c) => (c.kind === "from" && c.op !== "select") || (c.kind === "rpc" && /assign|set_|create|update|delete|activate|clone|upsert|commit/.test(c.name)));
  ok("UI-E Test dialog is READ-ONLY: every call it made was a read (no salary/employee/component/structure write call), and a table snapshot is byte-identical before and after", afterCalls.length === 0 && (await snapDb()) === before, JSON.stringify(afterCalls));
  ok("UI-E Test dialog only used the payroll engine's own functions", [...new Set(ctx.calls.filter((c) => c.kind === "rpc").map((c) => c.name))].every((n) => ["payroll_policy_preview", "salary_preview", "payroll_policy_list", "payroll_can_manage", "my_dynamic_permission"].includes(n)), JSON.stringify([...new Set(ctx.calls.filter((c) => c.kind === "rpc").map((c) => c.name))]));
  m.unmount(); cleanup();
  for (const [code, g] of [["M2", 13000], ["M3", 25000]]) {
    m = ui.mount(h(ui.SalaryStructureTestDialog, { structure: structs[code], companyId: C, onClose: () => {} }));
    await waitFor(() => document.body.querySelector("#st-gross"));
    ui.setValue(document.body.querySelector("#st-gross"), String(g));
    const okRoute = await waitFor(() => new RegExp(`routes to ${code}`).test(txt(document.body.querySelector('[role="dialog"]'))));
    ok(`UI-E Test ${code} @ ${g.toLocaleString("en-IN")}: routes to ${code}, shows ${code} - ${structs[code].name}`, Boolean(okRoute) && fieldValue(document.body, "Structure") === `${code} - ${structs[code].name}`);
    m.unmount(); cleanup();
  }

  // ================================================================ F/G/H. COMMON PAYROLL COMPONENTS — Medical Fund configure screen
  m = ui.mount(h(ui.CommonComponentsTab, { companyId: C }));
  const medRow = await waitFor(() => [...document.body.querySelectorAll("tbody tr")].find((r) => /MEDFUND/.test(txt(r)) && /Configure/.test(txt(r))));
  ok("UI-F Common Components table: Medical Fund row shows 'Eligibility: After 12 months of service', method Custom Formula, and applies to ALL salary structures (one component, not per structure)",
    Boolean(medRow) && /Eligibility: After 12 months of service/.test(txt(medRow)) && /Custom Formula/.test(txt(medRow)) && /All salary structures/.test(txt(medRow)), txt(medRow));
  ok("UI-H Common components are global: exactly one Medical Fund (MEDFUND) row applying to 'All salary structures'; no row is tied to M1 / M2 / M3",
    [...document.body.querySelectorAll("tbody tr")].filter((r) => /MEDFUND/.test(txt(r))).length === 1 && ![...document.body.querySelectorAll("tbody tr")].some((r) => /\bM[123]\b/.test(txt(r))));
  ui.click(btn(medRow, "Configure"));
  const dlg = await waitFor(() => document.body.querySelector('[role="dialog"]'));
  await waitFor(() => dlg.querySelector('[aria-label="Gross limit 1"]'));
  const val = (label) => dlg.querySelector(`[aria-label="${label}"]`)?.value;
  ok("UI-F Configure Medical Fund: the SAVED formula reopens in the range editor — 10000 -> ₹75, 20000 -> ₹100, otherwise ₹125 (no blank rows)",
    val("Gross limit 1") === "10000" && val("Amount 1") === "75" && val("Gross limit 2") === "20000" && val("Amount 2") === "100" && val("Amount above last limit") === "125", `${val("Gross limit 1")}/${val("Amount 1")}/${val("Gross limit 2")}/${val("Amount 2")}/${val("Amount above last limit")}`);
  ok("UI-F Configure Medical Fund: NO 'Row 1: enter a Gross limit' error is shown", !/enter a Gross limit/i.test(txt(dlg)) && !dlg.querySelector('[role="alert"]'));
  ok("UI-F Configure Medical Fund: row 1 = 'below (limit not included)', row 2 = 'up to and including' (so ₹20,000 is still ₹100)", /below \(limit not included\)/.test(txt(dlg)) && /up to and including/.test(txt(dlg)));
  ok("UI-F Configure Medical Fund: Eligibility control reads the stored fields — 'After X months of service', Months of service = 12, and the summary 'Eligibility: After 12 months of service'",
    /After X months of service/.test(txt(dlg)) && dlg.querySelector("#cc-months")?.value === "12" && /Eligibility: After 12 months of service/.test(txt(dlg)));
  ok("UI-F Configure dialog scrolls inside the viewport (max-h + overflow-y-auto) so Eligibility and Save are always reachable", /max-h-\[92vh\]/.test(dlg.className) && /overflow-y-auto/.test(dlg.className));
  ok("UI-F The formula shown is generated from the rows and equals what is stored (existing syntax only: least/greatest/ceil/GROSS)", /75 \+ 25 \* \(1 - least\(1, greatest\(0, ceil\(10000 - GROSS\)\)\)\) \+ 25 \* least\(1, greatest\(0, ceil\(GROSS - 20000\)\)\)/.test(txt(dlg)) && !/\bIF\b|CASE/.test(txt(dlg.querySelector("code"))));
  ui.click(btn(dlg, "Check the limits"));
  const lim = await waitFor(() => /₹20,000\.01 → ₹125/.test(txt(dlg)));
  const limTxt = txt(dlg);
  ok("UI-G 'Check the limits' (server evaluator): ₹9,999.99 -> ₹75, ₹10,000 -> ₹100, ₹20,000 -> ₹100, ₹20,000.01 -> ₹125",
    Boolean(lim) && /₹9,999\.99 → ₹75/.test(limTxt) && /₹10,000 → ₹100/.test(limTxt) && /₹20,000 → ₹100/.test(limTxt) && /₹20,000\.01 → ₹125/.test(limTxt), limTxt.slice(limTxt.indexOf("Check the limits"), limTxt.indexOf("Check the limits") + 220));
  const runTest = async (grossV, join, month) => {
    ui.setValue(dlg.querySelector('[aria-label="Test Gross"]'), String(grossV));
    ui.setValue(dlg.querySelector('[aria-label="Test joining date"]'), join); ui.setValue(dlg.querySelector('[aria-label="Test payroll month"]'), month);
    const testBtn = [...dlg.querySelectorAll("button")].find((b) => txt(b) === "Test");
    ui.click(testBtn);
    await waitFor(() => [...dlg.querySelectorAll('[role="status"]')].some((s) => /^(=|Not applicable)/.test(txt(s))) , 4000);
    return txt([...dlg.querySelectorAll('[role="status"]')].find((s) => /^(=|Not applicable)/.test(txt(s))));
  };
  const t1 = await runTest("11000", "2025-10-01", "2026-09");
  ok("UI-F Test button (whole component) joined 01-Oct-2025, Sep 2026, Gross 11,000 -> 'Not applicable · ₹0' with the 12-month reason and 'would be ₹100 once eligible'", /^Not applicable · ₹0/.test(t1) && /12 months of service not completed \(completes on 01 Oct 2026\)/.test(t1) && /would be ₹100/.test(t1), t1);
  const t2 = await runTest("11000", "2025-10-01", "2026-10");
  ok("UI-F Test button, Oct 2026, Gross 11,000 -> '= ₹100' (eligible: completion date on/before the month end)", /^= ₹100/.test(t2), t2);
  const bandRes = [];
  for (const g of ["9999.99", "10000", "20000", "20000.01", "25000"]) bandRes.push((await runTest(g, "2025-10-01", "2026-10")).match(/₹[\d,.]+/)?.[0]);
  ok("UI-G Test button, eligible: 9,999.99 -> ₹75, 10,000 -> ₹100, 20,000 -> ₹100, 20,000.01 -> ₹125, 25,000 -> ₹125", JSON.stringify(bandRes) === JSON.stringify(["₹75", "₹100", "₹100", "₹125", "₹125"]), JSON.stringify(bandRes));
  // edit -> Save -> persisted with eligibility intact -> reopen
  ui.setValue(dlg.querySelector('[aria-label="Amount 1"]'), "80"); ui.setValue(dlg.querySelector('[aria-label="Amount above last limit"]'), "130");
  await ui.flush(100);
  const saveBtn = btn(dlg, "Save");
  ui.click(saveBtn);
  let stored = null;
  for (let i = 0; i < 60 && !(stored && /^80 \+ 20/.test(stored.base_formula ?? "")); i++) { await ui.flush(150); stored = (await q(`select base_formula, eligibility_type, eligibility_months, enabled from public.payroll_statutory_rules where component_code='MEDFUND' and payroll_policy_id='${pol}'`))[0]; }
  // 75 -> 80 makes the first step (100 - 80) = 20 and the last step (130 - 100) = 30
  ok("UI-F Edit in the range editor (75->80, 125->130) and Save: the rule is updated with the generated formula, and eligibility (after_months / 12) is PRESERVED",
    Boolean(stored) && /^80 \+ 20 \* .* \+ 30 \* /.test(stored.base_formula) && stored.eligibility_type === "after_months" && stored.eligibility_months === 12 && stored.enabled === true, JSON.stringify(stored));
  m.unmount(); cleanup();
  m = ui.mount(h(ui.CommonComponentsTab, { companyId: C }));
  const medRow2 = await waitFor(() => [...document.body.querySelectorAll("tbody tr")].find((r) => /MEDFUND/.test(txt(r)) && /Configure/.test(txt(r))));
  ui.click(btn(medRow2, "Configure"));
  const dlg2 = await waitFor(() => document.body.querySelector('[role="dialog"]'));
  await waitFor(() => dlg2.querySelector('[aria-label="Gross limit 1"]'));
  const v2 = (l) => dlg2.querySelector(`[aria-label="${l}"]`)?.value;
  ok("UI-F Re-opening after Save shows the edited values (80 / 100 / 130) — save -> reopen round trip", v2("Amount 1") === "80" && v2("Amount 2") === "100" && v2("Amount above last limit") === "130" && v2("Gross limit 1") === "10000" && v2("Gross limit 2") === "20000");
  ui.setValue(dlg2.querySelector('[aria-label="Amount 1"]'), "75"); ui.setValue(dlg2.querySelector('[aria-label="Amount above last limit"]'), "125");
  await ui.flush(100); ui.click(btn(dlg2, "Save"));
  for (let i = 0; i < 60; i++) { await ui.flush(150); stored = (await q(`select base_formula from public.payroll_statutory_rules where component_code='MEDFUND' and payroll_policy_id='${pol}'`))[0]; if (/^75 \+ 25/.test(stored.base_formula)) break; }
  ok("UI-F Restored to 75 / 100 / 125 through the UI (saved formula is the original band formula again)", /^75 \+ 25 \* \(1 - least\(1, greatest\(0, ceil\(10000 - GROSS\)\)\)\) \+ 25 \* least\(1, greatest\(0, ceil\(GROSS - 20000\)\)\)$/.test(stored.base_formula), stored.base_formula);
  m.unmount(); cleanup();

  // ================================================================ A/B (page level). The REAL Employee Add / Edit page — submit flow
  await db.exec(`alter table public.employees add column if not exists employee_scope text, add column if not exists reporting_manager_id uuid, add column if not exists first_name text, add column if not exists middle_name text, add column if not exists last_name text, add column if not exists gender text, add column if not exists date_of_birth date, add column if not exists blood_group text, add column if not exists mobile text, add column if not exists alternate_mobile text, add column if not exists email text, add column if not exists confirmation_date date, add column if not exists exit_reason text, add column if not exists exit_status text, add column if not exists salary_type text, add column if not exists created_by uuid, add column if not exists updated_by uuid, add column if not exists store_team_id uuid, add column if not exists is_active boolean default true, add column if not exists photo_url text, add column if not exists auth_user_id uuid, add column if not exists created_at timestamptz default now(), add column if not exists updated_at timestamptz default now()`);
  await db.exec(`update public.employees set employee_scope='company_wide', first_name='UI', last_name='Form', full_name='UI Form' where id in ('${UI1}','${UI2}')`);
  const inputOf = (root, labelStart) => [...root.querySelectorAll("label")].find((x) => txt(x).startsWith(labelStart))?.parentElement?.querySelector("input");
  const submitOf = (root, label) => [...root.querySelectorAll('button[type="submit"]')].find((b) => txt(b).includes(label));
  const empByName = async (n) => (await q(`select id, grade_id, employee_scope, joining_date::text jd from public.employees where full_name = '${n}'`))[0] ?? null;
  const fillNew = async (first, last, joinDate) => {
    const fm = ui.mount(h(ui.FormRoutes, { initial: "/employees/new" }), { router: false });
    await waitFor(() => document.body.querySelector("#payroll-salary") && inputOf(document.body, "First Name"));
    ui.click([...document.body.querySelectorAll('input[type="radio"]')][1]);   // Company Wide (no store needed)
    ui.setValue(inputOf(document.body, "First Name"), first); ui.setValue(inputOf(document.body, "Last Name"), last);
    if (joinDate) ui.setValue(inputOf(document.body, "Joining Date"), joinDate);
    await waitFor(() => document.body.querySelector("#ps-gross"));
    return fm;
  };
  const navPath = () => txt(document.getElementById("nav-marker"));

  // F1 — create WITHOUT salary
  let fm = await fillNew("QA", "NoSalary", "2025-10-01");
  ok("UI-A page: Add Employee shows the Payroll Salary section; with Gross blank it says 'Salary not configured yet' and there is no HR-Grade confusion ('HR Grade (optional — not used for salary)')",
    /Salary not configured yet/.test(txt(document.body)) && /HR Grade \(optional — not used for salary\)/.test(txt(document.body)) && /not used for salary/.test(txt(document.body)));
  ui.click(submitOf(document.body, "Add Employee"));
  await waitFor(async () => false, 10);
  let e1 = null; for (let i = 0; i < 40 && !e1; i++) { await ui.flush(150); e1 = await empByName("QA NoSalary"); }
  await waitFor(() => document.getElementById("nav-marker") || document.body.querySelector('[role="dialog"]'), 4000);
  ok("UI-A page: an employee can be created WITHOUT salary — the employee is saved and NO salary revision is created", Boolean(e1) && e1.employee_scope === "company_wide" && (await asgCount(e1.id)) === 0 && e1.grade_id === null, JSON.stringify(e1));
  fm.unmount(); cleanup();

  // F2 — create WITH salary (Gross 11,000 -> M1) through the existing revision engine
  const grade0 = null;
  fm = await fillNew("QA", "WithSalary", "2025-10-01");
  ui.setValue(document.body.querySelector("#ps-eff"), "2035-01-01"); ui.setValue(document.body.querySelector("#ps-gross"), "11000");
  await waitFor(() => /^M1 - /.test(txt(document.body.querySelector("#ps-structure"))));
  ok("UI-A page: typing Gross 11,000 on the Add Employee page shows Auto Grade / Structure 'M1 - Unskilled' and slab '₹0 – ₹12,499.99' (no grade selection)", txt(document.body.querySelector("#ps-grade")) === "M1 - Unskilled" && txt(document.body.querySelector("#ps-structure")) === "M1 - Unskilled" && txt(document.body.querySelector("#ps-slab")) === "₹0 – ₹12,499.99");
  ui.click(submitOf(document.body, "Add Employee"));
  let e2 = null; for (let i = 0; i < 40 && !e2; i++) { await ui.flush(150); e2 = await empByName("QA WithSalary"); }
  let asg2 = []; for (let i = 0; i < 40 && asg2.length === 0 && e2; i++) { await ui.flush(150); asg2 = await q(`select gross_salary::numeric g, effective_from::text ef, resolved_structure_id r, salary_structure_id s, reason from public.employee_salary_assignments where employee_id='${e2.id}'`); }
  ok("UI-A page: create WITH salary saves the employee AND one salary revision (Gross 11,000, effective 2035-01-01, resolved structure M1, 'Initial salary', no manual structure override)",
    Boolean(e2) && asg2.length === 1 && Number(asg2[0].g) === 11000 && asg2[0].ef === "2035-01-01" && asg2[0].r === sid.M1 && asg2[0].s === null && asg2[0].reason === "Initial salary", JSON.stringify(asg2));
  ok("UI-D employees.grade_id is NOT overwritten by saving the salary (stays NULL — Payroll Auto Grade is derived, HR Grade is a separate field)", e2 && e2.grade_id === grade0);
  fm.unmount(); cleanup();

  // F3 — Gross outside every active slab: Save is blocked, NOTHING is created
  await db.exec(`delete from public.salary_slab_rules where salary_structure_id='${sid.M3}';`);
  fm = await fillNew("QA", "Blocked", "2025-10-01");
  ui.setValue(document.body.querySelector("#ps-eff"), "2035-01-01"); ui.setValue(document.body.querySelector("#ps-gross"), "30000");
  await waitFor(() => [...document.body.querySelectorAll('[role="alert"]')].some((e) => /No active salary structure is configured/.test(txt(e))));
  const empsBefore = (await q(`select count(*)::int n from public.employees`))[0].n;
  ui.click(submitOf(document.body, "Add Employee"));
  await ui.flush(1500);
  ok("UI-A page: Gross outside every active slab shows the clear error and submitting creates NO employee and NO salary (invalid salary is never saved)",
    (await q(`select count(*)::int n from public.employees`))[0].n === empsBefore && (await empByName("QA Blocked")) === null && !document.getElementById("nav-marker"));
  await db.exec(`insert into public.salary_slab_rules (company_id, salary_structure_id, min_gross, max_gross) values ('${C}','${sid.M3}',20000.01,null);`);
  fm.unmount(); cleanup();

  // F4 — Edit an existing employee (has salary 25,000 / M3 after the earlier steps)
  const openEdit = async () => { const f = ui.mount(h(ui.FormRoutes, { initial: `/employees/${UI1}/edit#payroll-salary` }), { router: false }); await waitFor(() => /Current Gross Salary/.test(txt(document.body)) && inputOf(document.body, "First Name")?.value === "UI"); return f; };
  fm = await openEdit();
  ok("UI-B page: Edit Employee shows the current salary (₹25,000, M3 - Skilled) and the employee's own details are loaded", /₹25,000/.test(txt(document.body.querySelector('[aria-label="Current salary"]'))) && /M3 - Skilled/.test(txt(document.body.querySelector('[aria-label="Current salary"]'))) && inputOf(document.body, "First Name").value === "UI");
  const revBefore = await asgCount(UI1);
  ui.click(submitOf(document.body, "Save changes"));
  await waitFor(() => /^\/employees/.test(navPath()), 8000);
  ok("UI-B page: 'Save changes' without touching salary saves the employee and creates NO salary revision", /^\/employees/.test(navPath()) && (await asgCount(UI1)) === revBefore, `${navPath()} ${await asgCount(UI1)}/${revBefore}`);
  fm.unmount(); cleanup();
  fm = await openEdit();
  ui.click(btn(document.body, "Update Salary")); await waitFor(() => document.body.querySelector("#ps-gross"));
  ui.setValue(document.body.querySelector("#ps-eff"), "2033-01-01");   // same Gross 25,000 kept
  await ui.flush(200);
  await waitFor(() => !/Working it out/.test(txt(document.body.querySelector("#ps-structure"))) && /M3 - Skilled/.test(txt(document.body.querySelector("#ps-structure"))));   // the form holds Save until the structure is resolved
  ui.click(submitOf(document.body, "Save changes"));
  await waitFor(() => /^\/employees/.test(navPath()), 8000);
  ok("UI-B page: 'Update Salary' opened but the Gross left UNCHANGED (25,000) -> saving does NOT create a duplicate revision", /^\/employees/.test(navPath()) && (await asgCount(UI1)) === revBefore);
  fm.unmount(); cleanup();
  fm = await openEdit();
  ui.click(btn(document.body, "Update Salary")); await waitFor(() => document.body.querySelector("#ps-gross"));
  ui.setValue(document.body.querySelector("#ps-eff"), "2033-01-01"); ui.setValue(document.body.querySelector("#ps-gross"), "13000");
  await waitFor(() => /Previous: M3 - Skilled → New: M2 - Semi Skilled/.test(txt(document.body)));
  ok("UI-B page: changing Gross 25,000 -> 13,000 on Edit Employee immediately shows 'Previous: M3 - Skilled → New: M2 - Semi Skilled'", /Previous: M3 - Skilled → New: M2 - Semi Skilled/.test(txt(document.body)));
  ui.click(submitOf(document.body, "Save changes"));
  await waitFor(() => /^\/employees/.test(navPath()), 8000);
  const h4 = await q(`select gross_salary::numeric g, previous_gross::numeric pg, resolved_structure_id r, previous_structure_id p, effective_from::text ef from public.employee_salary_assignments where employee_id='${UI1}' order by effective_from`);
  ok("UI-B page: saving creates exactly ONE new revision (13,000 / M2 from 2033-01-01) with previous Gross 25,000 and previous structure M3; earlier history is intact (4 rows)",
    h4.length === revBefore + 1 && Number(h4[3].g) === 13000 && h4[3].r === sid.M2 && Number(h4[3].pg) === 25000 && h4[3].p === sid.M3 && h4[0].ef === "2031-01-01" && Number(h4[0].g) === 11000, JSON.stringify(h4));
  fm.unmount(); cleanup();

  // ================================================================ J. PAYROLL SETTINGS page
  m = ui.mount(h(ui.PayrollSettingsPage, null));
  await waitFor(() => document.body.querySelector('[role="tab"]'));
  const tabs = [...document.body.querySelectorAll('[role="tab"]')].map(txt);
  ok("UI-J Payroll Settings tabs are exactly: Salary Structures, Common Payroll Components, Payroll Rules, Store Calendars, Advanced — no 'Employee Salary' tab",
    JSON.stringify(tabs) === JSON.stringify(["Salary Structures", "Common Payroll Components", "Payroll Rules", "Store Calendars", "Advanced"]), JSON.stringify(tabs));
  const pageTxt = txt(document.body);
  ok("UI-J Page description: salary is maintained from the Employee profile; Structures = Basic/DA/Allowance; Common Components defined once for every structure",
    /Salary is maintained from the Employee profile\. Enter Gross Salary there and the system automatically determines Grade, Salary Structure and Salary Slab\./.test(pageTxt) && /Salary Structures \(Basic \/ DA \/ Allowance\)/.test(pageTxt) && /defined once for every structure/.test(pageTxt));
  await waitFor(() => [...document.body.querySelectorAll("tbody tr")].some((r) => /^M1/.test(txt(r))));
  const rowOf = (code) => [...document.body.querySelectorAll("tbody tr")].find((r) => new RegExp(`^${code}(?![0-9])`).test(txt(r)));
  for (const code of ["M1", "M2", "M3"]) {
    const r = rowOf(code), labels = r ? [...r.querySelectorAll("button")].map(txt).filter(Boolean) : [];
    ok(`UI-E Salary Structures: ${code} row has the actions Test | Edit | Clone | Delete`, r && ["Test", "Edit", "Clone", "Delete"].every((l) => labels.some((x) => x === l || x.endsWith(l))) && labels.indexOf("Test") < labels.indexOf("Edit"), JSON.stringify(labels));
  }
  ok("UI-E Salary Structures: the slab column reads from the database — M1 '₹0 – ₹12,499.99', M2 '₹12,500 – ₹20,000', M3 '₹20,000.01 – ∞'", /₹0 – ₹12,499\.99/.test(txt(rowOf("M1"))) && /₹12,500 – ₹20,000/.test(txt(rowOf("M2"))) && /₹20,000\.01 – ∞/.test(txt(rowOf("M3"))));
  const m2Before = await snapDb();
  ui.click([...rowOf("M2").querySelectorAll("button")].find((b) => txt(b) === "Test"));
  const tdlg = await waitFor(() => document.body.querySelector('[role="dialog"]'));
  ok("UI-E Clicking Test on M2 opens 'Test Salary Structure — M2' (read-only notice shown)", Boolean(tdlg) && /Test Salary Structure — M2/.test(txt(tdlg)) && /Read-only\. Nothing is saved/.test(txt(tdlg)));
  ok("UI-E Opening the Test dialog changed no data", (await snapDb()) === m2Before);
  m.unmount(); cleanup();

  // ================================================================ K. OT / LATE hourly basis (migration 0184) — company C4 (policy: 10 h/day, Late on)
  const hourly = (card) => { const mm = /Hourly Rate\s*₹([\d,]+(?:\.\d+)?)/.exec(card); return mm ? mm[1] : null; };
  const kCard = () => document.body.querySelector('[aria-label="OT and Late hourly basis"]');
  const tabEl = (label) => [...document.body.querySelectorAll('[role="tab"]')].find((t) => txt(t) === label);
  const panel = () => [...document.body.querySelectorAll('[role="tabpanel"]')].filter((p) => p.getAttribute("data-state") === "active").pop();
  const s4m1 = { id: s4.M1, code: "M1", name: "Unskilled", status: "active" };
  const kBefore = await snapDb();
  ctx.calls.length = 0;
  m = ui.mount(h(ui.SalaryStructureTestDialog, { structure: s4m1, companyId: C4, onClose: () => {} }));
  await waitFor(() => document.body.querySelector("#st-gross"));
  ui.setValue(document.body.querySelector("#st-gross"), "11000"); ui.setValue(document.body.querySelector("#st-month"), "2026-09");
  await waitFor(() => kCard() && /Calendar Days\s*30/.test(txt(kCard())));
  const k9 = txt(kCard());
  ok("UI-M Structure Test M1 @ 11,000, Sep 2026: shows Payroll Month September 2026, Calendar Days 30, Basic ₹5,500, DA ₹5,500, Basic + DA ₹11,000, Standard Hours/Day 10, Daily ₹366.67, Hourly ₹36.67 (all server values)",
    /Payroll Month\s*September 2026/.test(k9) && /Calendar Days\s*30/.test(k9) && /Basic\s*₹5,500/.test(k9) && /DA\s*₹5,500/.test(k9) && /Basic \+ DA\s*₹11,000/.test(k9) && /Standard Hours\/Day\s*10(?!\d)/.test(k9) && /Daily Rate\s*₹366\.67/.test(k9) && hourly(k9) === "36.67" && !/Payable OT Minutes/.test(k9), k9);
  ok("UI-M Structure Test still shows Structure M1 - Unskilled, the slab and the Basic/DA/Allowance bifurcation (unchanged)", fieldValue(document.body, "Structure") === "M1 - Unskilled" && /BASIC\s*₹5,500\s*DA\s*₹5,500\s*ALLOWANCE\s*₹0/.test(txt(document.body.querySelector('[role="dialog"]'))));
  for (const [month, days, want] of [["2026-10", 31, "35.48"], ["2027-02", 28, "39.29"], ["2028-02", 29, "37.93"], ["2026-09", 30, "36.67"]]) {
    ui.setValue(document.body.querySelector("#st-month"), month);
    const got = await waitFor(() => kCard() && new RegExp(`Calendar Days\\s*${days}(?!\\d)`).test(txt(kCard())));
    ok(`UI-M Structure Test follows the Test Date: ${month} -> ${days} calendar days, hourly ₹${want} (11,000 ÷ ${days} ÷ 10)`, Boolean(got) && hourly(txt(kCard())) === want, txt(kCard() ?? document.body).slice(0, 300));
  }
  const kCalls = ctx.calls.filter((c) => (c.kind === "from" && c.op !== "select") || (c.kind === "rpc" && /assign|set_|create|update|delete|activate|clone|upsert|commit/.test(c.name)));
  ok("UI-M Structure Test with the OT/Late basis stays READ-ONLY: no write call and a byte-identical table snapshot", kCalls.length === 0 && (await snapDb()) === kBefore, JSON.stringify(kCalls));
  m.unmount(); cleanup();

  // K2. the basis card over the REAL preview of a real employee (Sep 2026: 60 OT + 60 Late minutes; Basic 5,000 + DA 5,000)
  await as("super_admin");
  const pvX = await ui.payrollService.previewPolicy(emp4.X[0], "2026-09-01", { ot_minutes: 60, late_minutes: 60 });
  m = ui.mount(h(ui.OtLateBasisCard, { basis: pvX.ot_late_basis, showAmounts: true }));
  await waitFor(() => kCard());
  const kx = txt(kCard());
  ok("UI-M Payroll Preview card lists Month, Calendar Days, Basic, DA, Basic + DA, Std Hours, Daily, Hourly, Payable OT minutes / hours / multiplier / amount, Payable Late minutes / hours / amount",
    /Payroll Month\s*September 2026/.test(kx) && /Calendar Days\s*30/.test(kx) && /Basic\s*₹5,000/.test(kx) && /DA\s*₹5,000/.test(kx) && /Basic \+ DA\s*₹10,000/.test(kx) && /Standard Hours\/Day\s*10(?!\d)/.test(kx) && /Daily Rate\s*₹333\.33/.test(kx) && hourly(kx) === "33.33"
    && /Payable OT Minutes\s*60/.test(kx) && /OT Hours\s*1(?![\d.])/.test(kx) && /OT Multiplier \/ Rule\s*Not separately configured/.test(kx) && /OT Amount\s*₹33\.33/.test(kx)
    && /Payable Late Minutes\s*60/.test(kx) && /Late Hours\s*1(?![\d.])/.test(kx) && /Late Amount\s*−\s*₹33\.33/.test(kx), kx);
  ok("UI-M OT multiplier is never invented: the card says the hourly base was calculated but no OT multiplier is configured (1× on payable minutes)", /no OT multiplier is configured/.test(kx));
  m.unmount(); cleanup();
  const pvX2 = await ui.payrollService.previewPolicy(emp4.X[0], "2026-10-01", { ot_minutes: 120, late_minutes: 60 });
  m = ui.mount(h(ui.OtLateBasisCard, { basis: pvX2.ot_late_basis, showAmounts: true }));
  await waitFor(() => kCard());
  const kx2 = txt(kCard());
  ok("UI-M Oct 2026 card: 31 calendar days, hourly ₹32.26, OT 120 min = 2 h -> ₹64.52, Late 60 min -> − ₹32.26", /Calendar Days\s*31/.test(kx2) && hourly(kx2) === "32.26" && /OT Hours\s*2(?![\d.])/.test(kx2) && /OT Amount\s*₹64\.52/.test(kx2) && /Late Amount\s*−\s*₹32\.26/.test(kx2), kx2);
  m.unmount(); cleanup();
  m = ui.mount(h(ui.OtLateBasisCard, { basis: { ...pvX.ot_late_basis, std_hours_per_day: null, hourly_rate: null, daily_rate: null, ot_amount: null, late_amount: null }, showAmounts: true }));
  await waitFor(() => kCard());
  ok("UI-M Standard hours/day not configured: the card says so (Not configured) instead of showing a made-up rate", /Standard Hours\/Day\s*Not configured/.test(txt(kCard())) && /Standard hours\/day is not configured in the payroll policy/.test(txt(kCard())) && /Hourly Rate\s*—/.test(txt(kCard())));
  m.unmount(); cleanup();

  // K3. Payroll Settings -> Payroll Rules -> Overtime / Late / Proration tabs (policy P4 of company C4)
  globalThis.__AUTH.user.companyId = C4;
  m = ui.mount(h(ui.PayrollSettingsPage, null));
  await waitFor(() => tabEl("Payroll Rules"));
  ui.openTab(tabEl("Payroll Rules"));
  const p4btn = await waitFor(() => [...document.body.querySelectorAll("button")].find((b) => /^P4(?!\d)/.test(txt(b)) && /active/.test(txt(b))));
  ui.click(p4btn);
  await waitFor(() => tabEl("Overtime"));
  const subTabs = [...document.body.querySelectorAll('[role="tab"]')].map(txt);
  ok("UI-M Payroll Rules sub-tabs: Proration, LWP, Overtime, Late, Night Duty, Statutory, Deduction Order, Cap & Negative Net", JSON.stringify(subTabs.slice(subTabs.indexOf("Proration"))) === JSON.stringify(["Proration", "LWP", "Overtime", "Late", "Night Duty", "Statutory", "Deduction Order", "Cap & Negative Net"]), JSON.stringify(subTabs));
  ui.openTab(tabEl("Overtime"));
  await waitFor(() => /Overtime Calculation Basis/.test(txt(panel())));
  const ot = panel(), otT = txt(ot), otLabels = [...ot.querySelectorAll("label")].map(txt);
  ok("UI-M Overtime tab: Overtime Calculation Basis = Attendance OT Rules, Hourly Wage Basis = Basic + DA, Calendar Day Divisor = Payroll Month Calendar Days, Standard Hours/Day = 10 (read from the policy)",
    fieldValue(ot, "Overtime Calculation Basis") === "Attendance OT Rules" && fieldValue(ot, "Hourly Wage Basis") === "Basic + DA" && fieldValue(ot, "Calendar Day Divisor") === "Payroll Month Calendar Days" && Number(ot.querySelector('input[type="number"]').value) === 10, otT.slice(0, 500));
  ok("UI-M Overtime tab info box: 'Company OT hourly basis: (Basic + DA) ÷ calendar days in payroll month ÷ 10 hours.' + the ₹10,000 ÷ 30 ÷ 10 = ₹33.33/hour September example",
    /Company OT hourly basis:\s*\(Basic \+ DA\) ÷ calendar days in payroll month ÷ 10 hours\./.test(otT) && /Example: ₹10,000 ÷ 30 ÷ 10 = ₹33\.33\/hour in September\./.test(otT), otT);
  ok("UI-M Overtime tab has NO conflicting generic fields (no rate type / multiplier / proration / working-days input) — only the enable checkbox and Standard Hours/Day",
    !otLabels.some((l) => /rate type|multiplier|proration|working-days|divisor \(fallback\)|custom/i.test(l)) && ot.querySelectorAll('input[type="number"]').length === 1, JSON.stringify(otLabels));
  // Standard hours come from the policy, not from the screen: change to 9 through the UI -> the engine follows; restore to 10
  ui.setValue(ot.querySelector('input[type="number"]'), "9");
  ui.click(btn(ot, "Save"));
  let std9 = null; for (let i = 0; i < 40 && std9 !== 9; i++) { await ui.flush(120); std9 = Number((await q(`select ot_std_hours_per_day s from public.payroll_policies where id='${pol4}'`))[0].s); }
  const b9 = (await q(`select hourly_rate::numeric hr from public.payroll_ot_late_basis('${pol4}','2026-09-01','2026-09-30',5000,5000)`))[0].hr;
  ok("UI-M Standard Hours/Day saved through the screen (10 -> 9) is what the engine uses: Sep hourly = 10,000 ÷ 30 ÷ 9 = 37.037… (nothing hard-coded to 10)", std9 === 9 && Math.abs(Number(b9) - 10000 / 30 / 9) < 1e-9, `${std9} ${b9}`);
  ui.openTab(tabEl("Late"));
  await waitFor(() => /Late Deduction Basis/.test(txt(panel())));
  await waitFor(() => /^9\b/.test(fieldValue(panel(), "Standard Hours/Day")));
  ok("UI-M Late tab mirrors the SAME Standard Hours/Day as Overtime (one value: now 9 -> 'Hourly Basis … ÷ 9')", /^9\b/.test(fieldValue(panel(), "Standard Hours/Day")) && fieldValue(panel(), "Hourly Basis") === "(Basic + DA) ÷ calendar days ÷ 9");
  ui.openTab(tabEl("Overtime"));
  await waitFor(() => /Overtime Calculation Basis/.test(txt(panel())));
  ui.setValue(panel().querySelector('input[type="number"]'), "10");
  ui.click(btn(panel(), "Save"));
  let std10 = null; for (let i = 0; i < 40 && std10 !== 10; i++) { await ui.flush(120); std10 = Number((await q(`select ot_std_hours_per_day s from public.payroll_policies where id='${pol4}'`))[0].s); }
  ok("UI-M Standard Hours/Day restored to 10 through the screen", std10 === 10);
  ui.openTab(tabEl("Late"));
  await waitFor(() => /Late Deduction Basis/.test(txt(panel())));
  await waitFor(() => /^10\b/.test(fieldValue(panel(), "Standard Hours/Day")));
  const lt = panel(), ltT = txt(lt);
  ok("UI-M Late tab shows Late Deduction Basis = Basic + DA, Calendar Divisor = Payroll Month Calendar Days, Standard Hours/Day = 10, Hourly Basis = (Basic + DA) ÷ calendar days ÷ 10",
    fieldValue(lt, "Late Deduction Basis") === "Basic + DA" && fieldValue(lt, "Calendar Divisor") === "Payroll Month Calendar Days" && /^10\b/.test(fieldValue(lt, "Standard Hours/Day")) && fieldValue(lt, "Hourly Basis") === "(Basic + DA) ÷ calendar days ÷ 10", ltT.slice(0, 500));
  ok("UI-M Late tab keeps eligibility under Attendance: explains Late Rule -> Information -> Penalty Rule and links to Attendance settings", /Late Rule/.test(ltT) && /Penalty Rule/.test(ltT) && /Configure Late \/ Penalty Rules/.test(ltT));
  const cb = lt.querySelector('button[role="checkbox"]');
  ok("UI-M Late tab: 'Deduct Late from salary' reflects the policy (P4 = on)", cb && cb.getAttribute("aria-checked") === "true");
  ui.click(cb);
  ui.click(btn(lt, "Save"));
  let lateOff = null; for (let i = 0; i < 40 && lateOff !== false; i++) { await ui.flush(120); lateOff = (await q(`select late_deduction_enabled l from public.payroll_policies where id='${pol4}'`))[0].l; }
  ok("UI-M Late toggle saved through the screen: late_deduction_enabled true -> false, nothing else on the policy changed (OT still on, 10 h/day)", lateOff === false && (await q(`select ot_enabled o, ot_std_hours_per_day::numeric s from public.payroll_policies where id='${pol4}'`)).every((r) => r.o === true && Number(r.s) === 10));
  await db.exec(`update public.payroll_policies set late_deduction_enabled = true where id='${pol4}'`);
  ui.openTab(tabEl("Proration"));
  await waitFor(() => /Proration method/.test(txt(panel())));
  ok("UI-M Proration tab: Working-days method stays available and says it drives salary proration / LWP only — OT and Late do not use it", /Working-days method/.test(txt(panel())) && /Overtime and Late do not use them/.test(txt(panel())));
  m.unmount(); cleanup();
  globalThis.__AUTH.user.companyId = C;

  return true;
};

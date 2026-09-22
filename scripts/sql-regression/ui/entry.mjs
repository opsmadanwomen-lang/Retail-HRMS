// Entry bundled by ui-qa.cjs: the REAL app components + hooks, mounted in a headless DOM (jsdom). Nothing here re-implements app logic.
import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { EmployeeFormPage } from "@/modules/employees/pages/EmployeeFormPage";
import { Toaster } from "@/components/ui/toaster";
import { EmployeePayrollSalarySection } from "@/modules/employees/components/EmployeePayrollSalarySection";
import { EmployeeCurrentSalaryCard } from "@/modules/employees/components/EmployeeCurrentSalaryCard";
import { SalaryStructureTestDialog } from "@/modules/payroll/components/SalaryStructureTestDialog";
import { CommonComponentsTab } from "@/modules/payroll/components/CommonComponentsTab";
import { PayrollSettingsPage } from "@/modules/payroll/pages/PayrollSettingsPage";
import { emptySalaryDraft } from "@/modules/employees/salaryDraft";
import { payrollService } from "@/services/payrollService";
import { OtLateBasisCard } from "@/modules/payroll/components/OtLateBasisCard";

const h = React.createElement;
export { h, payrollService, EmployeeCurrentSalaryCard, SalaryStructureTestDialog, CommonComponentsTab, PayrollSettingsPage, OtLateBasisCard };

export function mount(ui, opts = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 }, mutations: { retry: false } } });
  const root = createRoot(container);
  act(() => { root.render(h(QueryClientProvider, { client: qc }, opts.router === false ? ui : h(MemoryRouter, null, ui))); });
  return { container, unmount() { act(() => root.unmount()); container.remove(); } };
}

/** Holds the form-side draft exactly like EmployeeFormPage does, and reports the parent-facing "intent" (save / blocking). */
export function SalaryHarness({ employeeId, companyId, joiningDate, onIntent }) {
  const [draft, setDraft] = React.useState(emptySalaryDraft);
  return h(EmployeePayrollSalarySection, { employeeId, companyId, joiningDate, draft, onDraftChange: setDraft, onIntentChange: onIntent });
}

export async function flush(ms = 60) { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); }
export function setValue(el, value) {
  const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  act(() => { setter.call(el, value); el.dispatchEvent(new window.Event("input", { bubbles: true })); });
}
export function click(el) { act(() => { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })); }); }
/** Radix Tabs activate on mousedown (left button), not click. */
export function openTab(el) { act(() => { el.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, ctrlKey: false })); }); }

function LocationMarker() { const l = useLocation(); return h("div", { id: "nav-marker" }, `${l.pathname}${l.hash}`); }
/** The REAL Employee Add / Edit page inside a router; any other path renders a marker so navigation after saving can be observed. */
export function FormRoutes({ initial }) {
  return h(MemoryRouter, { initialEntries: [initial] }, h(Toaster), h(Routes, null,
    h(Route, { path: "/employees/new", element: h(EmployeeFormPage) }),
    h(Route, { path: "/employees/:id/edit", element: h(EmployeeFormPage) }),
    h(Route, { path: "*", element: h(LocationMarker) })));
}
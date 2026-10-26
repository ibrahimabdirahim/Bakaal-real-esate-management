// Operations module: work orders, staff and salary privacy, service tasks, expense payment.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { createUnit } from "@/server/services/property";
import {
  createExpense,
  createTask,
  createWorkOrder,
  decideExpense,
  decideQuote,
  getStaffMember,
  listExpenses,
  listStaff,
  markExpensePaid,
  saveStaff,
  setStaffSalary,
  setTaskStatus,
  updateWorkOrder,
  type ExpenseInput,
} from "@/server/services/operations";
import { dashboard } from "@/server/services/reports";
import { recordSalaryPayment } from "@/server/services/salaries";
import { addDays, monthStart, todayISO } from "@/lib/dates";

assertTestDatabase();

const admin = actor("ADMIN");
const manager = actor("MANAGER");
const finance = actor("FINANCE");
const operations = actor("OPERATIONS");

const wo = { title: "Leaking tap", description: null, location: null, priority: "MEDIUM" as const, reportedVia: "Phone" };
const update = { assignee: null, quoteAmount: null, outcome: null, costTreatment: null };

describe("work orders", () => {
  beforeEach(async () => {
    await resetTestData();
    await db.building.create({ data: { name: "Ops Building" } });
  });

  it("follows the allowed status path and requires the closing details", async () => {
    const unit = await createUnit(manager, { unitNumber: "A-1", floor: null, unitType: null, notes: null });
    await expect(createWorkOrder(operations, { ...wo, unitId: null })).rejects.toThrow(/unit or describe the common area/);
    const w = await createWorkOrder(operations, { ...wo, unitId: unit.id });
    expect(w.number).toMatch(/^WO-\d{4}-000001$/);
    await expect(updateWorkOrder(operations, w.id, { ...update, status: "COMPLETED" })).rejects.toThrow(/cannot move from OPEN to COMPLETED/);
    await expect(updateWorkOrder(operations, w.id, { ...update, status: "ASSIGNED" })).rejects.toThrow(/who the work is assigned to/);
    await updateWorkOrder(operations, w.id, { ...update, status: "ASSIGNED", assignee: "Plumber" });
    await updateWorkOrder(operations, w.id, { ...update, status: "IN_PROGRESS", assignee: "Plumber" });
    await expect(updateWorkOrder(operations, w.id, { ...update, status: "COMPLETED", assignee: "Plumber" })).rejects.toThrow(/outcome and a cost treatment/);
    await updateWorkOrder(operations, w.id, { ...update, status: "COMPLETED", assignee: "Plumber", outcome: "Washer replaced", costTreatment: "Building expense" });
    await expect(updateWorkOrder(operations, w.id, { ...update, status: "CANCELLED" })).rejects.toThrow(/closed/);
    expect((await db.workOrder.findUniqueOrThrow({ where: { id: w.id } })).closedAt).not.toBeNull();
  });

  it("needs a manager to decide a quote, and resets the decision when the quote changes", async () => {
    const w = await createWorkOrder(operations, { ...wo, unitId: null, location: "Roof" });
    await expect(decideQuote(manager, w.id, true)).rejects.toThrow(/no quote/);
    await updateWorkOrder(operations, w.id, { ...update, status: "OPEN", quoteAmount: 350000 });
    await expect(decideQuote(operations, w.id, true)).rejects.toThrow(/permission/);
    await decideQuote(manager, w.id, true);
    expect((await db.workOrder.findUniqueOrThrow({ where: { id: w.id } })).quoteApproved).toBe(true);
    await updateWorkOrder(operations, w.id, { ...update, status: "OPEN", quoteAmount: 400000 });
    expect((await db.workOrder.findUniqueOrThrow({ where: { id: w.id } })).quoteApproved).toBeNull();
  });

  it("counts open and urgent work orders on the dashboard; closed ones drop out", async () => {
    const a = await createWorkOrder(operations, { ...wo, unitId: null, location: "Lobby", priority: "URGENT" });
    await createWorkOrder(operations, { ...wo, unitId: null, location: "Gate" });
    expect(await dashboard(operations, "month")).toMatchObject({ openWorkOrders: 2, urgentWorkOrders: 1 });
    await updateWorkOrder(operations, a.id, { ...update, status: "CANCELLED" });
    expect(await dashboard(operations, "month")).toMatchObject({ openWorkOrders: 1, urgentWorkOrders: 0 });
  });
});

describe("staff, salary privacy and tasks", () => {
  beforeEach(async () => {
    await resetTestData();
    await db.building.create({ data: { name: "Ops Building" } });
  });

  it("keeps salary amounts visible and editable only for salary roles", async () => {
    const input = { fullName: "Mary W", position: "Cleaner", phone: null, salaryAmount: 1800000, startDate: null, endDate: null, notes: null };
    const byManager = await saveStaff(manager, null, input); // manager may not set salary
    expect(byManager.salaryAmount).toBeNull();
    await expect(setStaffSalary(manager, byManager.id, 1800000)).rejects.toThrow(/permission/);
    await setStaffSalary(finance, byManager.id, 1800000);
    await saveStaff(manager, byManager.id, { ...input, position: "Senior cleaner" }); // manager edit keeps the salary
    expect((await getStaffMember(manager, byManager.id))?.staff.salaryAmount).toBeNull();
    expect((await getStaffMember(finance, byManager.id))?.staff.salaryAmount).toBe(1800000);
    expect((await listStaff(operations))[0].salaryAmount).toBeNull();
    const events = await db.auditEvent.findMany({ where: { entityId: byManager.id } });
    expect(JSON.stringify(events.map((e) => [e.summary, e.before, e.after]))).not.toContain("18000"); // amounts never written to the audit log
    await expect(saveStaff(manager, null, { ...input, startDate: "2026-05-01", endDate: "2026-04-01" })).rejects.toThrow(/End date/);
  });

  it("closes tasks once and shows overdue tasks as needing attention", async () => {
    const t = await createTask(operations, { title: "Clean stairwell", staffMemberId: null, dueDate: addDays(todayISO(), -2), notes: null });
    expect((await dashboard(manager, "month")).pending.find((p) => p.key === "tasks")?.count).toBe(1);
    await setTaskStatus(operations, t.id, "DONE");
    await expect(setTaskStatus(operations, t.id, "CANCELLED")).rejects.toThrow(/already closed/);
    expect((await dashboard(manager, "month")).pending.find((p) => p.key === "tasks")).toBeUndefined();
  });
});

describe("expense payment and salary expenses", () => {
  beforeEach(async () => {
    await resetTestData();
    await db.building.create({ data: { name: "Ops Building" } });
  });

  const exp = (over: Partial<ExpenseInput> = {}): ExpenseInput => ({
    category: "WATER", payee: "Water Co", description: "Water", amount: 120000, servicePeriodStart: monthStart(todayISO()), servicePeriodEnd: null, costCentre: null, evidenceNote: null, workOrderId: null, staffMemberId: null, ...over,
  });

  it("separates approved from paid and pays only approved expenses", async () => {
    const e = await createExpense(operations, exp(), true);
    await expect(markExpensePaid(finance, e.id, "BANK", "TRX1")).rejects.toThrow(/Only an approved expense/);
    await decideExpense(finance, e.id, "APPROVED", null);
    expect((await db.expense.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("APPROVED");
    await expect(markExpensePaid(finance, e.id, "BANK", "  ")).rejects.toThrow(/payment reference/);
    await markExpensePaid(finance, e.id, "BANK", "TRX1");
    const paid = await db.expense.findUniqueOrThrow({ where: { id: e.id } });
    expect(paid).toMatchObject({ status: "PAID", paymentMethod: "BANK", paymentReference: "TRX1", paidById: finance.id });
    expect((await dashboard(finance, "month")).money?.expensesByStatus).toEqual({ awaiting: 0, approved: 120000, rejected: 0 });
  });

  it("hides salary expenses from roles without salary access", async () => {
    const mary = await saveStaff(admin, null, { fullName: "Mary W", position: "Cleaner", phone: null, salaryAmount: null, startDate: null, endDate: null, notes: null });
    await recordSalaryPayment(finance, { staffMemberId: mary.id, month: monthStart(todayISO()), gross: 120000, allowances: 0, deductions: 0, notes: null, evidenceNote: null }, true);
    await createExpense(operations, exp(), true);
    expect((await listExpenses(finance)).map((e) => e.category).sort()).toEqual(["SALARIES", "WATER"]);
    expect((await listExpenses(manager)).map((e) => e.category)).toEqual(["WATER"]);
    expect((await dashboard(manager, "month")).money?.expensesByStatus.awaiting).toBe(120000); // salary excluded for the manager
    expect((await dashboard(admin, "month")).money?.expensesByStatus.awaiting).toBe(240000);
  });
});

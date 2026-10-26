// One-step approvals (F61): maintenance quotes, expenses and salary payments are approved with one
// confirmation by a role that may approve, never twice, audited once, and nothing else changes —
// in particular approval never marks an expense or salary as paid or moves any money.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { canDecideExpense, createExpense, createWorkOrder, decideExpense, decideQuote, markExpensePaid, saveStaff, updateWorkOrder } from "@/server/services/operations";
import { recordSalaryPayment } from "@/server/services/salaries";
import { dashboard, expenseReport, reconciliationCheck } from "@/server/services/reports";
import { addMonths, monthStart, todayISO } from "@/lib/dates";

assertTestDatabase();

const admin = actor("ADMIN");
const manager = actor("MANAGER");
const finance = actor("FINANCE");
const operations = actor("OPERATIONS");
const auditor = actor("AUDITOR");
const today = todayISO();
const thisMonth = monthStart(today);
const water = { category: "WATER" as const, payee: "Nairobi Water", description: "October bill", amount: 1240000, servicePeriodStart: thisMonth, servicePeriodEnd: null, costCentre: null, evidenceNote: null, workOrderId: null, staffMemberId: null };

beforeEach(async () => {
  await resetTestData();
  await db.building.create({ data: { name: "Approval Building" } });
});

const actions = (entityId: string) => db.auditEvent.findMany({ where: { entityId }, orderBy: { id: "asc" } }).then((xs) => xs.map((x) => x.action));

describe("maintenance (the work order's quote)", () => {
  const quoted = async () => {
    const w = await createWorkOrder(manager, { title: "Leaking tank", description: null, unitId: null, location: "Roof", priority: "HIGH", reportedVia: null });
    await updateWorkOrder(manager, w.id, { status: "ASSIGNED", assignee: "Plumber", quoteAmount: 800000, outcome: null, costTreatment: null });
    return w;
  };

  it("approves in one step without changing the work order's status, assignment or completion", async () => {
    const w = await quoted();
    const before = await db.workOrder.findUniqueOrThrow({ where: { id: w.id } });
    await decideQuote(manager, w.id, true);
    const after = await db.workOrder.findUniqueOrThrow({ where: { id: w.id } });
    expect(after).toMatchObject({ quoteApproved: true, status: "ASSIGNED", assignee: "Plumber", closedAt: null, outcome: null });
    expect({ ...after, quoteApproved: null, updatedAt: null }).toEqual({ ...before, quoteApproved: null, updatedAt: null });
    const event = await db.auditEvent.findFirstOrThrow({ where: { entityId: w.id, action: "workorder.quote_approve" } });
    expect(event).toMatchObject({ actorId: manager.id, before: { status: "ASSIGNED", quoteApproved: null }, after: { status: "ASSIGNED", quoteApproved: true } });
  });

  it("refuses roles without the permission, a second approval, a closed work order and no quote", async () => {
    const w = await quoted();
    for (const who of [operations, finance, auditor]) await expect(decideQuote(who, w.id, true)).rejects.toThrow(/permission/);
    const twice = await Promise.allSettled([decideQuote(admin, w.id, true), decideQuote(manager, w.id, true)]);
    expect(twice.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(decideQuote(admin, w.id, true)).rejects.toThrow(/already been approved/);
    expect((await actions(w.id)).filter((a) => a === "workorder.quote_approve")).toHaveLength(1);

    const noQuote = await createWorkOrder(manager, { title: "Bulb", description: null, unitId: null, location: "Lobby", priority: "LOW", reportedVia: null });
    await expect(decideQuote(manager, noQuote.id, true)).rejects.toThrow(/no quote/);
    const closed = await quoted();
    await updateWorkOrder(manager, closed.id, { status: "CANCELLED", assignee: "Plumber", quoteAmount: 800000, outcome: null, costTreatment: null });
    await expect(decideQuote(manager, closed.id, true)).rejects.toThrow(/closed/);
    expect((await db.workOrder.findUniqueOrThrow({ where: { id: closed.id } })).quoteApproved).toBeNull();
  });
});

describe("expenses", () => {
  it("approves in one step with no reason, does not mark it paid, and keeps every figure consistent", async () => {
    const e = await createExpense(operations, water, true);
    const dashBefore = (await dashboard(finance, "month")).money!;
    expect(dashBefore.expenses).toBe(0);
    expect((await dashboard(finance, "month")).submittedExpenses).toBe(1);

    await decideExpense(finance, e.id, "APPROVED", null);
    const after = await db.expense.findUniqueOrThrow({ where: { id: e.id } });
    expect(after).toMatchObject({ status: "APPROVED", decidedById: finance.id, decisionReason: null, paidAt: null, paidById: null, paidDate: null, paymentMethod: null, paymentReference: null });
    expect([String(after.amount), after.category, after.payee, after.description]).toEqual(["12400", "WATER", "Nairobi Water", "October bill"]);

    // An approved cost, not money paid out: counted as approved-unpaid, never as paid; no payment or invoice exists.
    const d = await dashboard(finance, "month");
    expect(d.money).toMatchObject({ expenses: 1240000, expensesApprovedUnpaid: 1240000, expensesPaid: 0 });
    expect(d.submittedExpenses).toBe(0);
    const report = await expenseReport(finance, thisMonth, today);
    expect(report).toMatchObject({ total: 1240000, approvedUnpaid: 1240000 });
    expect([await db.payment.count(), await db.invoice.count()]).toEqual([0, 0]);
    expect((await reconciliationCheck(finance)).every((x) => x.matches)).toBe(true);
    expect(await actions(e.id)).toEqual(["expense.submit", "expense.approve"]);

    await markExpensePaid(finance, e.id, "BANK", "TRX-9"); // paying stays its own step
    expect((await dashboard(finance, "month")).money).toMatchObject({ expensesApprovedUnpaid: 0, expensesPaid: 1240000 });
  });

  it("is decided once even when approved twice at the same moment", async () => {
    const e = await createExpense(operations, water, true);
    const both = await Promise.allSettled([decideExpense(finance, e.id, "APPROVED", null), decideExpense(admin, e.id, "APPROVED", null)]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(both.find((r) => r.status === "rejected")).toMatchObject({ reason: expect.objectContaining({ message: "This expense has already been approved." }) });
    expect((await actions(e.id)).filter((a) => a === "expense.approve")).toHaveLength(1);
  });

  it("refuses roles that may not approve, and expenses that are not awaiting approval", async () => {
    const e = await createExpense(operations, water, true);
    for (const who of [manager, operations, auditor]) {
      await expect(decideExpense(who, e.id, "APPROVED", null)).rejects.toThrow(/permission/);
      expect(canDecideExpense(who, e)).toBe(false);
    }
    expect((await db.expense.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("SUBMITTED");

    const draft = await createExpense(operations, water, false);
    await expect(decideExpense(finance, draft.id, "APPROVED", null)).rejects.toThrow(/Only a submitted expense.*draft/);
    const rejected = await createExpense(operations, water, true);
    await decideExpense(finance, rejected.id, "REJECTED", "Duplicate bill");
    await expect(decideExpense(finance, rejected.id, "APPROVED", null)).rejects.toThrow(/Only a submitted expense.*rejected/);
    const paid = await createExpense(operations, water, true);
    await decideExpense(finance, paid.id, "APPROVED", null);
    await markExpensePaid(finance, paid.id, "BANK", "TRX-1");
    await expect(decideExpense(admin, paid.id, "APPROVED", null)).rejects.toThrow(/already been approved/);
    expect((await db.expense.findUniqueOrThrow({ where: { id: paid.id } })).status).toBe("PAID");
  });

  it("lets Admin and Finance approve their own in one step, audited as their own", async () => {
    for (const who of [admin, finance]) {
      const own = await createExpense(who, water, true);
      expect(canDecideExpense(who, own)).toBe(true);
      await decideExpense(who, own.id, "APPROVED", null);
      expect(await db.auditEvent.findFirstOrThrow({ where: { entityId: own.id, action: "expense.approve" } })).toMatchObject({ actorId: who.id, after: expect.objectContaining({ ownRecord: true }) });
    }
  });
});

describe("salary payments", () => {
  const salary = async () => {
    const mary = await saveStaff(admin, null, { fullName: "Mary Wairimu", position: "Cleaner", phone: null, salaryAmount: 1800000, startDate: "2025-01-01", endDate: null, notes: null });
    return recordSalaryPayment(finance, { staffMemberId: mary.id, month: addMonths(thisMonth, -1), gross: 1800000, allowances: 200050, deductions: 150025, notes: null, evidenceNote: "Attendance sheet" }, true);
  };

  it("approves in one step, keeping staff, period, gross, deductions and net, and does not mark it paid", async () => {
    const s = await salary();
    const before = await db.expense.findUniqueOrThrow({ where: { id: s.id } });
    await decideExpense(admin, s.id, "APPROVED", null);
    const after = await db.expense.findUniqueOrThrow({ where: { id: s.id } });
    expect({ ...after, status: null, decidedById: null, decidedAt: null, updatedAt: null }).toEqual({ ...before, status: null, decidedById: null, decidedAt: null, updatedAt: null });
    expect([after.staffMemberId, after.servicePeriodStart, String(after.salaryGross), String(after.salaryDeductions), String(after.amount)]).toEqual([before.staffMemberId, before.servicePeriodStart, "18000", "1500.25", "18500.25"]);
    expect(after).toMatchObject({ status: "APPROVED", paidAt: null, paidDate: null, paymentReference: null });
    expect(await db.payment.count()).toBe(0);
    expect(await actions(s.id)).toEqual(["salary.submit", "expense.approve"]);
    const event = await db.auditEvent.findFirstOrThrow({ where: { entityId: s.id, action: "expense.approve" } });
    expect(event.summary).toMatch(/^Approved salary payment /);
  });

  it("refuses roles without salary approval, a second approval, and a paid or rejected salary", async () => {
    const s = await salary();
    for (const who of [manager, operations, auditor]) await expect(decideExpense(who, s.id, "APPROVED", null)).rejects.toThrow(/permission/);
    const both = await Promise.allSettled([decideExpense(admin, s.id, "APPROVED", null), decideExpense(finance, s.id, "APPROVED", null)]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(both.find((r) => r.status === "rejected")).toMatchObject({ reason: expect.objectContaining({ message: "This salary payment has already been approved." }) });
    await markExpensePaid(finance, s.id, "CASH", "");
    await expect(decideExpense(admin, s.id, "APPROVED", null)).rejects.toThrow(/already been approved/);
    expect((await db.expense.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("PAID");
    expect((await actions(s.id)).filter((a) => a === "expense.approve")).toHaveLength(1);
  });
});

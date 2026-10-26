// Staff salary payments: recorded with a breakdown, one per staff member and month, approved or
// rejected as a separate step, and marked paid only when the actual payment is recorded. Salary
// details stay restricted to roles with salary access.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { PermissionError } from "@/server/auth/actor";
import { listAuditEvents } from "@/server/services/admin";
import { documentForDownload, stageUpload } from "@/server/services/documents";
import { decideExpense, listExpenses, markExpensePaid, saveStaff, updateDraftExpense } from "@/server/services/operations";
import { dashboard, expenseReport } from "@/server/services/reports";
import { deleteSalaryDraft, getSalaryPayment, listSalaryPayments, recordSalaryPayment, salaryOverview, updateSalaryPayment, type SalaryInput } from "@/server/services/salaries";
import { addDays, addMonths, monthStart, todayISO } from "@/lib/dates";

assertTestDatabase();

const manager = actor("MANAGER");
const operations = actor("OPERATIONS");
const auditor = actor("AUDITOR");
const finance = actor("FINANCE");
const admin = actor("ADMIN");
const today = todayISO();
const thisMonth = monthStart(today);
const lastMonth = addMonths(thisMonth, -1);
const PDF = new TextEncoder().encode("%PDF-1.4\n% salary proof\n%%EOF\n");

let maryId = "";
const input = (over: Partial<SalaryInput> = {}): SalaryInput => ({ staffMemberId: maryId, month: lastMonth, gross: 1800000, allowances: 200050, deductions: 150025, notes: null, evidenceNote: "Attendance sheet", ...over });

beforeEach(async () => {
  await resetTestData();
  await db.building.create({ data: { name: "Salary Building" } });
  maryId = (await saveStaff(admin, null, { fullName: "Mary Wairimu", position: "Cleaner", phone: null, salaryAmount: 1800000, startDate: "2025-01-01", endDate: null, notes: null })).id;
});

describe("recording a salary payment", () => {
  it("stores the breakdown and computes net exactly, linked to the staff member and month", async () => {
    const e = await recordSalaryPayment(finance, input(), true);
    expect(e).toMatchObject({ category: "SALARIES", status: "SUBMITTED", staffMemberId: maryId, payee: "Mary Wairimu", submittedById: finance.id });
    expect([e.salaryGross, e.salaryAllowances, e.salaryDeductions, e.amount].map(String)).toEqual(["18000", "2000.5", "1500.25", "18500.25"]);
    expect(e.servicePeriodStart?.toISOString().slice(0, 10)).toBe(lastMonth);
    expect(e.paidAt).toBeNull();
    const event = await db.auditEvent.findFirstOrThrow({ where: { entityId: e.id } });
    expect(event).toMatchObject({ action: "salary.submit", actorId: finance.id });
  });

  it("saves a draft that is not pending approval and counts nowhere", async () => {
    const d = await recordSalaryPayment(finance, input(), false);
    expect(d.status).toBe("DRAFT");
    expect((await dashboard(finance, "12m")).money?.expenses).toBe(0);
  });

  it("refuses invalid amounts, future months, unknown staff and months outside employment", async () => {
    await expect(recordSalaryPayment(finance, input({ deductions: 2000051 }), true)).rejects.toThrow(/cannot equal or exceed/);
    await expect(recordSalaryPayment(finance, input({ gross: 0 }), true)).rejects.toThrow(/more than zero/);
    await expect(recordSalaryPayment(finance, input({ month: addMonths(thisMonth, 1) }), true)).rejects.toThrow(/future month/);
    await expect(recordSalaryPayment(finance, input({ staffMemberId: "nobody" }), true)).rejects.toThrow(/Choose a staff member/);
    await expect(recordSalaryPayment(finance, input({ month: "2024-12-01" }), true)).rejects.toThrow(/was not employed in December 2024/);
    expect(await db.expense.count()).toBe(0);
  });

  it("allows one salary payment per staff member and month; a rejected one frees the month", async () => {
    const first = await recordSalaryPayment(finance, input(), true);
    await expect(recordSalaryPayment(finance, input({ gross: 1 }), false)).rejects.toThrow(/already exists \(EXP-\d{4}-\d+, pending approval\)/);
    await recordSalaryPayment(finance, input({ month: thisMonth }), true); // another month is fine
    await decideExpense(admin, first.id, "REJECTED", "Wrong deductions");
    const again = await recordSalaryPayment(finance, input({ deductions: 0 }), true);
    expect(again.amount.toString()).toBe("20000.5");
    // The rejected one is kept as decided; it cannot be edited or resubmitted.
    await expect(updateSalaryPayment(finance, first.id, input(), true)).rejects.toThrow(/kept as it was decided/);
  });

  it("lets only one of two simultaneous submissions for the same month through", async () => {
    const results = await Promise.allSettled([recordSalaryPayment(finance, input(), true), recordSalaryPayment(finance, input(), true)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.expense.count({ where: { category: "SALARIES" } })).toBe(1);
  });

  it("is backed by database constraints: the breakdown must add up and a month cannot be duplicated", async () => {
    const e = await recordSalaryPayment(finance, input(), true);
    await expect(db.expense.update({ where: { id: e.id }, data: { amount: "1.00" } })).rejects.toThrow();
    const copy: Record<string, unknown> = { ...(await db.expense.findUniqueOrThrow({ where: { id: e.id } })) };
    delete copy.id;
    await expect(db.expense.create({ data: { ...(copy as Parameters<typeof db.expense.create>[0]["data"]), number: "EXP-DUP-1" } })).rejects.toThrow(/Expense_one_salary_per_staff_month/);
  });

  it("keeps salaries on one path: the general expense form refuses them and cannot edit them", async () => {
    const d = await recordSalaryPayment(finance, input(), false);
    await expect(updateDraftExpense(finance, d.id, { category: "WATER", payee: "x", description: "x", amount: 100, servicePeriodStart: null, servicePeriodEnd: null, costCentre: null, evidenceNote: null, workOrderId: null, staffMemberId: null }, false)).rejects.toThrow(/Salary Payments/);
    const edited = await updateSalaryPayment(finance, d.id, input({ allowances: 0, deductions: 0, notes: "Corrected" }), true);
    expect(edited).toMatchObject({ status: "SUBMITTED", description: "Corrected" });
    expect(edited.amount.toString()).toBe("18000");
  });
});

describe("approval and payment are separate steps", () => {
  it("approves without marking paid, then records the actual payment with date, method, reference and proof", async () => {
    const e = await recordSalaryPayment(finance, input(), true);
    await expect(markExpensePaid(admin, e.id, "MPESA", "QX1")).rejects.toThrow(/Only an approved salary payment/);
    await decideExpense(admin, e.id, "APPROVED", null);
    const approved = await db.expense.findUniqueOrThrow({ where: { id: e.id } });
    expect(approved).toMatchObject({ status: "APPROVED", decidedById: admin.id, paidAt: null, paidDate: null, paymentReference: null });

    await expect(markExpensePaid(finance, e.id, "MPESA", "QX1", { paidDate: addDays(today, 1) })).rejects.toThrow(/future/);
    const proof = await stageUpload(finance, { ownerType: "EXPENSE", category: "RECEIPT", fileName: "mpesa.pdf", bytes: PDF });
    await markExpensePaid(finance, e.id, "CASH", "", { paidDate: today, documentIds: [proof.id] }); // a cash salary may have no reference
    const paid = await db.expense.findUniqueOrThrow({ where: { id: e.id } });
    expect(paid).toMatchObject({ status: "PAID", paymentMethod: "CASH", paymentReference: null, paidById: finance.id });
    expect(paid.paidDate?.toISOString().slice(0, 10)).toBe(today);
    expect(await db.document.findUniqueOrThrow({ where: { id: proof.id } })).toMatchObject({ ownerType: "EXPENSE", ownerId: e.id });
    await expect(markExpensePaid(finance, e.id, "CASH", "")).rejects.toThrow(/already been marked as paid/);
    expect((await db.auditEvent.findMany({ where: { entityId: e.id }, orderBy: { id: "asc" } })).map((x) => x.action)).toEqual(["salary.submit", "expense.approve", "salary.pay", "document.attach"]);
  });

  it("pays once even when submitted twice at the same moment, keeps the salary figures, and refuses others", async () => {
    const e = await recordSalaryPayment(finance, input(), true);
    await decideExpense(admin, e.id, "APPROVED", null);
    const before = await db.expense.findUniqueOrThrow({ where: { id: e.id } });
    for (const who of [manager, operations, auditor]) await expect(markExpensePaid(who, e.id, "MPESA", "X")).rejects.toThrow(/permission/);
    const both = await Promise.allSettled([markExpensePaid(finance, e.id, "MPESA", "QX2", { paidDate: today }), markExpensePaid(admin, e.id, "MPESA", "QX2", { paidDate: today })]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(both.find((r) => r.status === "rejected")).toMatchObject({ reason: expect.objectContaining({ message: "This salary payment has already been marked as paid." }) });
    const paid = await db.expense.findUniqueOrThrow({ where: { id: e.id } });
    expect(paid).toMatchObject({ status: "PAID", paymentMethod: "MPESA", paymentReference: "QX2" });
    expect([paid.staffMemberId, paid.servicePeriodStart, String(paid.salaryGross), String(paid.salaryAllowances), String(paid.salaryDeductions), String(paid.amount)]).toEqual([before.staffMemberId, before.servicePeriodStart, "18000", "2000.5", "1500.25", "18500.25"]);
    expect(await db.auditEvent.count({ where: { entityId: e.id, action: "salary.pay" } })).toBe(1);
    expect(await db.payment.count()).toBe(0); // a salary payment is an expense; no tenant payment is created

    const rejected = await recordSalaryPayment(finance, input({ month: thisMonth }), true);
    await decideExpense(admin, rejected.id, "REJECTED", "Wrong month");
    await expect(markExpensePaid(finance, rejected.id, "MPESA", "X")).rejects.toThrow(/Only an approved salary payment/);
    expect((await db.expense.findUniqueOrThrow({ where: { id: rejected.id } })).status).toBe("REJECTED");
  });

  it("requires a reason to reject; approving an own salary payment is one step and changes nothing else (F61)", async () => {
    const e = await recordSalaryPayment(finance, input(), true);
    await expect(decideExpense(admin, e.id, "REJECTED", null)).rejects.toThrow(/reason is required/);
    const before = await db.expense.findUniqueOrThrow({ where: { id: e.id } });
    await decideExpense(finance, e.id, "APPROVED", null); // recorded by Finance, approved by Finance
    const after = await db.expense.findUniqueOrThrow({ where: { id: e.id } });
    // Only the decision changes: staff member, month, gross, deductions, net and payment fields stay as they were.
    const fixed = (x: typeof before) => ({ ...x, status: null, decidedById: null, decidedAt: null, updatedAt: null });
    expect(fixed(after)).toEqual(fixed(before));
    expect(after).toMatchObject({ status: "APPROVED", decidedById: finance.id, decisionReason: null, paidAt: null, paidDate: null, paymentMethod: null, paymentReference: null });
    expect(await db.auditEvent.findFirstOrThrow({ where: { entityId: e.id, action: "expense.approve" } })).toMatchObject({ before: { status: "SUBMITTED" }, after: expect.objectContaining({ status: "APPROVED", ownRecord: true }) });
    await expect(decideExpense(admin, e.id, "APPROVED", null)).rejects.toThrow(/already been approved/);
    await expect(decideExpense(manager, e.id, "APPROVED", null)).rejects.toThrow(/permission/);
    expect(await db.auditEvent.count({ where: { entityId: e.id, action: "expense.approve" } })).toBe(1);
  });
});

describe("financial totals count each salary once", () => {
  it("includes approved and paid salaries in expenses, shown separately, never drafts, pending or rejected ones", async () => {
    const peter = (await saveStaff(admin, null, { fullName: "Peter", position: "Guard", phone: null, salaryAmount: null, startDate: null, endDate: null, notes: null })).id;
    const rose = (await saveStaff(admin, null, { fullName: "Rose", position: "Gardener", phone: null, salaryAmount: null, startDate: null, endDate: null, notes: null })).id;
    const paid = await recordSalaryPayment(finance, input({ month: thisMonth, allowances: 0, deductions: 0 }), true); // 18,000
    await decideExpense(admin, paid.id, "APPROVED", null);
    await markExpensePaid(finance, paid.id, "BANK", "TRX-1");
    const approved = await recordSalaryPayment(finance, input({ staffMemberId: peter, month: thisMonth, gross: 2000000, allowances: 0, deductions: 0 }), true); // 20,000
    await decideExpense(admin, approved.id, "APPROVED", null);
    await recordSalaryPayment(finance, input({ staffMemberId: rose, month: thisMonth, gross: 1500000, allowances: 0, deductions: 0 }), true); // pending
    const rejected = await recordSalaryPayment(finance, input({ month: lastMonth, allowances: 0, deductions: 0 }), true);
    await decideExpense(admin, rejected.id, "REJECTED", "Duplicate");

    const m = (await dashboard(finance, "month")).money!;
    expect(m.expenses).toBe(3800000);
    expect(m.salaries).toBe(3800000);
    expect(m.expensesByStatus).toEqual({ awaiting: 1500000, approved: 3800000, rejected: 0 }); // rejected one belongs to last month

    const report = await expenseReport(finance, thisMonth, today);
    expect(report).toMatchObject({ salaries: 3800000, runningCosts: 0, total: 3800000 });
    expect(report.rows.filter((r) => r.category === "SALARIES")).toHaveLength(2);

    const list = await listSalaryPayments(finance, { month: thisMonth });
    expect(list.totals).toEqual({ draft: 0, pending: 1500000, approvedUnpaid: 2000000, paid: 1800000, rejected: 0 });
    expect((await listSalaryPayments(finance, { status: "REJECTED" })).rows).toHaveLength(1);
    const overview = await salaryOverview(finance, thisMonth);
    expect(overview.rows.find((r) => r.fullName === "Mary Wairimu")).toMatchObject({ agreedSalary: 1800000, record: { status: "PAID" }, lastPaidMonth: thisMonth });
    expect(overview.notRecorded).toBe(0);
  });
});

describe("deleting a salary record", () => {
  it("deletes only a draft (audited); anything submitted, approved, paid or rejected is kept", async () => {
    const draft = await recordSalaryPayment(finance, input({ month: thisMonth }), false);
    await expect(deleteSalaryDraft(manager, draft.id)).rejects.toBeInstanceOf(PermissionError);
    await deleteSalaryDraft(finance, draft.id);
    expect(await db.expense.count({ where: { id: draft.id } })).toBe(0);
    expect(await db.auditEvent.findFirstOrThrow({ where: { entityId: draft.id, action: "salary.draft_delete" } })).toMatchObject({ actorId: finance.id });

    const submitted = await recordSalaryPayment(finance, input(), true);
    await expect(deleteSalaryDraft(finance, submitted.id)).rejects.toThrow(/Only a draft salary payment can be deleted/);
    await decideExpense(admin, submitted.id, "APPROVED", null);
    await markExpensePaid(finance, submitted.id, "BANK", "TRX-DEL");
    await expect(deleteSalaryDraft(finance, submitted.id)).rejects.toThrow(/Only a draft/);
    await expect(db.expense.delete({ where: { id: submitted.id } })).rejects.toThrow(/cannot be deleted once submitted/); // the database refuses too
    expect((await db.expense.findUniqueOrThrow({ where: { id: submitted.id } })).status).toBe("PAID");
  });

  it("keeps a draft that has documents attached", async () => {
    const doc = await stageUpload(finance, { ownerType: "EXPENSE", category: "OTHER", fileName: "sheet.pdf", bytes: PDF });
    const draft = await recordSalaryPayment(finance, input({ month: thisMonth }), false, { documentIds: [doc.id] });
    await expect(deleteSalaryDraft(finance, draft.id)).rejects.toThrow(/documents attached/);
    expect(await db.expense.count({ where: { id: draft.id } })).toBe(1);
  });

  it("does not rewrite recorded salaries when the agreed salary changes", async () => {
    const paid = await recordSalaryPayment(finance, input(), true);
    await decideExpense(admin, paid.id, "APPROVED", null);
    await markExpensePaid(finance, paid.id, "BANK", "TRX-KEEP");
    await saveStaff(admin, maryId, { fullName: "Mary Wairimu", position: "Cleaner", phone: null, salaryAmount: 2500000, startDate: "2025-01-01", endDate: null, notes: null });
    const after = await db.expense.findUniqueOrThrow({ where: { id: paid.id } });
    expect([String(after.salaryGross), String(after.amount), after.status]).toEqual(["18000", "18500.25", "PAID"]);
  });
});

describe("salary privacy", () => {
  it("refuses salary operations and details to roles without salary access, on the server", async () => {
    const e = await recordSalaryPayment(finance, input(), true);
    for (const who of [manager, operations, auditor]) {
      await expect(recordSalaryPayment(who, input({ month: thisMonth }), true)).rejects.toBeInstanceOf(PermissionError);
      await expect(listSalaryPayments(who)).rejects.toBeInstanceOf(PermissionError);
      await expect(getSalaryPayment(who, e.id)).rejects.toBeInstanceOf(PermissionError);
      await expect(salaryOverview(who, thisMonth)).rejects.toBeInstanceOf(PermissionError);
    }
    expect((await listExpenses(manager)).some((x) => x.category === "SALARIES")).toBe(false);
    expect((await dashboard(manager, "12m")).money?.salaries).toBeNull();
    await expect(decideExpense(manager, e.id, "APPROVED", null)).rejects.toBeInstanceOf(PermissionError);
  });

  it("keeps salary proof private and redacts salary details from the audit log for the auditor", async () => {
    const proof = await stageUpload(finance, { ownerType: "EXPENSE", category: "OTHER", fileName: "payslip.pdf", bytes: PDF });
    const e = await recordSalaryPayment(finance, input({ notes: "Mary October pay" }), true, { documentIds: [proof.id] });
    expect(await documentForDownload(manager, proof.id)).toBeNull();
    expect(await documentForDownload(finance, proof.id)).not.toBeNull();

    const forAuditor = (await listAuditEvents(auditor, { entityType: "Expense" })).events.filter((x) => x.entityId === e.id);
    expect(forAuditor.map((x) => x.action).sort()).toEqual(["document.attach", "salary.submit"]);
    for (const x of forAuditor) expect(x).toMatchObject({ summary: expect.stringMatching(/details restricted/), before: null, after: null, reason: null });
    expect((await listAuditEvents(auditor, { q: "Mary" })).events.some((x) => x.entityId === e.id)).toBe(false);
    const forAdmin = (await listAuditEvents(admin, { entityType: "Expense" })).events.find((x) => x.entityId === e.id && x.action === "salary.submit")!;
    expect(forAdmin.summary).toMatch(/Mary Wairimu/);
  });
});

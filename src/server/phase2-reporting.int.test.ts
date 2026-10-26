// Financial clarity: costs approved (by service month) vs money paid out (by payment date),
// reversals on their own date, database protection of decided expenses, the Documents index and
// the credit-note view.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { PermissionError } from "@/server/auth/actor";
import { createAgreement, createParty, createUnit } from "@/server/services/property";
import { issueBilling } from "@/server/services/billing";
import { createCreditNote, listCreditNotes, recordPayment, reversePayment, verifyPayment } from "@/server/services/finance";
import { createExpense, decideExpense, listExpenses, markExpensePaid, saveStaff, updateDraftExpense, type ExpenseInput } from "@/server/services/operations";
import { recordSalaryPayment, updateSalaryPayment } from "@/server/services/salaries";
import { collectionsReport, dashboard, expenseReport, financeLedger } from "@/server/services/reports";
import { addDocuments, removeDocument, searchDocuments, stageUpload } from "@/server/services/documents";
import { addMonths, monthEnd, monthStart, todayISO } from "@/lib/dates";

assertTestDatabase();

const admin = actor("ADMIN");
const manager = actor("MANAGER");
const finance = actor("FINANCE");
const operations = actor("OPERATIONS");
const auditor = actor("AUDITOR");
const today = todayISO();
const thisMonth = monthStart(today);
const lastMonth = addMonths(thisMonth, -1);
const PDF = new TextEncoder().encode("%PDF-1.4\n% test\n%%EOF\n");

const expense = (over: Partial<ExpenseInput> = {}): ExpenseInput => ({
  category: "WATER", payee: "Nairobi Water", description: "Water bill", amount: 1000000, servicePeriodStart: lastMonth, servicePeriodEnd: monthEnd(lastMonth),
  costCentre: null, evidenceNote: null, workOrderId: null, staffMemberId: null, ...over,
});

async function tenant() {
  const unit = await createUnit(admin, { unitNumber: "A-1", floor: null, unitType: null, notes: null });
  const party = await createParty(admin, { displayName: "Tenant One", phone: null, email: null, idNumber: null, notes: null });
  await createAgreement(manager, { type: "RENTAL", unitId: unit.id, partyId: party.id, reference: null, startDate: addMonths(thisMonth, -2), endDate: null, rentAmount: 2500000, managementFeeAmount: null, dueDay: 5, graceDays: null, purchaseDate: null, ownershipEvidence: null, lateFeeTerms: null, allocationTerms: null, notes: null });
  return { unit, party };
}

beforeEach(async () => {
  await resetTestData();
  await db.building.create({ data: { name: "Phase 2 Building" } });
});

describe("costs approved vs money paid out", () => {
  it("counts a cost in its service month and the payment on the day it was paid", async () => {
    const e = await createExpense(operations, expense(), true); // service month: last month
    await decideExpense(finance, e.id, "APPROVED", null);
    const approvedOnly = await dashboard(finance, "last-month");
    expect(approvedOnly.money).toMatchObject({ expenses: 1000000, expensesApprovedUnpaid: 1000000, expensesPaid: 0 }); // approved is not paid

    await markExpensePaid(finance, e.id, "BANK", "TRX-1", { paidDate: today }); // paid this month
    const last = (await dashboard(finance, "last-month")).money!;
    const now = (await dashboard(finance, "month")).money!;
    expect(last).toMatchObject({ expenses: 1000000, expensesApprovedUnpaid: 0, expensesPaid: 0 });
    expect(now).toMatchObject({ expenses: 0, expensesApprovedUnpaid: 0, expensesPaid: 1000000 });
    expect(now.monthly.find((m) => m.month === thisMonth)).toMatchObject({ expenses: 0, paidOut: 1000000 });
    expect(now.monthly.find((m) => m.month === lastMonth)).toMatchObject({ expenses: 1000000, paidOut: 0 });

    // The expense report uses the same service month, and shows money paid out separately.
    expect(await expenseReport(finance, lastMonth, monthEnd(lastMonth))).toMatchObject({ total: 1000000, paidInPeriod: 0 });
    const reportNow = await expenseReport(finance, thisMonth, today);
    expect(reportNow).toMatchObject({ total: 0, paidInPeriod: 1000000 });
    const [row] = (await expenseReport(finance, lastMonth, monthEnd(lastMonth))).rows;
    expect(row).toMatchObject({ date: lastMonth, recordedDate: today, paidDate: today });

    // The dashboard links open the same records.
    expect((await listExpenses(finance, { status: "PAID", basis: "paid", from: thisMonth, to: today })).map((x) => x.id)).toEqual([e.id]);
    expect(await listExpenses(finance, { status: "COSTS", basis: "service", from: thisMonth, to: today })).toEqual([]);
    expect((await listExpenses(finance, { status: "COSTS", basis: "service", from: lastMonth, to: monthEnd(lastMonth) })).map((x) => x.id)).toEqual([e.id]);
  });

  it("separates salaries approved and salaries paid, and hides both from roles without salary access", async () => {
    const guard = await saveStaff(admin, null, { fullName: "Guard", position: "Guard", phone: null, salaryAmount: null, startDate: null, endDate: null, notes: null });
    const cleaner = await saveStaff(admin, null, { fullName: "Cleaner", position: "Cleaner", phone: null, salaryAmount: null, startDate: null, endDate: null, notes: null });
    const a = await recordSalaryPayment(finance, { staffMemberId: guard.id, month: thisMonth, gross: 2000000, allowances: 0, deductions: 0, notes: null, evidenceNote: null }, true);
    const b = await recordSalaryPayment(finance, { staffMemberId: cleaner.id, month: thisMonth, gross: 1500000, allowances: 0, deductions: 0, notes: null, evidenceNote: null }, true);
    await decideExpense(admin, a.id, "APPROVED", null);
    await decideExpense(admin, b.id, "APPROVED", null);
    await markExpensePaid(finance, b.id, "MPESA", "SAL-1", { paidDate: today });
    const m = (await dashboard(finance, "month")).money!;
    expect(m).toMatchObject({ salaries: 3500000, salariesApprovedUnpaid: 2000000, salariesPaid: 1500000, expensesApprovedUnpaid: 2000000, expensesPaid: 1500000 });
    const forManager = (await dashboard(manager, "month")).money!;
    expect(forManager).toMatchObject({ salariesApprovedUnpaid: null, salariesPaid: null, expensesPaid: 0, expensesApprovedUnpaid: 0 });
  });
});

describe("reversals on their effective date", () => {
  it("keeps the original receipt in its period and records the reversal when it happened", async () => {
    const { party } = await tenant();
    await issueBilling(finance, lastMonth);
    const p = await recordPayment(manager, { partyId: party.id, method: "MPESA", reference: "REV1", amount: 2500000, receivedDate: `${lastMonth.slice(0, 7)}-10`, evidenceNote: null });
    await verifyPayment(finance, p.id);
    expect((await dashboard(finance, "last-month")).money).toMatchObject({ collected: 2500000, received: 2500000, reversed: 0 });

    await reversePayment(finance, p.id, "Cheque bounced");
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("REVERSED"); // the original record stays
    // Last month still shows the money received then; this month shows the reversal.
    expect((await dashboard(finance, "last-month")).money).toMatchObject({ collected: 2500000, received: 2500000, reversed: 0 });
    expect((await dashboard(finance, "month")).money).toMatchObject({ collected: -2500000, received: 0, reversed: 2500000 });

    const lastReport = await collectionsReport(finance, lastMonth, monthEnd(lastMonth));
    expect(lastReport.rows.map((r) => [r.kind, r.amount, r.reversedLater])).toEqual([["RECEIPT", 2500000, true]]);
    const nowReport = await collectionsReport(finance, thisMonth, today);
    expect(nowReport.rows.map((r) => [r.kind, r.date, r.amount])).toEqual([["REVERSAL", today, -2500000]]);
    expect(nowReport).toMatchObject({ received: 0, reversed: 2500000, total: -2500000 });

    // The same as the amounts owed ledger: received then, reversed now, nothing collected overall.
    const ledger = await financeLedger(finance, lastMonth, today);
    expect(ledger.payments).toBe(2500000);
    expect(ledger.reversals).toBe(2500000);
    expect((await collectionsReport(finance, lastMonth, today)).total).toBe(0);
  });
});

describe("database protection of decided expenses", () => {
  it("refuses any change to a paid or rejected expense and any deletion after submission", async () => {
    const paid = await createExpense(operations, expense(), true);
    await decideExpense(finance, paid.id, "APPROVED", null);
    await markExpensePaid(finance, paid.id, "BANK", "TRX-2", { paidDate: today });
    await expect(db.expense.update({ where: { id: paid.id }, data: { amount: "1.00" } })).rejects.toThrow(/a paid expense cannot be changed/);
    await expect(db.expense.update({ where: { id: paid.id }, data: { status: "APPROVED" } })).rejects.toThrow(/a paid expense cannot be changed/);
    await expect(db.expense.delete({ where: { id: paid.id } })).rejects.toThrow(/cannot be deleted once submitted/);

    const rejected = await createExpense(operations, expense({ payee: "Duplicate bill" }), true);
    await decideExpense(finance, rejected.id, "REJECTED", "Duplicate");
    await expect(db.expense.update({ where: { id: rejected.id }, data: { description: "edited" } })).rejects.toThrow(/a rejected expense cannot be changed/);
    await expect(updateDraftExpense(operations, rejected.id, expense({ payee: "Fixed" }), true)).rejects.toThrow(/Record a corrected copy/);

    const submitted = await createExpense(operations, expense({ payee: "Pending" }), true);
    await expect(db.expense.update({ where: { id: submitted.id }, data: { amount: "5.00" } })).rejects.toThrow(/details of a submitted expense cannot be changed/);
    await expect(db.expense.update({ where: { id: submitted.id }, data: { status: "PAID" } })).rejects.toThrow(/can only be approved or rejected/);
    await decideExpense(finance, submitted.id, "APPROVED", null);
    await expect(db.expense.update({ where: { id: submitted.id }, data: { status: "SUBMITTED" } })).rejects.toThrow(/can only be marked as paid/);
    await expect(db.expense.update({ where: { id: submitted.id }, data: { decisionReason: "changed later" } })).rejects.toThrow(/can only be marked as paid/);

    const draft = await createExpense(operations, expense({ payee: "Draft" }), false);
    await db.expense.update({ where: { id: draft.id }, data: { description: "still a draft" } }); // drafts stay editable
    await db.expense.delete({ where: { id: draft.id } });
    expect(await db.expense.count({ where: { id: draft.id } })).toBe(0);
    expect(await db.expense.findUniqueOrThrow({ where: { id: paid.id } })).toMatchObject({ status: "PAID", paymentReference: "TRX-2" });
  });

  it("protects salary payments the same way; a rejected one is corrected by a new record", async () => {
    const guard = await saveStaff(admin, null, { fullName: "Guard", position: "Guard", phone: null, salaryAmount: null, startDate: null, endDate: null, notes: null });
    const input = { staffMemberId: guard.id, month: thisMonth, gross: 2000000, allowances: 0, deductions: 0, notes: null, evidenceNote: null };
    const first = await recordSalaryPayment(finance, input, true);
    await decideExpense(admin, first.id, "REJECTED", "Wrong month");
    await expect(updateSalaryPayment(finance, first.id, input, true)).rejects.toThrow(/Record a corrected copy/);
    await expect(db.expense.update({ where: { id: first.id }, data: { salaryGross: "1.00", amount: "1.00" } })).rejects.toThrow(/rejected expense cannot be changed/);
    const copy = await recordSalaryPayment(finance, input, true); // the month is free again
    expect(copy.id).not.toBe(first.id);
    expect((await db.expense.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("REJECTED");
  });
});

describe("Documents index", () => {
  it("lists only current documents each role may open, searchable by name, type or record", async () => {
    const { party, unit } = await tenant();
    const stage = async (ownerType: "PARTY" | "UNIT" | "EXPENSE" | "STAFF_MEMBER", category: "ID_DOCUMENT" | "PHOTO" | "RECEIPT" | "OTHER", fileName: string) =>
      stageUpload(admin, { ownerType, category, fileName, bytes: PDF });
    const id = await stage("PARTY", "ID_DOCUMENT", "national-id.pdf");
    await addDocuments(admin, "PARTY", party.id, [id.id]);
    const photo = await stage("UNIT", "PHOTO", "unit-photo.pdf");
    await addDocuments(admin, "UNIT", unit.id, [photo.id]);
    const guard = await saveStaff(admin, null, { fullName: "Guard Person", position: "Guard", phone: null, salaryAmount: null, startDate: null, endDate: null, notes: null });
    const payslip = await stageUpload(finance, { ownerType: "EXPENSE", category: "OTHER", fileName: "payslip.pdf", bytes: PDF }); // staged by the person who records the salary
    await recordSalaryPayment(finance, { staffMemberId: guard.id, month: thisMonth, gross: 100, allowances: 0, deductions: 0, notes: null, evidenceNote: null }, true, { documentIds: [payslip.id] });
    const contract = await stage("STAFF_MEMBER", "OTHER", "contract.pdf");
    await addDocuments(admin, "STAFF_MEMBER", guard.id, [contract.id]);
    const gone = await stage("UNIT", "OTHER", "old-plan.pdf");
    await addDocuments(admin, "UNIT", unit.id, [gone.id]);
    await removeDocument(admin, gone.id, "Replaced");
    await stage("UNIT", "OTHER", "never-attached.pdf"); // staged only

    const names = async (who: typeof admin, filter = {}) => (await searchDocuments(who, filter)).map((d) => d.originalName).sort();
    expect(await names(admin)).toEqual(["contract.pdf", "national-id.pdf", "payslip.pdf", "unit-photo.pdf"]);
    expect(await names(manager)).toEqual(["contract.pdf", "national-id.pdf", "unit-photo.pdf"]); // no salary access
    expect(await names(finance)).toEqual(["national-id.pdf", "payslip.pdf", "unit-photo.pdf"]); // staff files: staff managers only
    expect(await names(operations)).toEqual(["unit-photo.pdf"]); // no accounts, no salaries
    expect(await names(auditor)).toEqual(["unit-photo.pdf"]); // identity documents are sensitive
    expect(await names(admin, { q: "tenant one" })).toEqual(["national-id.pdf"]); // by record
    expect(await names(admin, { q: "photograph" })).toEqual(["unit-photo.pdf"]); // by type
    expect(await names(admin, { ownerType: "EXPENSE" })).toEqual(["payslip.pdf"]);
    const [salaryDoc] = await searchDocuments(admin, { q: "payslip" });
    expect(salaryDoc.record?.href).toMatch(/^\/staff\/salary-payments\//);
  });
});

describe("credit-note view", () => {
  it("lists existing credit notes with their invoice, for invoice viewers only", async () => {
    const { party } = await tenant();
    await issueBilling(finance, lastMonth);
    const inv = await db.invoice.findFirstOrThrow({ where: { partyId: party.id } });
    const cn = await createCreditNote(finance, inv.id, 50000, "Agreed discount");
    const list = await listCreditNotes(manager);
    expect(list).toEqual([expect.objectContaining({ id: cn.id, number: cn.number, amount: 50000, reason: "Agreed discount", date: today, invoice: { id: inv.id, number: inv.number }, unitNumber: "A-1" })]);
    expect(list[0].party.displayName).toBe("Tenant One");
    expect(await listCreditNotes(manager, { q: "discount" })).toHaveLength(1);
    expect(await listCreditNotes(manager, { q: "nothing like this" })).toHaveLength(0);
    expect(await listCreditNotes(manager, { from: addMonths(thisMonth, 1), to: addMonths(thisMonth, 2) })).toHaveLength(0);
    await expect(listCreditNotes(operations)).rejects.toBeInstanceOf(PermissionError);
    expect(await db.creditNote.count()).toBe(1); // listing creates nothing
  });
});

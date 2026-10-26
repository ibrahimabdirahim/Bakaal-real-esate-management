// Full System Administrator authority: one administrator, alone, can complete every workflow,
// including approving or verifying items they created themselves, and never by skipping business or
// financial rules. Own payments and manual invoices still use the audited self-approval exception;
// own expenses and salary payments are approved with one confirmation (F61, like F49), audited as own.
// Other roles keep their own bundles and cannot use the exception.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { PermissionError, type Actor } from "@/server/auth/actor";
import { can, PERMISSIONS, ROLES } from "@/server/auth/permissions";
import { createUser, listAuditEvents } from "@/server/services/admin";
import { approvePolicy, issueBilling, previewBilling, proposePolicy } from "@/server/services/billing";
import {
  allocatePayment,
  createCreditNote,
  createManualInvoice,
  issueManualInvoice,
  partyFinancialSummary,
  recordPayment,
  rejectPayment,
  reversePayment,
  verifyPayment,
  verifyPaymentSelf,
} from "@/server/services/finance";
import { createExpense, createTask, createWorkOrder, decideExpense, decideQuote, markExpensePaid, saveStaff, setStaffSalary, setTaskStatus, updateWorkOrder, type ExpenseInput } from "@/server/services/operations";
import { createAccount, createUnit } from "@/server/services/property";
import { arrearsReport, dashboard, reconciliationCheck } from "@/server/services/reports";
import { addMonths, monthStart, todayISO } from "@/lib/dates";

assertTestDatabase();

const REASON = "Sole administrator; checked against the original documents";
const SELF = { reason: REASON, confirmed: true };
const today = todayISO();
const lastMonth = addMonths(monthStart(today), -1);
const water: ExpenseInput = { category: "WATER", payee: "Nairobi Water", description: "Water bill", amount: 1240000, servicePeriodStart: null, servicePeriodEnd: null, costCentre: null, evidenceNote: "Bill on file", workOrderId: null, staffMemberId: null };

/** Real staff rows, because the exception records how many other active approvers exist. */
async function staff(role: Actor["role"], email: string): Promise<Actor> {
  const u = await db.user.create({ data: { email, name: `${role} ${email}`, role, passwordHash: "x" } });
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

async function tenantWithInvoice(admin: Actor) {
  await db.building.create({ data: { name: "Authority Building" } });
  const unit = await createUnit(admin, { unitNumber: "A-1", floor: null, unitType: null, notes: null });
  const { party } = await createAccount(admin, {
    party: { displayName: "Sole Admin Tenant", phone: "0700 111 222", email: null, idNumber: null, notes: null },
    accountType: "TENANT",
    unitId: unit.id,
    tenancy: { startDate: lastMonth, endDate: null, rentAmount: 2500000, dueDay: 5, graceDays: null, reference: "RA-1", lateFeeTerms: null, allocationTerms: null, notes: null },
    charges: [],
    documents: { account: [], agreement: [], management: [] },
  });
  await issueBilling(admin, lastMonth);
  return { unit, party, invoice: await db.invoice.findFirstOrThrow({ where: { partyId: party.id } }) };
}

beforeEach(async () => {
  await resetTestData();
});

describe("the permission matrix", () => {
  it("gives the System Administrator every permission, and the self-approval exception to no other role", () => {
    for (const p of PERMISSIONS) expect(can("ADMIN", p)).toBe(true);
    for (const role of ROLES.filter((r) => r !== "ADMIN")) expect(can(role, "approvals.self_exception")).toBe(false);
    expect(can("AUDITOR", "payments.verify") || can("OPERATIONS", "payments.verify") || can("MANAGER", "payments.verify")).toBe(false);
    expect(ROLES.filter((r) => can(r, "users.manage"))).toEqual(["ADMIN"]);
  });
});

describe("a sole System Administrator", () => {
  it("completes every financial workflow alone, using the audited exception for their own items", async () => {
    const admin = await staff("ADMIN", "sole.admin@test.local");
    const { unit, party, invoice } = await tenantWithInvoice(admin);

    // Policy: propose and approve (no self-approval rule exists for policies, so none is added).
    const policy = await proposePolicy(admin, { key: "DEFAULT_DUE_DAY", value: "7", effectiveFrom: "2026-01-01", note: null });
    await approvePolicy(admin, policy.id);
    expect((await previewBilling(admin, monthStart(today))).invoices.length).toBe(1);

    // Payment recorded and verified by the same administrator, then allocated.
    const pay = await recordPayment(admin, { partyId: party.id, method: "MPESA", reference: "SOLE1", amount: 2000000, receivedDate: today, evidenceNote: null });
    await expect(verifyPayment(admin, pay.id)).rejects.toThrow(/audited self-approval exception/); // the normal path points to the exception
    await verifyPaymentSelf(admin, pay.id, SELF);
    await allocatePayment(admin, pay.id, [{ invoiceId: invoice.id, amount: 2000000 }]);

    // Correction workflows: reject a wrong record, reverse a bounced payment, credit an invoice.
    const wrong = await recordPayment(admin, { partyId: party.id, method: "CASH", reference: "WRONG1", amount: 500000, receivedDate: today, evidenceNote: null });
    await rejectPayment(admin, wrong.id, "Recorded against the wrong account");
    const bounced = await recordPayment(admin, { partyId: party.id, method: "BANK", reference: "BOUNCE1", amount: 100000, receivedDate: today, evidenceNote: null });
    await verifyPaymentSelf(admin, bounced.id, SELF);
    await reversePayment(admin, bounced.id, "Cheque bounced");
    await createCreditNote(admin, invoice.id, 100000, "Agreed discount");

    // Manual invoice drafted and issued by the same administrator.
    const draft = await createManualInvoice(admin, { partyId: party.id, unitId: unit.id, agreementId: null, notes: null, dueDate: today, lines: [{ category: "OTHER", description: "Key replacement", amount: 150000 }] });
    await expect(issueManualInvoice(admin, draft.id)).rejects.toThrow(/someone other than the person who drafted it.*self-approval exception/);
    const issued = await issueManualInvoice(admin, draft.id, SELF);
    expect(issued).toMatchObject({ status: "ISSUED", issuedById: admin.id, createdById: admin.id });

    // Balances still follow the ledger exactly: 25,000 + 1,500 − 20,000 paid − 1,000 credited.
    expect(await partyFinancialSummary(party.id)).toMatchObject({ invoiceBalances: 550000, unallocated: 0, accountBalance: 550000 });
    expect((await reconciliationCheck(admin)).every((r) => r.matches)).toBe(true);
    expect((await arrearsReport(admin)).grandTotal).toBe(550000);
    expect((await dashboard(admin)).money).not.toBeNull();

    // Every self-approval left its own audit event with the exception named and the reason kept.
    const events = await db.auditEvent.findMany({ where: { actorId: admin.id, action: { endsWith: "_self_exception" } }, orderBy: { occurredAt: "asc" } });
    expect(events.map((e) => e.action)).toEqual(["payment.verify_self_exception", "payment.verify_self_exception", "invoice.issue_self_exception"]);
    for (const e of events) expect(e).toMatchObject({ reason: REASON, after: expect.objectContaining({ exception: "ADMINISTRATOR_SELF_APPROVAL" }) });
    expect(events[2].after).toMatchObject({ createdById: admin.id, issuedById: admin.id, otherActiveIssuers: 0 });
  });

  it("completes operations, staff, expense and administration workflows alone", async () => {
    const admin = await staff("ADMIN", "sole.admin@test.local");
    await db.building.create({ data: { name: "Authority Building" } });

    // Expenses: approve (no reason) and pay own, reject own (with a reason), in one step each (F61).
    const e1 = await createExpense(admin, water, true);
    await decideExpense(admin, e1.id, "APPROVED", null);
    await markExpensePaid(admin, e1.id, "BANK", "TRX-1");
    const e2 = await createExpense(admin, { ...water, payee: "Duplicate bill" }, true);
    await expect(decideExpense(admin, e2.id, "REJECTED", null)).rejects.toThrow(/reason is required/);
    await decideExpense(admin, e2.id, "REJECTED", "Duplicate of an earlier bill");
    expect(await db.expense.findMany({ select: { status: true, decidedById: true }, orderBy: { createdAt: "asc" } })).toEqual([
      { status: "PAID", decidedById: admin.id },
      { status: "REJECTED", decidedById: admin.id },
    ]);
    const expenseEvents = await db.auditEvent.findMany({ where: { entityId: { in: [e1.id, e2.id] }, action: { in: ["expense.approve", "expense.reject"] } }, orderBy: { occurredAt: "asc" } });
    expect(expenseEvents.map((e) => [e.action, e.reason, (e.after as { ownRecord: boolean }).ownRecord])).toEqual([["expense.approve", null, true], ["expense.reject", "Duplicate of an earlier bill", true]]);
    expect(await db.auditEvent.count({ where: { entityId: { in: [e1.id, e2.id] }, action: { endsWith: "_self_exception" } } })).toBe(0);

    // Maintenance with an approved quote, staff with a salary, and tasks.
    const w = await createWorkOrder(admin, { title: "Leak", description: null, unitId: null, location: "Roof", priority: "HIGH", reportedVia: null });
    await updateWorkOrder(admin, w.id, { status: "ASSIGNED", assignee: "Plumber", quoteAmount: 800000, outcome: null, costTreatment: null });
    await decideQuote(admin, w.id, true);
    const member = await saveStaff(admin, null, { fullName: "Caretaker", position: "Caretaker", phone: null, salaryAmount: null, startDate: null, endDate: null, notes: null });
    await setStaffSalary(admin, member.id, 2000000);
    const task = await createTask(admin, { title: "Check pumps", staffMemberId: member.id, dueDate: today, notes: null });
    await setTaskStatus(admin, task.id, "DONE");

    // Administration: staff logins and the audit log.
    await createUser(admin, { email: "new.finance@test.local", name: "New Finance", role: "FINANCE" });
    expect((await listAuditEvents(admin, {})).total).toBeGreaterThan(0);
  });
});

describe("the exception keeps the controls", () => {
  it("approves an own expense with one confirmation and no reason; a refused rejection changes nothing", async () => {
    const admin = await staff("ADMIN", "admin@test.local");
    await db.building.create({ data: { name: "Authority Building" } });
    const e = await createExpense(admin, water, true);
    await expect(decideExpense(admin, e.id, "REJECTED", "  ")).rejects.toThrow(/reason is required/);
    expect((await db.expense.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("SUBMITTED");
    expect(await db.auditEvent.count({ where: { entityId: e.id, action: { startsWith: "expense." }, NOT: { action: "expense.submit" } } })).toBe(0);
    await decideExpense(admin, e.id, "APPROVED", null);
    const after = await db.expense.findUniqueOrThrow({ where: { id: e.id } });
    expect(after).toMatchObject({ status: "APPROVED", decidedById: admin.id, decisionReason: null, paidAt: null, paidDate: null, paymentReference: null });
    const event = await db.auditEvent.findFirstOrThrow({ where: { entityId: e.id, action: "expense.approve" } });
    expect(event).toMatchObject({ actorId: admin.id, before: { status: "SUBMITTED" }, after: expect.objectContaining({ status: "APPROVED", ownRecord: true, createdById: admin.id }) });
  });

  it("decides items someone else created in the same way, audited as not own", async () => {
    const admin = await staff("ADMIN", "admin@test.local");
    const fin = await staff("FINANCE", "finance@test.local");
    await db.building.create({ data: { name: "Authority Building" } });
    const theirs = await createExpense(fin, water, true);
    await decideExpense(admin, theirs.id, "APPROVED", null);
    const event = await db.auditEvent.findFirstOrThrow({ where: { entityId: theirs.id, action: "expense.approve" } });
    expect(event.after).toMatchObject({ ownRecord: false, createdById: fin.id, decidedById: admin.id });
  });

  it("is not available to any other role", async () => {
    const fin = await staff("FINANCE", "finance@test.local");
    const manager = actor("MANAGER");
    await db.building.create({ data: { name: "Authority Building" } });
    // A Finance officer may record and approve, so approves an own expense in one step too (F61); a manager may not approve.
    const own = await createExpense(fin, water, true);
    await expect(decideExpense(manager, own.id, "APPROVED", null)).rejects.toBeInstanceOf(PermissionError);
    expect((await db.expense.findUniqueOrThrow({ where: { id: own.id } })).status).toBe("SUBMITTED");
    await decideExpense(fin, own.id, "APPROVED", null);
    expect((await db.expense.findUniqueOrThrow({ where: { id: own.id } })).status).toBe("APPROVED");

    const admin = await staff("ADMIN", "admin@test.local");
    const { unit, party } = await (async () => {
      const u = await createUnit(admin, { unitNumber: "B-1", floor: null, unitType: null, notes: null });
      const p = await db.party.create({ data: { displayName: "Other Tenant" } });
      // A manual invoice needs an agreement between the account and the unit.
      await db.agreement.create({ data: { buildingId: u.buildingId, unitId: u.id, partyId: p.id, type: "RENTAL", startDate: new Date("2026-01-01T00:00:00Z"), rentAmount: "1000.00", dueDay: 5 } });
      return { unit: u, party: p };
    })();
    const draft = await createManualInvoice(fin, { partyId: party.id, unitId: unit.id, agreementId: null, notes: null, dueDate: today, lines: [{ category: "OTHER", description: "x", amount: 100 }] });
    await expect(issueManualInvoice(fin, draft.id, SELF)).rejects.toThrow(/Only a System Administrator/);
    const pay = await recordPayment(fin, { partyId: party.id, method: "CASH", reference: "FIN1", amount: 100, receivedDate: today, evidenceNote: null });
    await expect(verifyPaymentSelf(fin, pay.id, SELF)).rejects.toThrow(/Only a System Administrator/);
    expect(await db.auditEvent.count({ where: { action: { endsWith: "_self_exception" }, actorId: fin.id } })).toBe(0);
  });

  it("never lets the administrator skip financial state rules", async () => {
    const admin = await staff("ADMIN", "admin@test.local");
    const { party, invoice } = await tenantWithInvoice(admin);
    const p = await recordPayment(admin, { partyId: party.id, method: "MPESA", reference: "RULES1", amount: 1000000, receivedDate: today, evidenceNote: null });
    await expect(allocatePayment(admin, p.id, [{ invoiceId: invoice.id, amount: 1000000 }])).rejects.toThrow(/verified/); // pending money cannot pay invoices
    await rejectPayment(admin, p.id, "Not on the statement");
    await expect(verifyPaymentSelf(admin, p.id, SELF)).rejects.toThrow(/already rejected/);
    await expect(reversePayment(admin, p.id, "x")).rejects.toThrow(/Only a verified payment/);

    const q = await recordPayment(admin, { partyId: party.id, method: "MPESA", reference: "RULES2", amount: 3000000, receivedDate: today, evidenceNote: null });
    await verifyPaymentSelf(admin, q.id, SELF);
    await expect(allocatePayment(admin, q.id, [{ invoiceId: invoice.id, amount: 2500001 }])).rejects.toThrow(/more than/);
    await expect(createCreditNote(admin, invoice.id, 2500001, "Too much")).rejects.toThrow(/cannot exceed/);
    await expect(issueManualInvoice(admin, invoice.id, SELF)).rejects.toThrow(/Only a draft/);

    const e = await createExpense(admin, water, false); // a draft: nothing to approve yet
    await expect(decideExpense(admin, e.id, "APPROVED", null)).rejects.toThrow(/Only a submitted expense/);
    await expect(markExpensePaid(admin, e.id, "BANK", "TRX")).rejects.toThrow(/Only an approved expense/);
  });
});

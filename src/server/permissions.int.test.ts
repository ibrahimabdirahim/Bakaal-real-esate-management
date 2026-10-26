// Server-side permission matrix: every function that changes data, called directly as each
// role (as a forged request would), must refuse exactly the roles without the permission.
// Hiding buttons is not tested here; the services themselves are.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { PermissionError, type Actor } from "@/server/auth/actor";
import { can, ROLES, type Permission } from "@/server/auth/permissions";
import * as admin from "@/server/services/admin";
import * as billing from "@/server/services/billing";
import * as finance from "@/server/services/finance";
import * as ops from "@/server/services/operations";
import * as property from "@/server/services/property";
import * as reports from "@/server/services/reports";
import * as salaries from "@/server/services/salaries";

assertTestDatabase();

const NONE = "does-not-exist";
const party = { displayName: "Matrix", phone: null, email: null, idNumber: null, notes: null };
const unit = { unitNumber: "M-1", floor: null, unitType: null, notes: null };
const expense = { category: "WATER" as const, payee: "x", description: "x", amount: 100, servicePeriodStart: null, servicePeriodEnd: null, costCentre: null, evidenceNote: null, workOrderId: null, staffMemberId: null };

/** [label, required permission, call]. Calls use harmless or non-existent targets. */
const CASES: [string, Permission, (a: Actor) => Promise<unknown>][] = [
  ["createUser", "users.manage", (a) => admin.createUser(a, { email: `${a.role.toLowerCase()}@matrix.test`, name: "x", role: "AUDITOR" })],
  ["updateUser", "users.manage", (a) => admin.updateUser(a, NONE, { name: "x", role: "AUDITOR", isActive: true })],
  ["resetUserPassword", "users.manage", (a) => admin.resetUserPassword(a, NONE)],
  ["saveBuilding", "settings.manage", (a) => admin.saveBuilding(a, { name: "Matrix Building", address: null })],
  ["listAuditEvents", "audit.view", (a) => admin.listAuditEvents(a, {})],
  ["issueBilling", "billing.issue", (a) => billing.issueBilling(a, "2020-01-01")],
  ["previewBilling", "billing.preview", (a) => billing.previewBilling(a, "2020-01-01")],
  ["proposePolicy", "settings.manage", (a) => billing.proposePolicy(a, { key: "DEFAULT_DUE_DAY", value: "5", effectiveFrom: "2020-01-01", note: null })],
  ["approvePolicy", "policies.approve", (a) => billing.approvePolicy(a, NONE)],
  ["createManualInvoice", "invoices.create_manual", (a) => finance.createManualInvoice(a, { partyId: NONE, unitId: NONE, agreementId: null, notes: null, dueDate: "2020-01-01", lines: [] })],
  ["issueManualInvoice", "invoices.issue_manual", (a) => finance.issueManualInvoice(a, NONE)],
  ["discardDraftInvoice", "invoices.create_manual", (a) => finance.discardDraftInvoice(a, NONE, "x")],
  ["createCreditNote", "credits.create", (a) => finance.createCreditNote(a, NONE, 100, "x")],
  ["recordPayment", "payments.record", (a) => finance.recordPayment(a, { partyId: NONE, method: "CASH", reference: "M1", amount: 100, receivedDate: "2020-01-01", evidenceNote: null })],
  ["verifyPayment", "payments.verify", (a) => finance.verifyPayment(a, NONE)],
  ["rejectPayment", "payments.verify", (a) => finance.rejectPayment(a, NONE, "x")],
  ["verifyPaymentSelf", "payments.verify", (a) => finance.verifyPaymentSelf(a, NONE, { reason: "Sole administrator check", confirmed: true })],
  ["allocatePayment", "payments.allocate", (a) => finance.allocatePayment(a, NONE, [])],
  ["reversePayment", "payments.reverse", (a) => finance.reversePayment(a, NONE, "x")],
  ["listInvoices", "invoices.view", (a) => finance.listInvoices(a)],
  ["listPayments", "payments.view", (a) => finance.listPayments(a)],
  ["createExpense", "expenses.submit", (a) => ops.createExpense(a, expense, false)],
  ["updateDraftExpense", "expenses.submit", (a) => ops.updateDraftExpense(a, NONE, expense, false)],
  ["decideExpense", "expenses.approve", (a) => ops.decideExpense(a, NONE, "APPROVED", null)],
  ["markExpensePaid", "expenses.pay", (a) => ops.markExpensePaid(a, NONE, "CASH", "x")],
  ["saveStaff", "staff.manage", (a) => ops.saveStaff(a, NONE, { fullName: "x", position: "x", phone: null, notes: null, isActive: true } as never)],
  ["setStaffSalary", "salary.manage", (a) => ops.setStaffSalary(a, NONE, 100)],
  ["createTask", "tasks.manage", (a) => ops.createTask(a, { title: "x", staffMemberId: null, dueDate: null, notes: null })],
  ["setTaskStatus", "tasks.manage", (a) => ops.setTaskStatus(a, NONE, "DONE")],
  ["createWorkOrder", "workorders.manage", (a) => ops.createWorkOrder(a, { title: "x", description: null, unitId: null, location: "Roof", priority: "LOW", reportedVia: null } as never)],
  ["updateWorkOrder", "workorders.manage", (a) => ops.updateWorkOrder(a, NONE, { status: "OPEN", assignee: null, quoteAmount: null, outcome: null, costTreatment: null } as never)],
  ["decideQuote", "workorders.approve_quote", (a) => ops.decideQuote(a, NONE, true)],
  ["createUnit", "units.manage", (a) => property.createUnit(a, { ...unit, unitNumber: `M-${a.role}` })],
  ["updateUnit", "units.manage", (a) => property.updateUnit(a, NONE, { ...unit, isActive: true })],
  ["createParty", "accounts.manage", (a) => property.createParty(a, { ...party, displayName: `Matrix ${a.role}` })],
  ["updateParty", "accounts.manage", (a) => property.updateParty(a, NONE, party)],
  ["archiveParty", "accounts.manage", (a) => property.archiveParty(a, NONE, "x")],
  ["deleteParty", "accounts.delete", (a) => property.deleteParty(a, NONE)],
  ["createAgreement", "agreements.manage", (a) => property.createAgreement(a, { type: "RENTAL", unitId: NONE, partyId: NONE, reference: null, startDate: "2020-01-01", endDate: null, rentAmount: 100, managementFeeAmount: null, dueDay: 1, graceDays: null, purchaseDate: null, ownershipEvidence: null, lateFeeTerms: null, allocationTerms: null, notes: null })],
  ["endAgreement", "agreements.manage", (a) => property.endAgreement(a, NONE, "2020-01-01", "x")],
  ["cancelAgreement", "agreements.manage", (a) => property.cancelAgreement(a, NONE, "x")],
  ["endAgreementCharge", "agreements.manage", (a) => property.endAgreementCharge(a, NONE, "2020-01-01")],
  ["getParty", "accounts.view", (a) => property.getParty(a, NONE)],
  ["rentRoll", "reports.financial", (a) => reports.rentRoll(a, "2020-01-01")],
  ["occupancyReport", "reports.operational", (a) => reports.occupancyReport(a, "2020-01-01")],
  ["reconciliationCheck", "reports.financial", (a) => reports.reconciliationCheck(a)],
  ["recordSalaryPayment", "salary.manage", (a) => salaries.recordSalaryPayment(a, { staffMemberId: NONE, month: "2020-01-01", gross: 100, allowances: 0, deductions: 0, notes: null, evidenceNote: null }, true)],
  ["updateSalaryPayment", "salary.manage", (a) => salaries.updateSalaryPayment(a, NONE, { staffMemberId: NONE, month: "2020-01-01", gross: 100, allowances: 0, deductions: 0, notes: null, evidenceNote: null }, true)],
  ["listSalaryPayments", "salary.view", (a) => salaries.listSalaryPayments(a)],
  ["getSalaryPayment", "salary.view", (a) => salaries.getSalaryPayment(a, NONE)],
  ["salaryOverview", "salary.view", (a) => salaries.salaryOverview(a, "2020-01-01")],
  ["deleteSalaryDraft", "salary.manage", (a) => salaries.deleteSalaryDraft(a, NONE)],
];

describe("server-side permission matrix", () => {
  beforeEach(async () => {
    await resetTestData();
    await db.building.create({ data: { name: "Matrix Building" } });
  });

  it.each(ROLES)("%s: refused exactly where the role lacks the permission", async (role) => {
    const a = actor(role);
    const mismatches: string[] = [];
    for (const [label, permission, call] of CASES) {
      const outcome = await call(a).then(
        () => "ok",
        (e: unknown) => (e instanceof PermissionError ? "denied" : "other-error"),
      );
      const expected = can(role, permission) ? "allowed" : "denied";
      if (expected === "denied" && outcome !== "denied") mismatches.push(`${label}: should be denied, got ${outcome}`);
      if (expected === "allowed" && outcome === "denied") mismatches.push(`${label}: should be allowed, was denied`);
    }
    expect(mismatches).toEqual([]);
  });

  it("a read-only auditor cannot change anything", async () => {
    const before = await Promise.all([db.party.count(), db.unit.count(), db.user.count(), db.expense.count(), db.workOrder.count()]);
    for (const [, , call] of CASES) await call(actor("AUDITOR")).catch(() => undefined);
    expect(await Promise.all([db.party.count(), db.unit.count(), db.user.count(), db.expense.count(), db.workOrder.count()])).toEqual(before);
  });
});

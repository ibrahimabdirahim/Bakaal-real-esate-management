import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { addAgreementCharge, createAgreement, createParty, createUnit, endAgreement, type AgreementInput } from "@/server/services/property";
import { approvePolicy, issueBilling, previewBilling, proposePolicy } from "@/server/services/billing";
import {
  allocatePayment,
  createCreditNote,
  createManualInvoice,
  getInvoice,
  issueManualInvoice,
  openInvoicesForParty,
  partyFinancialSummary,
  recordPayment,
  rejectPayment,
  reversePayment,
  verifyPayment,
} from "@/server/services/finance";
import { createExpense, decideExpense, saveStaff } from "@/server/services/operations";
import { recordSalaryPayment } from "@/server/services/salaries";
import { accountStatement, reconciliationCheck, recentActivity } from "@/server/services/reports";

assertTestDatabase();

const admin = actor("ADMIN");
const manager = actor("MANAGER");
const finance = actor("FINANCE");
const finance2 = actor("FINANCE", "finance-2");
const operations = actor("OPERATIONS");

const agreementDefaults: Omit<AgreementInput, "type" | "unitId" | "partyId"> = {
  reference: null, startDate: "2026-01-01", endDate: null, rentAmount: null, managementFeeAmount: null,
  dueDay: 5, graceDays: null, purchaseDate: null, ownershipEvidence: null, lateFeeTerms: null, allocationTerms: null, notes: null,
};

async function setup() {
  await db.building.create({ data: { name: "Test Building" } });
  const u1 = await createUnit(admin, { unitNumber: "A-101", floor: "1", unitType: "2 Bedroom", notes: null });
  const u2 = await createUnit(admin, { unitNumber: "A-102", floor: "1", unitType: "2 Bedroom", notes: null });
  await createUnit(admin, { unitNumber: "A-103", floor: "1", unitType: "1 Bedroom", notes: null }); // vacant
  const tenant = await createParty(admin, { displayName: "Tenant One", phone: null, email: null, idNumber: "12345678", notes: null });
  const owner = await createParty(admin, { displayName: "Owner Two", phone: null, email: null, idNumber: null, notes: null });
  const rental = await createAgreement(manager, { ...agreementDefaults, type: "RENTAL", unitId: u1.id, partyId: tenant.id, rentAmount: 2500000 });
  await createAgreement(manager, { ...agreementDefaults, type: "OWNERSHIP", unitId: u2.id, partyId: owner.id, dueDay: null, ownershipEvidence: "Sale agreement SA-1" });
  return { u1, u2, tenant, owner, rental };
}

describe("financial workflows against PostgreSQL", () => {
  beforeEach(async () => {
    await resetTestData();
  });

  it("bills only eligible accounts and never duplicates a month", async () => {
    const { tenant } = await setup();
    const preview = await previewBilling(finance, "2026-09-01");
    expect(preview.invoices).toHaveLength(1); // owner has no approved charges; vacant unit has no agreement
    expect(preview.invoices[0]).toMatchObject({ partyId: tenant.id, total: 2500000, dueDate: "2026-09-05" });
    expect(preview.nothingToBill).toHaveLength(1);

    await issueBilling(finance, "2026-09-01");
    await expect(issueBilling(finance, "2026-09-01")).rejects.toThrow(/nothing new to invoice/);
    expect(await db.invoice.count()).toBe(1);

    const again = await previewBilling(finance, "2026-09-01");
    expect(again.exceptions.map((e) => e.code)).toEqual(["ALREADY_INVOICED"]);
  });

  it("rejects billing the same recurring charge twice for a month at the database level (F65)", async () => {
    const { rental, tenant, u1 } = await setup();
    await issueBilling(finance, "2026-09-01");
    // A second invoice for the agreement and month may exist (charge types billed separately) …
    const second = await db.invoice.create({
      data: {
        buildingId: (await db.building.findFirstOrThrow()).id, partyId: tenant.id, unitId: u1.id, agreementId: rental.id,
        kind: "RECURRING", periodStart: new Date("2026-09-01T00:00:00Z"), total: "1.00",
      },
    });
    // … but the rent already billed for September cannot be recorded as billed again.
    await expect(
      db.billedCharge.create({
        data: { agreementId: rental.id, periodStart: new Date("2026-09-01T00:00:00Z"), category: "RENT", sourceType: "AGREEMENT_RENT", sourceId: rental.id, invoiceId: second.id, amount: "1.00" },
      }),
    ).rejects.toThrow();
  });

  it("refuses to bill future months and flags agreements without a due date", async () => {
    const { u1 } = await setup();
    await expect(previewBilling(finance, "2099-01-01")).rejects.toThrow(/Future months/);
    const p = await createParty(admin, { displayName: "No Due Day", phone: null, email: null, idNumber: null, notes: null });
    await endAgreement(manager, (await db.agreement.findFirstOrThrow({ where: { unitId: u1.id } })).id, "2026-08-31", "moved out");
    await createAgreement(manager, { ...agreementDefaults, type: "RENTAL", unitId: u1.id, partyId: p.id, startDate: "2026-09-01", rentAmount: 1000000, dueDay: null });
    const preview = await previewBilling(finance, "2026-09-01");
    expect(preview.exceptions.map((e) => e.code)).toContain("NO_DUE_DATE");
  });

  it("uses a building due-day policy only after it is approved", async () => {
    const { u1 } = await setup();
    const p = await createParty(admin, { displayName: "Policy Tenant", phone: null, email: null, idNumber: null, notes: null });
    await endAgreement(manager, (await db.agreement.findFirstOrThrow({ where: { unitId: u1.id } })).id, "2026-08-31", "moved out");
    await createAgreement(manager, { ...agreementDefaults, type: "RENTAL", unitId: u1.id, partyId: p.id, startDate: "2026-09-01", rentAmount: 1000000, dueDay: null });
    const policy = await proposePolicy(admin, { key: "DEFAULT_DUE_DAY", value: "7", effectiveFrom: "2026-01-01", note: null });
    expect((await previewBilling(finance, "2026-09-01")).invoices).toHaveLength(0);
    await approvePolicy(admin, policy.id);
    const preview = await previewBilling(finance, "2026-09-01");
    expect(preview.invoices[0]).toMatchObject({ dueDate: "2026-09-07", dueDateSource: "BUILDING_POLICY" });
  });

  it("prevents overlapping agreements and rent on purchased units", async () => {
    const { u1, u2, tenant, owner } = await setup();
    await expect(createAgreement(manager, { ...agreementDefaults, type: "RENTAL", unitId: u1.id, partyId: tenant.id, startDate: "2026-06-01", rentAmount: 100 })).rejects.toThrow(/already has an agreement/);
    await expect(createAgreement(manager, { ...agreementDefaults, type: "OWNERSHIP", unitId: u2.id, partyId: owner.id, rentAmount: 100, ownershipEvidence: "x" })).rejects.toThrow(/not charged rent/);
  });

  it("only lets a verified payment change balances, verified by a second person", async () => {
    const { tenant } = await setup();
    await issueBilling(finance, "2026-09-01");
    const inv = await db.invoice.findFirstOrThrow();

    const pay = await recordPayment(manager, { partyId: tenant.id, method: "MPESA", reference: "qwe123", amount: 1000000, receivedDate: "2026-09-10", evidenceNote: null });
    expect((await partyFinancialSummary(tenant.id)).accountBalance).toBe(2500000);
    await expect(allocatePayment(finance, pay.id, [{ invoiceId: inv.id, amount: 1000000 }])).rejects.toThrow(/verified/);
    await expect(recordPayment(manager, { partyId: tenant.id, method: "MPESA", reference: "QWE123", amount: 5, receivedDate: "2026-09-10", evidenceNote: null })).rejects.toThrow(/already been recorded/);

    const selfRecorded = await recordPayment(finance, { partyId: tenant.id, method: "CASH", reference: "RB-1", amount: 100, receivedDate: "2026-09-10", evidenceNote: null });
    await expect(verifyPayment(finance, selfRecorded.id)).rejects.toThrow(/someone other/);
    await expect(verifyPayment(operations, pay.id)).rejects.toThrow(/permission/);

    const verified = await verifyPayment(finance, pay.id);
    expect(verified.receiptNumber).toMatch(/^RCT-\d{4}-000001$/);
    expect((await partyFinancialSummary(tenant.id)).accountBalance).toBe(1500000);

    await expect(allocatePayment(finance, pay.id, [{ invoiceId: inv.id, amount: 1000001 }])).rejects.toThrow(/unallocated/);
    await allocatePayment(finance, pay.id, [{ invoiceId: inv.id, amount: 600000 }]);
    const s = await partyFinancialSummary(tenant.id);
    expect(s.invoiceBalances).toBe(1900000);
    expect(s.unallocated).toBe(400000);
    expect(s.accountBalance).toBe(1500000);
    expect((await getInvoice(finance, inv.id))!.summary.paymentStatus).toBe("PART_PAID");
  });

  it("cannot over-allocate under concurrent requests", async () => {
    const { tenant } = await setup();
    await issueBilling(finance, "2026-09-01");
    const inv = await db.invoice.findFirstOrThrow();
    const pay = await recordPayment(manager, { partyId: tenant.id, method: "BANK", reference: "TRF-9", amount: 1000000, receivedDate: "2026-09-10", evidenceNote: null });
    await verifyPayment(finance, pay.id);
    const results = await Promise.allSettled([
      allocatePayment(finance, pay.id, [{ invoiceId: inv.id, amount: 700000 }]),
      allocatePayment(finance2, pay.id, [{ invoiceId: inv.id, amount: 700000 }]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const total = await db.paymentAllocation.aggregate({ _sum: { amount: true } });
    expect(String(total._sum.amount)).toBe("7000");
  });

  it("reverses a payment and its allocations without deleting anything", async () => {
    const { tenant } = await setup();
    await issueBilling(finance, "2026-09-01");
    const inv = await db.invoice.findFirstOrThrow();
    const pay = await recordPayment(manager, { partyId: tenant.id, method: "BANK", reference: "TRF-1", amount: 2500000, receivedDate: "2026-09-10", evidenceNote: null });
    await verifyPayment(finance, pay.id);
    await allocatePayment(finance, pay.id, [{ invoiceId: inv.id, amount: 2500000 }]);
    expect((await getInvoice(finance, inv.id))!.summary.balance).toBe(0);

    await reversePayment(finance, pay.id, "Bank transfer returned");
    expect((await getInvoice(finance, inv.id))!.summary.balance).toBe(2500000);
    expect(await db.paymentAllocation.count()).toBe(1);
    expect((await db.payment.findUniqueOrThrow({ where: { id: pay.id } })).status).toBe("REVERSED");
    await expect(db.payment.delete({ where: { id: pay.id } })).rejects.toThrow();
  });

  it("keeps rejected payments out of balances", async () => {
    const { tenant } = await setup();
    await issueBilling(finance, "2026-09-01");
    const pay = await recordPayment(manager, { partyId: tenant.id, method: "MPESA", reference: "FAKE1", amount: 2500000, receivedDate: "2026-09-10", evidenceNote: "screenshot only" });
    await rejectPayment(finance, pay.id, "Not found on the M-Pesa statement");
    expect((await partyFinancialSummary(tenant.id)).accountBalance).toBe(2500000);
    await expect(verifyPayment(finance, pay.id)).rejects.toThrow(/already rejected/);
  });

  it("carries unpaid rent forward month to month and reconciles", async () => {
    const { tenant } = await setup();
    await issueBilling(finance, "2026-09-01");
    await issueBilling(finance, "2026-10-01");
    expect(await db.invoice.count()).toBe(2);
    const pay = await recordPayment(manager, { partyId: tenant.id, method: "CASH", reference: "RB-77", amount: 1000000, receivedDate: "2026-10-03", evidenceNote: null });
    await verifyPayment(finance, pay.id);
    const sep = await db.invoice.findFirstOrThrow({ where: { periodStart: new Date("2026-09-01T00:00:00Z") } });
    await allocatePayment(finance, pay.id, [{ invoiceId: sep.id, amount: 1000000 }]);

    // Each month keeps its own invoice and balance.
    const sepAfter = await getInvoice(finance, sep.id);
    expect(sepAfter!.summary.balance).toBe(1500000);
    const octInv = await db.invoice.findFirstOrThrow({ where: { periodStart: new Date("2026-10-01T00:00:00Z") } });
    expect((await getInvoice(finance, octInv.id))!.summary.balance).toBe(2500000);

    // The whole history reconciles: opening + charges − payments − credits + reversals = closing.
    const all = await accountStatement(finance, tenant.id, "2026-01-01", "2026-12-31");
    expect(all).toMatchObject({ opening: 0, charges: 5000000, payments: 1000000, credits: 0, reversals: 0, closing: 4000000 });
    // A later statement period starts from the unpaid debt carried forward.
    const later = await accountStatement(finance, tenant.id, "2027-01-01", "2027-01-31");
    expect(later.opening).toBe(4000000);
    expect(later.closing).toBe(4000000);
    expect((await reconciliationCheck(finance)).every((r) => r.matches)).toBe(true);
  });

  it("corrects issued invoices only with credit notes, never edits", async () => {
    await setup();
    await issueBilling(finance, "2026-09-01");
    const inv = await db.invoice.findFirstOrThrow();
    await expect(createCreditNote(finance, inv.id, 2500001, "too much")).rejects.toThrow(/cannot exceed/);
    await createCreditNote(finance, inv.id, 500000, "Agreed discount");
    expect((await getInvoice(finance, inv.id))!.summary.balance).toBe(2000000);
    await expect(createCreditNote(manager, inv.id, 1, "x")).rejects.toThrow(/permission/);
    await expect(db.invoice.update({ where: { id: inv.id }, data: { total: "1.00" } })).rejects.toThrow(/cannot be changed/);
    await expect(db.invoiceLine.updateMany({ data: { amount: "1.00" } })).rejects.toThrow();
  });

  it("requires a second person to issue a manual (e.g. final settlement) invoice", async () => {
    const { tenant, u1, rental } = await setup();
    const draft = await createManualInvoice(manager, {
      partyId: tenant.id, unitId: u1.id, agreementId: rental.id, notes: "Final settlement", dueDate: "2026-10-30",
      lines: [{ category: "OTHER", description: "Broken window (agreed)", amount: 350000 }],
    });
    expect((await partyFinancialSummary(tenant.id)).accountBalance).toBe(0);
    await expect(issueManualInvoice(finance, draft.id)).resolves.toBeTruthy();
    await expect(issueManualInvoice(finance, draft.id)).rejects.toThrow(/Only a draft/);
    expect((await partyFinancialSummary(tenant.id)).accountBalance).toBe(350000);

    const own = await createManualInvoice(finance, { partyId: tenant.id, unitId: u1.id, agreementId: null, notes: null, dueDate: "2026-10-30", lines: [{ category: "OTHER", description: "x", amount: 100 }] });
    await expect(issueManualInvoice(finance, own.id)).rejects.toThrow(/someone other/);
  });

  it("stops recurring billing after an agreement ends but keeps the debt", async () => {
    const { tenant, rental } = await setup();
    await issueBilling(finance, "2026-09-01");
    await endAgreement(manager, rental.id, "2026-09-30", "Tenant moved out");
    await expect(
      addAgreementCharge(manager, rental.id, { category: "SHARED_CHARGE", description: "Water", amount: 100, effectiveFrom: "2026-10-01", effectiveTo: null }),
    ).rejects.toThrow(/ended agreement/);
    const oct = await previewBilling(finance, "2026-10-01");
    expect(oct.invoices).toHaveLength(0);
    expect((await partyFinancialSummary(tenant.id)).accountBalance).toBe(2500000);
  });

  it("keeps expenses separate from tenant charges; an approver who records expenses approves own ones in one step (F61)", async () => {
    await setup();
    const e = await createExpense(operations, {
      category: "CLEANING", payee: "CleanCo", description: "October cleaning", amount: 4500000,
      servicePeriodStart: "2026-10-01", servicePeriodEnd: "2026-10-31", costCentre: null, evidenceNote: null, workOrderId: null, staffMemberId: null,
    }, true);
    await expect(decideExpense(operations, e.id, "APPROVED", null)).rejects.toThrow(/permission/);
    const fin = await createExpense(finance, { ...{ category: "WATER", payee: "Water Co", description: "Bill", amount: 100, servicePeriodStart: null, servicePeriodEnd: null, costCentre: null, evidenceNote: null, workOrderId: null, staffMemberId: null } }, true);
    await decideExpense(finance, fin.id, "APPROVED", null);
    await decideExpense(finance, e.id, "APPROVED", null);
    expect(await db.invoice.count()).toBe(0);
    await expect(createExpense(operations, { category: "SALARIES", payee: "Guard", description: "Pay", amount: 100, servicePeriodStart: null, servicePeriodEnd: null, costCentre: null, evidenceNote: null, workOrderId: null, staffMemberId: null }, true)).rejects.toThrow(/salary access/);
    // Salaries have one path (Salary Payments), even for roles with salary access.
    await expect(createExpense(finance, { category: "SALARIES", payee: "Guard", description: "Pay", amount: 100, servicePeriodStart: null, servicePeriodEnd: null, costCentre: null, evidenceNote: null, workOrderId: null, staffMemberId: null }, true)).rejects.toThrow(/Salary Payments/);
  });

  it("filters the dashboard activity feed by permission", async () => {
    const { tenant } = await setup();
    const guard = await saveStaff(admin, null, { fullName: "Guard Salary Person", position: "Guard", phone: null, salaryAmount: null, startDate: null, endDate: null, notes: null });
    await recordSalaryPayment(finance, { staffMemberId: guard.id, month: "2026-10-01", gross: 2000000, allowances: 0, deductions: 0, notes: "October pay", evidenceNote: null }, true);
    await recordPayment(manager, { partyId: tenant.id, method: "BANK", reference: "FEED-1", amount: 1000, receivedDate: "2026-10-01", evidenceNote: null });

    const forManager = await recentActivity(manager, 50);
    // The staff record itself is not secret; the salary payment (an Expense) is.
    expect(forManager.some((a) => a.entityType === "Expense" && (a.context === "Guard Salary Person" || /Guard Salary Person|salary/i.test(a.summary)))).toBe(false);
    expect(forManager.some((a) => a.entityType === "Payment")).toBe(true);
    expect(forManager.every((a) => a.actor === null)).toBe(true); // managers cannot read the audit log

    const forFinance = await recentActivity(finance, 50);
    expect(forFinance.some((a) => a.entityType === "Expense" && a.context === "Guard Salary Person")).toBe(true);

    const forOperations = await recentActivity(operations, 50);
    expect(forOperations.some((a) => a.entityType === "Payment" || a.entityType === "Invoice" || a.entityType === "Party")).toBe(false);

    const forAuditor = await recentActivity(actor("AUDITOR"), 50);
    expect(forAuditor.some((a) => a.actor !== null)).toBe(true);
    expect(forAuditor.some((a) => a.action.startsWith("auth."))).toBe(false);
  });

  it("keeps the audit log append-only and free of secrets", async () => {
    await setup();
    const ev = await db.auditEvent.findFirstOrThrow({ where: { action: "account.create" } });
    await expect(db.auditEvent.update({ where: { id: ev.id }, data: { summary: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(db.auditEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/append-only/);
    const all = JSON.stringify(await db.auditEvent.findMany({ where: { action: "account.create" } }), (_k, v) => (typeof v === "bigint" ? String(v) : v));
    expect(all).not.toContain("12345678");
  });

  it("lists open invoices oldest billing period first when several months are issued on the same day", async () => {
    const { tenant, u1 } = await setup();
    // Issued out of order on the same day, so neither issue date nor invoice number follows the billing month.
    for (const month of ["2026-09-01", "2026-07-01", "2026-10-01", "2026-08-01"]) await issueBilling(finance, month);
    const all = await db.invoice.findMany({ where: { partyId: tenant.id } });
    expect(new Set(all.map((i) => i.issueDate?.toISOString())).size).toBe(1);
    const byMonth = (m: string) => all.find((i) => i.periodStart?.toISOString().startsWith(m))!;
    expect(byMonth("2026-07").number! > byMonth("2026-09").number!).toBe(true);

    const draft = await createManualInvoice(manager, { partyId: tenant.id, unitId: u1.id, agreementId: null, notes: null, dueDate: "2026-12-30", lines: [{ category: "OTHER", description: "Key replacement", amount: 150050 }] });
    await issueManualInvoice(finance, draft.id);

    const months = async () => (await openInvoicesForParty(tenant.id)).map((i) => [i.periodStart?.slice(0, 7) ?? "manual", i.balance]);
    expect(await months()).toEqual([["2026-07", 2500000], ["2026-08", 2500000], ["2026-09", 2500000], ["2026-10", 2500000], ["manual", 150050]]);

    // July paid in full, August part-paid, September part-credited: the order holds and balances stay exact.
    const pay = await recordPayment(manager, { partyId: tenant.id, method: "BANK", reference: "ORDER-1", amount: 3800075, receivedDate: "2026-10-10", evidenceNote: null });
    await verifyPayment(finance, pay.id);
    await allocatePayment(finance, pay.id, [{ invoiceId: byMonth("2026-07").id, amount: 2500000 }, { invoiceId: byMonth("2026-08").id, amount: 1300075 }]);
    await createCreditNote(finance, byMonth("2026-09").id, 1000000, "Agreed discount");
    expect(await months()).toEqual([["2026-08", 1199925], ["2026-09", 1500000], ["2026-10", 2500000], ["manual", 150050]]);

    // Paying the rest in the listed order clears every invoice to exactly zero.
    const rest = await recordPayment(manager, { partyId: tenant.id, method: "BANK", reference: "ORDER-2", amount: 5349975, receivedDate: "2026-10-12", evidenceNote: null });
    await verifyPayment(finance, rest.id);
    await allocatePayment(finance, rest.id, (await openInvoicesForParty(tenant.id)).map((i) => ({ invoiceId: i.id, amount: i.balance })));
    expect(await openInvoicesForParty(tenant.id)).toEqual([]);
    expect((await partyFinancialSummary(tenant.id)).accountBalance).toBe(0);
    expect(await db.auditEvent.count({ where: { action: "payment.allocate", entityId: { in: [pay.id, rest.id] } } })).toBe(2);
  });
});

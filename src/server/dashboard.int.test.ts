import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { saveBuilding } from "@/server/services/admin";
import { createAgreement, createParty, createUnit, type AgreementInput } from "@/server/services/property";
import { issueBilling } from "@/server/services/billing";
import { allocatePayment, recordPayment, verifyPayment } from "@/server/services/finance";
import { createExpense, decideExpense, type ExpenseInput } from "@/server/services/operations";
import { dashboard, EXPIRING_SOON_DAYS } from "@/server/services/reports";
import { addDays, addMonths, monthStart, todayISO } from "@/lib/dates";

assertTestDatabase();

const admin = actor("ADMIN");
const manager = actor("MANAGER");
const finance = actor("FINANCE");
const operations = actor("OPERATIONS");

const today = todayISO();
const thisMonth = monthStart(today);

const rental = (unitId: string, partyId: string, over: Partial<AgreementInput> = {}): AgreementInput => ({
  type: "RENTAL", unitId, partyId, reference: null, startDate: addMonths(thisMonth, -2), endDate: null, rentAmount: 2500000, managementFeeAmount: null,
  dueDay: 1, graceDays: null, purchaseDate: null, ownershipEvidence: null, lateFeeTerms: null, allocationTerms: null, notes: null, ...over,
});

const expense = (amount: number): ExpenseInput => ({
  category: "WATER", payee: "Water Co", description: "Water", amount, servicePeriodStart: thisMonth, servicePeriodEnd: null, costCentre: null, evidenceNote: null, workOrderId: null, staffMemberId: null,
});

async function tenantWithUnit(n: string) {
  const unit = await createUnit(manager, { unitNumber: n, floor: null, unitType: null, notes: null });
  const party = await createParty(admin, { displayName: `Tenant ${n}`, phone: null, email: null, idNumber: null, notes: null });
  return { unit, party };
}

describe("dashboard figures", () => {
  beforeEach(async () => {
    await resetTestData();
    await saveBuilding(admin, { name: "Test Building", address: null });
  });

  it("uses a custom date range for the period figures, both days included, across a month boundary", async () => {
    const { party } = await tenantWithUnit("CR1");
    const lastDayOfLastMonth = addDays(thisMonth, -1);
    const pay = async (reference: string, amount: number, receivedDate: string) => verifyPayment(admin, (await recordPayment(finance, { partyId: party.id, method: "MPESA", reference, amount, receivedDate, evidenceNote: null })).id);
    await pay("CR-A", 100000, lastDayOfLastMonth);
    await pay("CR-B", 200000, thisMonth);
    await decideExpense(finance, (await createExpense(operations, { ...expense(50000), servicePeriodStart: addMonths(thisMonth, -1) }, true)).id, "APPROVED", null);
    const collected = async (from: string, to: string) => (await dashboard(finance, "custom", { from, to })).money!.collected;
    expect(await collected(lastDayOfLastMonth, lastDayOfLastMonth)).toBe(100000); // a single day
    expect(await collected(thisMonth, thisMonth)).toBe(200000); // the first of the month
    expect(await collected(lastDayOfLastMonth, thisMonth)).toBe(300000); // across the boundary
    expect(await collected(addDays(lastDayOfLastMonth, -30), addDays(lastDayOfLastMonth, -1))).toBe(0);
    const d = await dashboard(finance, "custom", { from: addMonths(thisMonth, -1), to: today });
    expect(d).toMatchObject({ period: "custom", from: addMonths(thisMonth, -1), to: today });
    expect(d.money).toMatchObject({ collected: 300000, expenses: 50000 });
    // The same range named "last month" + "this month" gives the same totals as the custom range.
    const [last, now] = [(await dashboard(finance, "last-month")).money!, (await dashboard(finance, "month")).money!];
    expect(last.collected + now.collected).toBe(d.money!.collected);
    expect(last.expenses + now.expenses).toBe(d.money!.expenses);
    // Balances owed are as of today, whatever the range.
    expect(d.money!.outstanding).toBe(now.outstanding);
    await expect(dashboard(finance, "custom", { from: today, to: addDays(today, -1) })).rejects.toThrow(/valid start and end/);
    await expect(dashboard(finance, "custom")).rejects.toThrow(/valid start and end/);
  });

  it("shows no collection rate (not 0% or NaN) when nothing was billed", async () => {
    const d = await dashboard(finance, "month");
    expect(d.money).toMatchObject({ billed: 0, collectionRate: null, collectionRatePaid: 0, collectionRateBilled: 0, expensesByStatus: { awaiting: 0, approved: 0, rejected: 0 } });
    expect(Object.values(d.money!.ageingCounts).every((n) => n === 0)).toBe(true);
    expect(d).toMatchObject({ totalUnits: 0, occupied: 0, vacant: 0 });
  });

  it("calculates the collection rate from payments allocated to the period's invoices only", async () => {
    const { unit, party } = await tenantWithUnit("A-1");
    await createAgreement(manager, rental(unit.id, party.id));
    await issueBilling(finance, thisMonth);
    const invoice = await db.invoice.findFirstOrThrow();

    const pay = await recordPayment(manager, { partyId: party.id, method: "MPESA", reference: "DASH1", amount: 1000000, receivedDate: today, evidenceNote: null });
    await verifyPayment(finance, pay.id);
    await allocatePayment(finance, pay.id, [{ invoiceId: invoice.id, amount: 1000000 }]);
    // An unallocated verified payment counts as collected but does not inflate the rate.
    const extra = await recordPayment(manager, { partyId: party.id, method: "CASH", reference: "DASH2", amount: 5000000, receivedDate: today, evidenceNote: null });
    await verifyPayment(finance, extra.id);

    const m = (await dashboard(finance, "month")).money!;
    expect(m).toMatchObject({ billed: 2500000, rentBilled: 2500000, collected: 6000000, collectionRatePaid: 1000000, collectionRateBilled: 2500000 });
    expect(m.collectionRate).toBeCloseTo(0.4);
    expect(m.outstanding).toBe(1500000);
    expect(Object.values(m.ageingCounts).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("totals the period's expenses by approval status", async () => {
    const submitted = await createExpense(operations, expense(100000), true);
    const approved = await createExpense(operations, expense(250000), true);
    const rejected = await createExpense(operations, expense(70000), true);
    await createExpense(operations, expense(999900), false); // draft: not shown
    await decideExpense(finance, approved.id, "APPROVED", null);
    await decideExpense(finance, rejected.id, "REJECTED", "Duplicate bill");
    const m = (await dashboard(finance, "month")).money!;
    expect(m.expensesByStatus).toEqual({ awaiting: 100000, approved: 250000, rejected: 70000 });
    expect(m.expenses).toBe(250000); // existing figure: approved/paid only
    expect(submitted.status).toBe("SUBMITTED");
  });

  it("counts active agreements ending within the expiring-soon window", async () => {
    const a = await tenantWithUnit("A-1");
    const b = await tenantWithUnit("A-2");
    const c = await tenantWithUnit("A-3");
    await createAgreement(manager, rental(a.unit.id, a.party.id, { endDate: addDays(today, 10) }));
    await createAgreement(manager, rental(b.unit.id, b.party.id, { endDate: addDays(today, EXPIRING_SOON_DAYS + 10) }));
    await createAgreement(manager, rental(c.unit.id, c.party.id, { endDate: addDays(today, -1) })); // already ended
    const d = await dashboard(manager, "month");
    expect(d.expiringAgreements).toBe(1);
    expect(d).toMatchObject({ totalUnits: 3, occupied: 2, vacant: 1 });
  });

  it("hides money and agreement queues from roles without access", async () => {
    const d = await dashboard(operations, "month");
    expect(d.money).toBeNull();
    expect(d.expiringAgreements).toBeNull();
    expect(d.pendingPayments).toBeNull();
  });
});

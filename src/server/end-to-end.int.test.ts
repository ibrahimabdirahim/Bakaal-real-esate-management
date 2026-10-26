// End-to-end consistency: the three account types registered through Add Account, billed by a
// billing run under the approved rules only, then paid, verified, rejected, allocated, credited
// and reversed; an expense and a salary approved and paid. Every total must agree across the
// invoices, statements, ledger, dashboard and reports.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { createAccount, createUnit, type NewAccountInput } from "@/server/services/property";
import { issueBilling, previewBilling } from "@/server/services/billing";
import { allocatePayment, createCreditNote, listInvoices, listPayments, partyFinancialSummary, recordPayment, rejectPayment, reversePayment, verifyPayment } from "@/server/services/finance";
import { createExpense, decideExpense, markExpensePaid, saveStaff } from "@/server/services/operations";
import { recordSalaryPayment } from "@/server/services/salaries";
import { accountStatement, arrearsReport, collectionsReport, dashboard, expenseReport, financeLedger, reconciliationCheck, upcomingBilling } from "@/server/services/reports";
import { addMonths, monthEnd, monthStart, todayISO } from "@/lib/dates";
import { sumCents } from "@/lib/money";

assertTestDatabase();

const admin = actor("ADMIN");
const manager = actor("MANAGER");
const finance = actor("FINANCE");
const operations = actor("OPERATIONS");
const today = todayISO();
const thisMonth = monthStart(today);
const lastMonth = addMonths(thisMonth, -1);
const start = addMonths(thisMonth, -3);
const party = (displayName: string, phone: string) => ({ displayName, phone, email: null, idNumber: null, notes: null });
const docs = { account: [], agreement: [], management: [] };
const ownership = { startDate: start, purchaseDate: null, ownershipEvidence: "Sale agreement on file", reference: null, dueDay: 10, notes: null };
const charge = (category: "SERVICE_CHARGE" | "SHARED_CHARGE", description: string, amount: number) => ({ category, description, amount, effectiveFrom: start, effectiveTo: null });

beforeEach(async () => {
  await resetTestData();
  await db.building.create({ data: { name: "E2E Building" } });
});

describe("the agreed workflows, end to end", () => {
  it("charges each account type only what its agreement allows, and every total agrees", async () => {
    const units = await Promise.all(["T-1", "O-1", "M-1", "M-2", "V-1"].map((n) => createUnit(admin, { unitNumber: n, floor: null, unitType: null, notes: null })));
    const accounts: NewAccountInput[] = [
      { party: party("Tenant", "0700 000 001"), accountType: "TENANT", unitId: units[0].id, tenancy: { startDate: start, endDate: null, rentAmount: 3000000, dueDay: 5, graceDays: null, reference: null, lateFeeTerms: null, allocationTerms: null, notes: null }, charges: [charge("SERVICE_CHARGE", "Approved service charge", 250000)], documents: docs },
      { party: party("Owner", "0700 000 002"), accountType: "OWNER", unitId: units[1].id, ownership, charges: [charge("SHARED_CHARGE", "Approved water share", 80000)], documents: docs },
      { party: party("Managed", "0700 000 003"), accountType: "MANAGED", unitId: units[2].id, ownership, management: { startDate: start, endDate: null, managementFeeAmount: 450000, dueDay: 10, graceDays: null, reference: null, notes: null }, charges: [charge("SHARED_CHARGE", "Approved security share", 120000)], documents: docs },
      { party: party("Managed No Fee", "0700 000 004"), accountType: "MANAGED", unitId: units[3].id, ownership, management: { startDate: start, endDate: null, managementFeeAmount: null, dueDay: 10, graceDays: null, reference: null, notes: null }, charges: [], documents: docs },
    ];
    const ids: Record<string, string> = {};
    for (const a of accounts) ids[a.party.displayName] = (await createAccount(manager, a)).party.id;

    // Billing: rent only for the tenant; owners pay only approved charges; the managed unit pays the agreed fee.
    const preview = await previewBilling(finance, lastMonth);
    expect(preview.reviews.map((r) => r.partyName)).toEqual(["Managed No Fee"]); // flagged, not invented
    await issueBilling(finance, lastMonth);
    const invoices = await listInvoices(finance, {});
    const linesOf = async (name: string) =>
      (await db.invoiceLine.findMany({ where: { invoice: { partyId: ids[name] } }, orderBy: { category: "asc" } })).map((l) => [l.category, String(l.amount)]);
    expect(await linesOf("Tenant")).toEqual([["RENT", "30000"], ["SERVICE_CHARGE", "2500"]]);
    expect(await linesOf("Owner")).toEqual([["SHARED_CHARGE", "800"]]);
    expect(await linesOf("Managed")).toEqual([["MANAGEMENT_FEE", "4500"], ["SHARED_CHARGE", "1200"]]);
    expect(await linesOf("Managed No Fee")).toEqual([]);
    expect(invoices).toHaveLength(3); // the vacant unit and the fee-less managed unit get nothing

    // Payments: one verified and allocated, one rejected, one verified then reversed; a credit note.
    const tenantInv = invoices.find((i) => i.party.id === ids.Tenant)!;
    const p1 = await recordPayment(manager, { partyId: ids.Tenant, method: "MPESA", reference: "E2E1", amount: 2000000, receivedDate: today, evidenceNote: null });
    await expect(allocatePayment(finance, p1.id, [{ invoiceId: tenantInv.id, amount: 1 }])).rejects.toThrow(/verified/); // pending money never pays invoices
    await verifyPayment(finance, p1.id);
    await allocatePayment(finance, p1.id, [{ invoiceId: tenantInv.id, amount: 2000000 }]);
    const p2 = await recordPayment(manager, { partyId: ids.Owner, method: "CASH", reference: "E2E2", amount: 80000, receivedDate: today, evidenceNote: null });
    await rejectPayment(finance, p2.id, "Not in the cash book");
    const p3 = await recordPayment(manager, { partyId: ids.Managed, method: "BANK", reference: "E2E3", amount: 570000, receivedDate: today, evidenceNote: null });
    await verifyPayment(finance, p3.id);
    const managedInv = invoices.find((i) => i.party.id === ids.Managed)!;
    await allocatePayment(finance, p3.id, [{ invoiceId: managedInv.id, amount: 570000 }]);
    await reversePayment(finance, p3.id, "Bank returned it");
    await createCreditNote(finance, tenantInv.id, 50000, "Agreed discount");

    // Each payment shows the unit it paid for (allocated invoices), else the account's unit in force.
    const listed = await listPayments(finance);
    const unitsOf = (ref: string) => listed.find((p) => p.reference === ref)!.units.map((u) => u.unitNumber);
    expect([unitsOf("E2E1"), unitsOf("E2E2"), unitsOf("E2E3")]).toEqual([["T-1"], ["O-1"], ["M-1"]]); // E2E3's allocation was reversed: falls back to the account's unit
    expect(listed.map((p) => p.status).sort()).toEqual(["REJECTED", "REVERSED", "VERIFIED"]); // every status is listed

    // Upcoming billing: this month is not billed yet, so the approved rules' invoices show as "Not yet billed"; nothing invented.
    const upcoming = await upcomingBilling(finance);
    expect(upcoming.map((u) => [u.party.name, u.unit.unitNumber, u.amount, u.status, u.dueDate]).sort()).toEqual(
      [["Managed", "M-1", 570000, "Not yet billed", `${thisMonth.slice(0, 8)}10`], ["Owner", "O-1", 80000, "Not yet billed", `${thisMonth.slice(0, 8)}10`], ["Tenant", "T-1", 3250000, "Not yet billed", `${thisMonth.slice(0, 8)}05`]].sort(),
    );
    expect(await upcomingBilling(operations).catch((e: Error) => e.name)).toBe("PermissionError");

    // Balances: billed 32,500 + 800 + 5,700 = 39,000; paid 20,000; credited 500 → 18,500 owed.
    const owed = { Tenant: 3250000 - 2000000 - 50000, Owner: 80000, Managed: 570000 };
    for (const [name, value] of Object.entries(owed)) expect((await partyFinancialSummary(ids[name])).accountBalance).toBe(value);
    for (const [name, value] of Object.entries(owed)) expect((await accountStatement(finance, ids[name], "2000-01-01", today)).closing).toBe(value);
    const total = sumCents(Object.values(owed));
    expect(total).toBe(1850000);
    const ledger = await financeLedger(finance, "2000-01-01", today);
    expect(ledger).toMatchObject({ charges: 3900000, payments: 2570000, reversals: 570000, credits: 50000, closing: total });
    expect((await arrearsReport(finance)).grandTotal).toBe(total);
    expect((await reconciliationCheck(finance)).every((r) => r.matches)).toBe(true);
    expect(await collectionsReport(finance, thisMonth, today)).toMatchObject({ received: 2570000, reversed: 570000, total: 2000000 });

    // Costs: an expense and a salary, approved (a cost) and then paid (money out).
    const water = await createExpense(operations, { category: "WATER", payee: "Water Co", description: "Bill", amount: 300000, servicePeriodStart: thisMonth, servicePeriodEnd: monthEnd(thisMonth), costCentre: null, evidenceNote: null, workOrderId: null, staffMemberId: null }, true);
    await decideExpense(finance, water.id, "APPROVED", null);
    const guard = await saveStaff(admin, null, { fullName: "Guard", position: "Guard", phone: null, salaryAmount: 2000000, startDate: null, endDate: null, notes: null });
    const pay = await recordSalaryPayment(finance, { staffMemberId: guard.id, month: thisMonth, gross: 2000000, allowances: 100000, deductions: 50000, notes: null, evidenceNote: null }, true);
    await decideExpense(admin, pay.id, "APPROVED", null);
    await markExpensePaid(finance, pay.id, "MPESA", "SAL-E2E", { paidDate: today });

    const m = (await dashboard(admin, "month")).money!;
    expect(m).toMatchObject({
      collected: 2000000, received: 2570000, reversed: 570000, outstanding: total,
      outstandingBroughtForward: total, outstandingThisMonth: 0, // everything was billed last month; the two always add up to the total
      expenses: 300000 + 2050000, expensesApprovedUnpaid: 300000, expensesPaid: 2050000, salaries: 2050000, salariesPaid: 2050000, salariesApprovedUnpaid: 0,
    });
    expect(await expenseReport(admin, thisMonth, today)).toMatchObject({ total: 2350000, salaries: 2050000, runningCosts: 300000, approvedUnpaid: 300000, paidInPeriod: 2050000 });

    // Occupancy: 4 of 5 units have agreements in force; none retired.
    const d = await dashboard(admin, "month");
    expect(d).toMatchObject({ totalUnits: 5, occupied: 4, vacant: 1, unavailableUnits: 0 });
  });

  it("creates each account with its initial agreement(s) once, correctly linked, even when submitted twice at once", async () => {
    const units = await Promise.all(["T-1", "O-1", "M-1"].map((n) => createUnit(admin, { unitNumber: n, floor: null, unitType: null, notes: null })));
    // No phone, e-mail or ID number, so the contact-duplicate check cannot help: the unit's agreement must.
    const noContact = (displayName: string) => ({ displayName, phone: null, email: null, idNumber: null, notes: null });
    const inputs: NewAccountInput[] = [
      { party: noContact("Twice Tenant"), accountType: "TENANT", unitId: units[0].id, tenancy: { startDate: start, endDate: null, rentAmount: 3000000, dueDay: 5, graceDays: null, reference: "RA-T", lateFeeTerms: null, allocationTerms: null, notes: null }, charges: [charge("SERVICE_CHARGE", "Approved service charge", 250000)], documents: docs },
      { party: noContact("Twice Owner"), accountType: "OWNER", unitId: units[1].id, ownership, charges: [charge("SHARED_CHARGE", "Approved water share", 80000)], documents: docs },
      { party: noContact("Twice Managed"), accountType: "MANAGED", unitId: units[2].id, ownership, management: { startDate: start, endDate: null, managementFeeAmount: 450000, dueDay: 10, graceDays: null, reference: "MA-1", notes: null }, charges: [charge("SHARED_CHARGE", "Approved security share", 120000)], documents: docs },
    ];
    for (const input of inputs) {
      const results = await Promise.allSettled([createAccount(manager, input), createAccount(manager, input)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await db.party.count({ where: { displayName: input.party.displayName } })).toBe(1); // the refused one left no account
    }

    const agreementsOf = async (name: string) =>
      db.agreement.findMany({ where: { party: { displayName: name } }, include: { charges: true, unit: true }, orderBy: { type: "asc" } });
    const [rental] = await agreementsOf("Twice Tenant");
    expect(rental).toMatchObject({ type: "RENTAL", unitId: units[0].id, reference: "RA-T", managementFeeAmount: null });
    expect(String(rental.rentAmount)).toBe("30000");
    expect(rental.charges.map((c) => c.category)).toEqual(["SERVICE_CHARGE"]);
    const owner = await agreementsOf("Twice Owner");
    expect(owner.map((a) => [a.type, a.unitId, a.rentAmount, a.charges.map((c) => c.category)])).toEqual([["OWNERSHIP", units[1].id, null, ["SHARED_CHARGE"]]]);
    const managed = await agreementsOf("Twice Managed");
    expect(managed.map((a) => [a.type, a.unitId, a.rentAmount])).toEqual([["OWNERSHIP", units[2].id, null], ["MANAGEMENT", units[2].id, null]]);
    expect(String(managed[1].managementFeeAmount)).toBe("4500");
    expect(managed[1].charges.map((c) => c.category)).toEqual(["SHARED_CHARGE"]); // charges sit on the management agreement

    // Billing uses those agreements and their terms; each invoice belongs to the right account and unit.
    await issueBilling(finance, lastMonth);
    const invoices = await db.invoice.findMany({ include: { lines: true, party: true, unit: true } });
    expect(invoices.map((i) => [i.party.displayName, i.unit.unitNumber, i.agreementId, Number(i.total)]).sort()).toEqual(
      [["Twice Managed", "M-1", managed[1].id, 5700], ["Twice Owner", "O-1", owner[0].id, 800], ["Twice Tenant", "T-1", rental.id, 32500]].sort(),
    );

    // A failed second record rolls everything back: an owner for an already-owned unit leaves nothing behind.
    await expect(createAccount(manager, { ...inputs[1], party: noContact("Late Owner") })).rejects.toThrow(/already has an agreement/);
    expect(await db.party.count({ where: { displayName: "Late Owner" } })).toBe(0);
  });
});

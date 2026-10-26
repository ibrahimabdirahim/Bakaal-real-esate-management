// One tenant from registration to a settled invoice (2026-10-22 system check): several approved
// charges on one itemised invoice, a part payment, a rejected and a reversed payment, unallocated
// money, settlement, and the same figures on the invoice, account, statement, arrears and rent roll.
// Also: the same charge cannot be added twice, and issued invoices keep their amounts after later changes.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { addAgreementCharge, createAccount, createUnit, endAgreementCharge, type NewAccountInput } from "@/server/services/property";
import { issueBilling } from "@/server/services/billing";
import { allocatePayment, getInvoice, partyFinancialSummary, recordPayment, rejectPayment, reversePayment, verifyPayment } from "@/server/services/finance";
import { accountStatement, arrearsReport, collectionsReport, rentRoll } from "@/server/services/reports";
import { addMonths, monthEnd, monthStart, todayISO } from "@/lib/dates";
import { sumCents } from "@/lib/money";

assertTestDatabase();

const manager = actor("MANAGER");
const finance = actor("FINANCE");
const finance2 = actor("FINANCE", "finance-2");
const today = todayISO();
const thisMonth = monthStart(today);
const lastMonth = addMonths(thisMonth, -1);
const start = addMonths(thisMonth, -2);
const docs = { account: [], agreement: [], management: [] };

beforeEach(async () => {
  await resetTestData();
  await db.building.create({ data: { name: "Lifecycle Building" } });
});

async function tenantWithCharges() {
  const unit = await createUnit(actor("ADMIN"), { unitNumber: "H1", floor: null, unitType: null, notes: null });
  const input: NewAccountInput = {
    party: { displayName: "Lifecycle Tenant", phone: "0711 000 111", email: null, idNumber: null, notes: null },
    accountType: "TENANT",
    unitId: unit.id,
    tenancy: { startDate: start, endDate: null, rentAmount: 1000000, dueDay: 5, graceDays: null, reference: "LT-1", lateFeeTerms: null, allocationTerms: null, notes: null },
    charges: [
      { category: "SERVICE_CHARGE", description: "Approved service charge", amount: 100000, effectiveFrom: start, effectiveTo: null },
      { category: "SHARED_CHARGE", description: "Approved garbage share", amount: 35000, effectiveFrom: start, effectiveTo: null },
    ],
    documents: docs,
  };
  const { party, agreement } = await createAccount(manager, input);
  return { unit, party, agreement };
}

const pay = (partyId: string, reference: string, amount: number) => recordPayment(manager, { partyId, method: "MPESA", reference, amount, receivedDate: today, evidenceNote: null });

describe("a tenant from registration to a settled invoice", () => {
  it("bills rent and each approved charge as lines that add up, and every view shows the same remaining balance", async () => {
    const { unit, party, agreement } = await tenantWithCharges();
    await issueBilling(finance, lastMonth);
    const inv = await db.invoice.findFirstOrThrow({ where: { partyId: party.id }, include: { lines: true } });
    expect(inv.unitId).toBe(unit.id);
    expect(inv.agreementId).toBe(agreement.id);
    expect(inv.lines.map((l) => [l.category, String(l.amount)]).sort()).toEqual([["RENT", "10000"], ["SERVICE_CHARGE", "1000"], ["SHARED_CHARGE", "350"]]);
    expect(String(inv.total)).toBe("11350");
    expect(sumCents(inv.lines.map((l) => Math.round(Number(l.amount) * 100)))).toBe(1135000);

    // Pending and rejected money changes nothing.
    const pending = await pay(party.id, "LC-PEND", 1135000);
    const rejected = await pay(party.id, "LC-REJ", 1135000);
    await rejectPayment(finance, rejected.id, "Not on the statement");
    expect((await getInvoice(finance, inv.id))!.summary.balance).toBe(1135000);
    expect((await partyFinancialSummary(party.id)).accountBalance).toBe(1135000);
    await rejectPayment(finance, pending.id, "Duplicate of LC-1");

    // KES 7,000 verified: unallocated until allocated, then KES 4,350 remains on the invoice.
    const first = await pay(party.id, "LC-1", 700000);
    await verifyPayment(finance, first.id);
    let s = await partyFinancialSummary(party.id);
    expect([s.invoiceBalances, s.unallocated, s.accountBalance]).toEqual([1135000, 700000, 435000]);
    await allocatePayment(finance, first.id, [{ invoiceId: inv.id, amount: 700000 }]);
    expect((await getInvoice(finance, inv.id))!.summary).toMatchObject({ balance: 435000, paymentStatus: "PART_PAID" });
    s = await partyFinancialSummary(party.id);
    expect([s.invoiceBalances, s.unallocated, s.accountBalance]).toEqual([435000, 0, 435000]);
    expect((await accountStatement(finance, party.id, "2000-01-01", today)).closing).toBe(435000);
    expect(rowsFor(await arrearsReport(finance), party.id)).toBe(435000);
    const detail = (await arrearsReport(finance)).invoices.find((i) => i.id === inv.id)!;
    expect([detail.total, detail.paid, detail.credited, detail.balance]).toEqual([1135000, 700000, 0, 435000]);
    expect(detail.daysOverdue).toBeGreaterThan(0); // last month's invoice, due on the 5th

    // A payment verified and then reversed leaves the balance where it was.
    const bounced = await pay(party.id, "LC-BOUNCE", 435000);
    await verifyPayment(finance, bounced.id);
    await allocatePayment(finance, bounced.id, [{ invoiceId: inv.id, amount: 435000 }]);
    expect((await getInvoice(finance, inv.id))!.summary.balance).toBe(0);
    await reversePayment(finance, bounced.id, "Reversed by M-Pesa");
    expect((await getInvoice(finance, inv.id))!.summary.balance).toBe(435000);
    expect((await accountStatement(finance, party.id, "2000-01-01", today)).closing).toBe(435000);

    // The remaining KES 4,350 settles the invoice.
    const last = await pay(party.id, "LC-2", 435000);
    await verifyPayment(finance2, last.id);
    await allocatePayment(finance, last.id, [{ invoiceId: inv.id, amount: 435000 }]);
    expect((await getInvoice(finance, inv.id))!.summary).toMatchObject({ balance: 0, paymentStatus: "PAID" });
    expect((await partyFinancialSummary(party.id)).accountBalance).toBe(0);
    expect((await accountStatement(finance, party.id, "2000-01-01", today)).closing).toBe(0);
    expect(rowsFor(await arrearsReport(finance), party.id)).toBe(0);
    expect((await arrearsReport(finance)).invoices.some((i) => i.id === inv.id)).toBe(false);
    // Collections: each verified receipt with what is allocated; the reversed one counts for nothing.
    const col = await collectionsReport(finance, thisMonth, today);
    const byRef = (ref: string, kind = "RECEIPT") => col.rows.find((r) => r.reference === ref && r.kind === kind)!;
    expect([byRef("LC-1").allocated, byRef("LC-1").unallocated]).toEqual([700000, 0]);
    expect([byRef("LC-BOUNCE").allocated, byRef("LC-BOUNCE", "REVERSAL").amount]).toEqual([null, -435000]);
    expect(col.total).toBe(1135000);

    // The rent roll shows the agreed rent and the approved charges for the unit.
    const roll = (await rentRoll(finance, today)).find((r) => r.unitNumber === "H1")!;
    expect([roll.rent, roll.otherCharges, roll.monthlyTotal]).toEqual([1000000, 135000, 1135000]);
  });

  it("keeps money for one account off another account's invoice", async () => {
    const { party } = await tenantWithCharges();
    const other = await createAccount(manager, {
      party: { displayName: "Other Tenant", phone: "0711 000 222", email: null, idNumber: null, notes: null },
      accountType: "TENANT",
      unitId: (await createUnit(actor("ADMIN"), { unitNumber: "H2", floor: null, unitType: null, notes: null })).id,
      tenancy: { startDate: start, endDate: null, rentAmount: 500000, dueDay: 5, graceDays: null, reference: null, lateFeeTerms: null, allocationTerms: null, notes: null },
      documents: docs,
    });
    await issueBilling(finance, lastMonth);
    const otherInvoice = await db.invoice.findFirstOrThrow({ where: { partyId: other.party.id } });
    const p = await pay(party.id, "LC-X", 100000);
    await verifyPayment(finance, p.id);
    await expect(allocatePayment(finance, p.id, [{ invoiceId: otherInvoice.id, amount: 100000 }])).rejects.toThrow(/different account/);
    expect(await db.paymentAllocation.count()).toBe(0);
  });
});

describe("approved charges", () => {
  it("cannot be added twice for overlapping months, on Add Account or on the agreement, even at the same moment", async () => {
    const unit = await createUnit(actor("ADMIN"), { unitNumber: "D1", floor: null, unitType: null, notes: null });
    const twice = { category: "SERVICE_CHARGE" as const, description: "Approved service charge", amount: 100000, effectiveFrom: start, effectiveTo: null };
    await expect(
      createAccount(manager, {
        party: { displayName: "Twice Charged", phone: "0711 000 333", email: null, idNumber: null, notes: null },
        accountType: "TENANT",
        unitId: unit.id,
        tenancy: { startDate: start, endDate: null, rentAmount: 1000000, dueDay: 5, graceDays: null, reference: null, lateFeeTerms: null, allocationTerms: null, notes: null },
        charges: [twice, { ...twice, description: " approved SERVICE charge " }],
        documents: docs,
      }),
    ).rejects.toThrow(/already charged on this agreement/);
    expect(await db.party.count()).toBe(0); // nothing saved
    expect(await db.agreementCharge.count()).toBe(0);

    const { agreement } = await tenantWithCharges();
    await expect(addAgreementCharge(manager, agreement.id, { category: "SERVICE_CHARGE", description: "Approved service charge", amount: 100000, effectiveFrom: thisMonth, effectiveTo: null })).rejects.toThrow(/already charged/);
    const race = await Promise.allSettled([
      addAgreementCharge(manager, agreement.id, { category: "OTHER", description: "Parking", amount: 50000, effectiveFrom: thisMonth, effectiveTo: null }),
      addAgreementCharge(manager, agreement.id, { category: "OTHER", description: "Parking", amount: 50000, effectiveFrom: thisMonth, effectiveTo: null }),
    ]);
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.agreementCharge.count({ where: { agreementId: agreement.id } })).toBe(3);

    // After the old charge ends, a new rate for the same service can start the next month.
    const old = await db.agreementCharge.findFirstOrThrow({ where: { agreementId: agreement.id, description: "Approved service charge" } });
    await endAgreementCharge(manager, old.id, monthEnd(lastMonth));
    await addAgreementCharge(manager, agreement.id, { category: "SERVICE_CHARGE", description: "Approved service charge", amount: 120000, effectiveFrom: thisMonth, effectiveTo: null });
  });

  it("changes later months only: an issued invoice keeps its amounts", async () => {
    const { party, agreement } = await tenantWithCharges();
    await issueBilling(finance, lastMonth);
    const issued = await db.invoice.findFirstOrThrow({ where: { partyId: party.id }, include: { lines: true } });
    const snapshot = JSON.stringify([String(issued.total), issued.lines.map((l) => [l.description, String(l.amount)]).sort()]);

    const old = await db.agreementCharge.findFirstOrThrow({ where: { agreementId: agreement.id, description: "Approved service charge" } });
    await endAgreementCharge(manager, old.id, monthEnd(lastMonth));
    await addAgreementCharge(manager, agreement.id, { category: "SERVICE_CHARGE", description: "Approved service charge", amount: 150000, effectiveFrom: thisMonth, effectiveTo: null });
    await issueBilling(finance, thisMonth);

    const again = await db.invoice.findUniqueOrThrow({ where: { id: issued.id }, include: { lines: true } });
    expect(JSON.stringify([String(again.total), again.lines.map((l) => [l.description, String(l.amount)]).sort()])).toBe(snapshot);
    const next = await db.invoice.findFirstOrThrow({ where: { partyId: party.id, periodStart: new Date(`${thisMonth}T00:00:00Z`) } });
    expect(String(next.total)).toBe("11850"); // 10,000 rent + 1,500 new service charge + 350 garbage share
  });
});

function rowsFor(report: Awaited<ReturnType<typeof arrearsReport>>, partyId: string) {
  return report.rows.find((r) => r.partyId === partyId)?.total ?? 0;
}

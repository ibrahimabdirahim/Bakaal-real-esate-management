// Invoice-date presentation policy: billing-period summaries group an invoice by its billing
// month; the ledger and account statements date it by its issue date. An invoice issued in one
// month for another month's period must appear accordingly, and totals must still reconcile.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { createAgreement, createParty, createUnit } from "@/server/services/property";
import { issueBilling } from "@/server/services/billing";
import { createManualInvoice, issueManualInvoice, listInvoices } from "@/server/services/finance";
import { accountStatement, dashboard, financeLedger } from "@/server/services/reports";
import { addMonths, fromDbDate, monthEnd, monthStart, todayISO } from "@/lib/dates";

assertTestDatabase();

const admin = actor("ADMIN");
const manager = actor("MANAGER");
const finance = actor("FINANCE");
const finance2 = actor("FINANCE", "finance-2");

// Relative to the business date, so the test holds whatever day it runs: the billing period is
// always last month and the issue date always this month.
const today = todayISO();
const thisMonth = monthStart(today);
const lastMonth = addMonths(thisMonth, -1);

let tenantId = "";
let unitId = "";
beforeEach(async () => {
  await resetTestData();
  await db.building.create({ data: { name: "Dates Building" } });
  unitId = (await createUnit(manager, { unitNumber: "A-1", floor: null, unitType: null, notes: null })).id;
  tenantId = (await createParty(admin, { displayName: "Late Billed", phone: null, email: null, idNumber: null, notes: null })).id;
  await createAgreement(manager, {
    type: "RENTAL", unitId, partyId: tenantId, rentAmount: 3000000, reference: null, startDate: addMonths(lastMonth, -1), endDate: null, managementFeeAmount: null,
    dueDay: 5, graceDays: null, purchaseDate: null, ownershipEvidence: null, lateFeeTerms: null, allocationTerms: null, notes: null,
  });
  await issueBilling(finance, lastMonth); // issued today, for last month's period
});

describe("an invoice issued this month for last month's billing period", () => {
  it("keeps both dates on the record, unchanged", async () => {
    const inv = await db.invoice.findFirstOrThrow();
    expect(fromDbDate(inv.periodStart!)).toBe(lastMonth);
    expect(fromDbDate(inv.issueDate!)).toBe(today);
    expect(inv.total.toString()).toBe("30000");
  });

  it("counts in last month's billing-period summaries, not this month's", async () => {
    expect((await dashboard(finance, "last-month")).money).toMatchObject({ billed: 3000000, rentBilled: 3000000 });
    expect((await dashboard(finance, "month")).money).toMatchObject({ billed: 0, rentBilled: 0 });
    expect((await listInvoices(finance, { from: lastMonth, to: monthEnd(lastMonth) })).map((i) => i.total)).toEqual([3000000]);
    expect(await listInvoices(finance, { from: thisMonth, to: today })).toEqual([]);
  });

  it("is dated by its issue date in the ledger and the account statement, labelled with its billing period", async () => {
    const thisMonthLedger = await financeLedger(finance, thisMonth, today);
    expect(thisMonthLedger.charges).toBe(3000000);
    expect(thisMonthLedger.entries).toEqual([expect.objectContaining({ kind: "INVOICE", date: today, billingPeriod: lastMonth, debit: 3000000 })]);
    expect((await financeLedger(finance, lastMonth, monthEnd(lastMonth))).charges).toBe(0);
    const statement = await accountStatement(finance, tenantId, thisMonth, today);
    expect(statement.entries).toEqual([expect.objectContaining({ date: today, billingPeriod: lastMonth })]);
  });

  it("reconciles: the same total either way over a range covering both months", async () => {
    const d = (await dashboard(finance, "3m")).money!;
    const l = await financeLedger(finance, addMonths(thisMonth, -2), today);
    expect(d.billed).toBe(l.charges);
    expect(d.outstanding).toBe(l.closing);
  });
});

describe("a manual invoice (no billing period)", () => {
  it("falls back to its issue date in both views and is shown as manual", async () => {
    const draft = await createManualInvoice(finance, { partyId: tenantId, unitId, agreementId: null, notes: null, dueDate: today, lines: [{ category: "OTHER", description: "Key replacement", amount: 150000 }] });
    await issueManualInvoice(finance2, draft.id);
    expect((await dashboard(finance, "month")).money!.billed).toBe(150000);
    const entry = (await financeLedger(finance, thisMonth, today)).entries.find((e) => e.debit === 150000);
    expect(entry).toMatchObject({ kind: "INVOICE", date: today, billingPeriod: null });
  });
});

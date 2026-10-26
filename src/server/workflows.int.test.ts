// Cross-module workflows (QA plan, workflows A, B and D), checked against database state
// and every place the same figure appears: dashboard, account, reports, ledger, audit log.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { listAuditEvents, saveBuilding } from "@/server/services/admin";
import { audit } from "@/server/audit";
import { linkableRecords } from "@/server/services/common";
import { createAgreement, createParty, createUnit, deleteParty, endAgreement, listUnits, type AgreementInput } from "@/server/services/property";
import { issueBilling, previewBilling } from "@/server/services/billing";
import { allocatePayment, createManualInvoice, discardDraftInvoice, findDiscardedInvoice, partyFinancialSummary, recordPayment, verifyPayment } from "@/server/services/finance";
import { accountStatement, arrearsReport, collectionsReport, dashboard, occupancyReport, reconciliationCheck, recentActivity, rentRoll } from "@/server/services/reports";
import { ageingBucket } from "@/server/ledger";
import { addMonths, dayOfMonth, monthEnd, monthStart, todayISO } from "@/lib/dates";

assertTestDatabase();

const admin = actor("ADMIN");
const manager = actor("MANAGER");
const finance = actor("FINANCE");

const today = todayISO();
const thisMonth = monthStart(today);

const rental = (unitId: string, partyId: string, over: Partial<AgreementInput> = {}): AgreementInput => ({
  type: "RENTAL", unitId, partyId, reference: null, startDate: addMonths(thisMonth, -4), endDate: null, rentAmount: 3333333, managementFeeAmount: null,
  dueDay: 1, graceDays: null, purchaseDate: null, ownershipEvidence: null, lateFeeTerms: null, allocationTerms: null, notes: null, ...over,
});

async function setup(n = "A-1") {
  await saveBuilding(admin, { name: "Workflow Building", address: null, totalUnits: 4 });
  const unit = await createUnit(manager, { unitNumber: n, floor: "1", unitType: "1 Bedroom", notes: null });
  const tenant = await createParty(admin, { displayName: `Tenant ${n}`, phone: "0700 000 001", email: null, idNumber: null, notes: null });
  return { unit, tenant };
}

describe("workflow A — new rental, end to end", () => {
  beforeEach(resetTestData);

  it("keeps every figure consistent from agreement to payment", async () => {
    const { unit, tenant } = await setup();
    const ag = await createAgreement(manager, rental(unit.id, tenant.id, { startDate: thisMonth }));
    expect((await listUnits(manager)).find((u) => u.id === unit.id)?.occupancy).toBe("RENTED");

    // Billing: preview then issue; rent with cents survives exactly (no float rounding).
    const preview = await previewBilling(finance, thisMonth);
    expect(preview.invoices).toEqual([expect.objectContaining({ partyId: tenant.id, total: 3333333, dueDate: dayOfMonth(thisMonth, 1) })]);
    await issueBilling(finance, thisMonth);
    const inv = await db.invoice.findFirstOrThrow({ include: { lines: true } });
    expect(inv).toMatchObject({ agreementId: ag.id, unitId: unit.id, partyId: tenant.id, status: "ISSUED" });
    expect(inv.total.toString()).toBe("33333.33");
    expect(inv.lines.map((l) => [l.category, l.amount.toString()])).toEqual([["RENT", "33333.33"]]);

    // Payment: pending changes nothing; verified counts; allocated reduces the invoice.
    const pay = await recordPayment(manager, { partyId: tenant.id, method: "MPESA", reference: "WFA001", amount: 2000000, receivedDate: today, evidenceNote: null });
    expect((await dashboard(finance, "month")).money).toMatchObject({ collected: 0, outstanding: 3333333 });
    await verifyPayment(finance, pay.id);
    await allocatePayment(finance, pay.id, [{ invoiceId: inv.id, amount: 2000000 }]);

    const d = (await dashboard(finance, "month")).money!;
    const account = await partyFinancialSummary(tenant.id);
    const statement = await accountStatement(finance, tenant.id, thisMonth, today);
    const collections = await collectionsReport(finance, thisMonth, today);
    expect(d).toMatchObject({ billed: 3333333, rentBilled: 3333333, collected: 2000000, outstanding: 1333333, collectionRatePaid: 2000000, collectionRateBilled: 3333333 });
    expect(account).toMatchObject({ accountBalance: 1333333, invoiceBalances: 1333333, unallocated: 0 });
    expect(statement.closing).toBe(1333333);
    expect(collections.total).toBe(2000000);
    expect((await reconciliationCheck(finance)).every((r) => r.matches)).toBe(true);
    expect((await rentRoll(finance, today)).map((r) => [r.unitNumber, r.rent])).toEqual([["A-1", 3333333]]);
    expect((await occupancyReport(manager, today)).map((r) => [r.unitNumber, r.status])).toEqual([["A-1", "Rented"]]);

    // Audit trail covers each step with the acting user.
    const actions = (await db.auditEvent.findMany({ where: { entityId: { in: [unit.id, tenant.id, ag.id, inv.id, pay.id] } }, orderBy: { id: "asc" } })).map((e) => [e.action, e.actorId]);
    expect(actions).toEqual(
      expect.arrayContaining([
        ["unit.create", manager.id],
        ["account.create", admin.id],
        ["agreement.create", manager.id],
        ["payment.record", manager.id],
        ["payment.verify", finance.id],
      ]),
    );
  });

  it("issues each month only once even when two billing runs start at the same moment", async () => {
    const { unit, tenant } = await setup();
    await createAgreement(manager, rental(unit.id, tenant.id));
    const results = await Promise.allSettled([issueBilling(finance, thisMonth), issueBilling(finance, thisMonth)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.invoice.count({ where: { periodStart: new Date(`${thisMonth}T00:00:00Z`) } })).toBe(1);
  });
});

describe("workflow B — unpaid rent ages into arrears", () => {
  beforeEach(resetTestData);

  it("reports the same overdue amount, bucket and account count everywhere", async () => {
    const { unit, tenant } = await setup();
    await createAgreement(manager, rental(unit.id, tenant.id));
    // Bill three past months and leave them unpaid (stands in for advancing the clock).
    const months = [-3, -2, -1].map((k) => addMonths(thisMonth, k));
    for (const m of months) await issueBilling(finance, m);

    const expectedBuckets = months.map((m) => ageingBucket(dayOfMonth(m, 1), today));
    const arrears = await arrearsReport(finance);
    const d = (await dashboard(finance, "month")).money!;
    expect(arrears.grandTotal).toBe(3 * 3333333);
    expect(d.outstanding).toBe(3 * 3333333);
    expect(d.pastDue).toBe(3 * 3333333);
    expect(d.accountsInArrears).toBe(1);
    for (const b of new Set(expectedBuckets)) {
      const n = expectedBuckets.filter((x) => x === b).length;
      expect(arrears.totals[b]).toBe(n * 3333333);
      expect(d.ageing[b]).toBe(n * 3333333);
      expect(d.ageingCounts[b]).toBe(n);
    }
    expect(d.ageing["Not yet due"]).toBe(0);
    expect((await partyFinancialSummary(tenant.id)).accountBalance).toBe(3 * 3333333);
  });
});

describe("workflow D — agreement ending", () => {
  beforeEach(resetTestData);

  it("bills up to the end, never after it, keeps history and frees the unit", async () => {
    const { unit, tenant } = await setup();
    const ag = await createAgreement(manager, rental(unit.id, tenant.id, { startDate: addMonths(thisMonth, -3) }));
    await issueBilling(finance, addMonths(thisMonth, -3));
    await issueBilling(finance, addMonths(thisMonth, -2));
    await endAgreement(manager, ag.id, monthEnd(addMonths(thisMonth, -2)), "Tenant moved out");

    await expect(issueBilling(finance, addMonths(thisMonth, -1))).rejects.toThrow(/nothing new to invoice/);
    await expect(issueBilling(finance, thisMonth)).rejects.toThrow(/nothing new to invoice/);
    expect(await db.invoice.count({ where: { agreementId: ag.id } })).toBe(2);
    expect((await db.agreement.findUniqueOrThrow({ where: { id: ag.id } })).status).toBe("ENDED");
    expect((await listUnits(manager)).find((u) => u.id === unit.id)?.occupancy).toBe("VACANT");
    expect((await occupancyReport(manager, addMonths(thisMonth, -2))).find((r) => r.unitNumber === "A-1")?.status).toBe("Rented"); // history kept
    expect((await partyFinancialSummary(tenant.id)).accountBalance).toBe(2 * 3333333); // the debt remains
  });
});

describe("audit and activity links to records that no longer exist", () => {
  beforeEach(resetTestData);

  it("links only to records that exist, or whose removal is explained, never to a 404", async () => {
    const { unit, tenant } = await setup();
    const kept = await createParty(admin, { displayName: "Kept", phone: null, email: null, idNumber: null, notes: null });
    const gone = await createParty(admin, { displayName: "Gone", phone: null, email: null, idNumber: null, notes: null });
    await deleteParty(admin, gone.id);
    await createAgreement(manager, rental(unit.id, tenant.id, { startDate: thisMonth })); // a manual invoice needs an agreement with the unit
    const draft = await createManualInvoice(finance, { partyId: tenant.id, unitId: unit.id, agreementId: null, notes: null, dueDate: today, lines: [{ category: "OTHER", description: "Key", amount: 1000 }] });
    await discardDraftInvoice(finance, draft.id, "Entered by mistake");
    // An audit entry about a record wiped outside the application (e.g. a test reset).
    await audit(db, admin, { action: "unit.create", entityType: "Unit", entityId: "wiped-unit", summary: "Created unit X" });

    const linkable = await linkableRecords(admin, [
      { entityType: "Unit", entityId: unit.id },
      { entityType: "Party", entityId: kept.id },
      { entityType: "Party", entityId: gone.id },
      { entityType: "Invoice", entityId: draft.id },
      { entityType: "Unit", entityId: "wiped-unit" },
    ]);
    expect([...linkable.keys()].sort()).toEqual([`Invoice:${draft.id}`, `Party:${gone.id}`, `Party:${kept.id}`, `Unit:${unit.id}`].sort());
    expect(await findDiscardedInvoice(finance, draft.id)).toMatchObject({ actorEmail: finance.email, reason: "Entered by mistake" });

    const { events, linkable: auditLinks } = await listAuditEvents(admin, {});
    const wiped = events.find((e) => e.entityId === "wiped-unit")!;
    expect(auditLinks.has(`Unit:${wiped.entityId}`)).toBe(false);
    const feed = await recentActivity(admin, 20);
    expect(feed.find((i) => i.summary === "Created unit X")?.href).toBeNull();
    expect(feed.find((i) => i.entityType === "Unit" && i.summary !== "Created unit X")?.href).toBe(`/units/${unit.id}`);
  });
});

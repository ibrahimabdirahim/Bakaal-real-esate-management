// Integrity guards found by the system audit (2026-10-22): state changes that would leave units,
// agreements and charges contradicting each other or the invoices already issued.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { cancelAgreement, createAccount, createUnit, endAgreement, endAgreementCharge, updateUnit, type NewAccountInput } from "@/server/services/property";
import { issueBilling } from "@/server/services/billing";
import { recordPayment, rejectPayment, reversePayment, verifyPayment } from "@/server/services/finance";
import { approvePolicy, proposePolicy } from "@/server/services/billing";
import { createExpense, createWorkOrder, decideExpense, decideQuote, updateWorkOrder } from "@/server/services/operations";
import { addMonths, monthEnd, monthStart, todayISO } from "@/lib/dates";
import { UNIT_TYPES } from "@/lib/unit-types";

assertTestDatabase();

const admin = actor("ADMIN");
const manager = actor("MANAGER");
const finance = actor("FINANCE");
const thisMonth = monthStart(todayISO());
const lastMonth = addMonths(thisMonth, -1);
const start = addMonths(thisMonth, -3);
const docs = { account: [], agreement: [], management: [] };
const ownership = { startDate: start, purchaseDate: null, ownershipEvidence: "Sale agreement on file", reference: null, dueDay: 10, notes: null };

beforeEach(async () => {
  await resetTestData();
  await db.building.create({ data: { name: "Guard Building" } });
});

describe("unit retirement", () => {
  it("refuses to retire a unit with an agreement in force or starting later; allows it once they have ended", async () => {
    const unit = await createUnit(admin, { unitNumber: "R-1", floor: null, unitType: null, notes: null });
    const base = { unitNumber: "R-1", floor: null, unitType: null, notes: null };
    const { agreement } = await createAccount(manager, {
      party: { displayName: "Retire Tenant", phone: null, email: null, idNumber: null, notes: null }, accountType: "TENANT", unitId: unit.id,
      tenancy: { startDate: start, endDate: null, rentAmount: 1000000, dueDay: 5, graceDays: null, reference: null, lateFeeTerms: null, allocationTerms: null, notes: null }, documents: docs,
    } satisfies NewAccountInput);
    await expect(updateUnit(admin, unit.id, { ...base, isActive: false })).rejects.toThrow(/agreement in force/);
    expect((await db.unit.findUniqueOrThrow({ where: { id: unit.id } })).isActive).toBe(true);
    await updateUnit(admin, unit.id, { ...base, unitType: "Shop", isActive: true }); // other edits still work
    await endAgreement(manager, agreement.id, monthEnd(lastMonth), "Moved out");
    await updateUnit(admin, unit.id, { ...base, isActive: false });
    expect((await db.unit.findUniqueOrThrow({ where: { id: unit.id } })).isActive).toBe(false);
  });
});

describe("unit types", () => {
  it("saves each listed type or none, refuses others, and keeps a type saved before the list", async () => {
    for (const [i, t] of UNIT_TYPES.entries()) expect((await createUnit(admin, { unitNumber: `T-${i}`, floor: null, unitType: t, notes: null })).unitType).toBe(t);
    await expect(createUnit(admin, { unitNumber: "T-X", floor: null, unitType: "Studio", notes: null })).rejects.toThrow(/must be one of/);
    const old = await db.unit.create({ data: { buildingId: (await db.building.findFirstOrThrow()).id, unitNumber: "T-OLD", unitType: "Studio" } });
    const base = { unitNumber: "T-OLD", floor: null, notes: null, isActive: true };
    await updateUnit(admin, old.id, { ...base, unitType: "Studio" }); // unchanged: kept
    await expect(updateUnit(admin, old.id, { ...base, unitType: "Penthouse" })).rejects.toThrow(/must be one of/);
    expect((await updateUnit(admin, old.id, { ...base, unitType: "Store" })).unitType).toBe("Store");
    expect((await updateUnit(admin, old.id, { ...base, unitType: null })).unitType).toBeNull();
  });
});

describe("ownership behind a management agreement", () => {
  const managed = async () => {
    const unit = await createUnit(admin, { unitNumber: "M-1", floor: null, unitType: null, notes: null });
    const r = await createAccount(manager, {
      party: { displayName: "Managed Owner", phone: null, email: null, idNumber: null, notes: null }, accountType: "MANAGED", unitId: unit.id, ownership,
      management: { startDate: start, endDate: null, managementFeeAmount: 450000, dueDay: 10, graceDays: null, reference: null, notes: null }, documents: docs,
    });
    return { ownershipId: r.agreement.id, managementId: r.management!.id };
  };

  it("refuses to cancel or end the ownership record while its management agreement continues", async () => {
    const { ownershipId, managementId } = await managed();
    await expect(cancelAgreement(manager, ownershipId, "Entered in error")).rejects.toThrow(/management agreement/);
    await expect(endAgreement(manager, ownershipId, monthEnd(lastMonth), "Sold")).rejects.toThrow(/management agreement/);
    expect((await db.agreement.findUniqueOrThrow({ where: { id: ownershipId } })).status).toBe("ACTIVE");
    // End the management first; then the ownership can end on or after that date.
    await endAgreement(manager, managementId, monthEnd(lastMonth), "Owner takes over");
    await endAgreement(manager, ownershipId, monthEnd(lastMonth), "Sold");
    expect((await db.agreement.findUniqueOrThrow({ where: { id: ownershipId } })).status).toBe("ENDED");
  });
});

describe("ending an approved charge", () => {
  it("refuses an end date before months already billed with the charge", async () => {
    const unit = await createUnit(admin, { unitNumber: "C-1", floor: null, unitType: null, notes: null });
    const { agreement } = await createAccount(manager, {
      party: { displayName: "Charged Owner", phone: null, email: null, idNumber: null, notes: null }, accountType: "OWNER", unitId: unit.id, ownership,
      charges: [{ category: "SHARED_CHARGE", description: "Approved water share", amount: 80000, effectiveFrom: start, effectiveTo: null }], documents: docs,
    });
    await issueBilling(finance, lastMonth);
    const charge = await db.agreementCharge.findFirstOrThrow({ where: { agreementId: agreement.id } });
    await expect(endAgreementCharge(manager, charge.id, addMonths(lastMonth, -1))).rejects.toThrow(/already been billed/);
    expect((await db.agreementCharge.findUniqueOrThrow({ where: { id: charge.id } })).effectiveTo).toBeNull();
    await endAgreementCharge(manager, charge.id, monthEnd(lastMonth)); // after the last billed month is fine
    expect((await db.agreementCharge.findUniqueOrThrow({ where: { id: charge.id } })).effectiveTo?.toISOString().slice(0, 10)).toBe(monthEnd(lastMonth));
  });
});

describe("concurrent payment decisions", () => {
  it("verifies once, never both verifies and rejects, and reverses once", async () => {
    const unit = await createUnit(admin, { unitNumber: "P-1", floor: null, unitType: null, notes: null });
    const { party } = await createAccount(manager, {
      party: { displayName: "Payer", phone: null, email: null, idNumber: null, notes: null }, accountType: "TENANT", unitId: unit.id,
      tenancy: { startDate: start, endDate: null, rentAmount: 1000000, dueDay: 5, graceDays: null, reference: null, lateFeeTerms: null, allocationTerms: null, notes: null }, documents: docs,
    });
    const finance2 = actor("FINANCE", "finance-2");
    const pay = (ref: string) => recordPayment(manager, { partyId: party.id, method: "MPESA", reference: ref, amount: 100000, receivedDate: todayISO(), evidenceNote: null });

    const p1 = await pay("RACE-1");
    const twice = await Promise.allSettled([verifyPayment(finance, p1.id), verifyPayment(finance2, p1.id)]);
    expect(twice.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.auditEvent.count({ where: { entityId: p1.id, action: "payment.verify" } })).toBe(1);

    const p2 = await pay("RACE-2");
    const mixed = await Promise.allSettled([verifyPayment(finance, p2.id), rejectPayment(finance2, p2.id, "Not on statement")]);
    expect(mixed.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(["VERIFIED", "REJECTED"]).toContain((await db.payment.findUniqueOrThrow({ where: { id: p2.id } })).status);

    const reversals = await Promise.allSettled([reversePayment(finance, p1.id, "Bounced"), reversePayment(finance2, p1.id, "Bounced")]);
    expect(reversals.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.auditEvent.count({ where: { entityId: p1.id, action: "payment.reverse" } })).toBe(1);
    expect(await db.payment.count({ where: { receiptNumber: { not: null } } })).toBe(1 + Number((await db.payment.findUniqueOrThrow({ where: { id: p2.id } })).status === "VERIFIED"));
  });
});

describe("decisions are made once", () => {
  it("decides a work order quote once; a new quote amount needs a new decision", async () => {
    const w = await createWorkOrder(manager, { title: "Roof leak", description: null, unitId: null, location: "Roof", priority: "HIGH", reportedVia: null });
    await updateWorkOrder(manager, w.id, { status: "ASSIGNED", assignee: "Roofer", quoteAmount: 500000, outcome: null, costTreatment: null });
    await decideQuote(manager, w.id, true);
    await expect(decideQuote(manager, w.id, false)).rejects.toThrow(/already been approved/);
    expect((await db.workOrder.findUniqueOrThrow({ where: { id: w.id } })).quoteApproved).toBe(true);
    await updateWorkOrder(manager, w.id, { status: "ASSIGNED", assignee: "Roofer", quoteAmount: 650000, outcome: null, costTreatment: null }); // a revised quote
    await decideQuote(manager, w.id, false);
    expect((await db.workOrder.findUniqueOrThrow({ where: { id: w.id } })).quoteApproved).toBe(false);
    const twice = await Promise.allSettled([decideQuote(admin, w.id, true), decideQuote(manager, w.id, true)]);
    expect(twice.every((r) => r.status === "rejected")).toBe(true); // already decided
  });

  it("closes a work order once: completing and cancelling at the same moment cannot both succeed", async () => {
    const w = await createWorkOrder(manager, { title: "Gate motor", description: null, unitId: null, location: "Gate", priority: "LOW", reportedVia: null });
    await updateWorkOrder(manager, w.id, { status: "IN_PROGRESS", assignee: "Electrician", quoteAmount: null, outcome: null, costTreatment: null });
    const race = await Promise.allSettled([
      updateWorkOrder(manager, w.id, { status: "COMPLETED", assignee: "Electrician", quoteAmount: null, outcome: "Fixed", costTreatment: null }),
      updateWorkOrder(admin, w.id, { status: "CANCELLED", assignee: "Electrician", quoteAmount: null, outcome: null, costTreatment: null }),
    ]);
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("approves a building policy once, also when approved twice at the same moment", async () => {
    const p = await proposePolicy(admin, { key: "DEFAULT_DUE_DAY", value: "7", effectiveFrom: "2026-01-01", note: null });
    const twice = await Promise.allSettled([approvePolicy(admin, p.id), approvePolicy(admin, p.id)]);
    expect(twice.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.auditEvent.count({ where: { entityId: p.id, action: "policy.approve" } })).toBe(1);
  });

  it("decides an expense once, also when approved and rejected at the same moment", async () => {
    const e = await createExpense(actor("OPERATIONS"), { category: "WATER", payee: "Water", description: "Bill", amount: 100, servicePeriodStart: null, servicePeriodEnd: null, costCentre: null, evidenceNote: null, workOrderId: null, staffMemberId: null }, true);
    const race = await Promise.allSettled([decideExpense(finance, e.id, "APPROVED", null), decideExpense(admin, e.id, "REJECTED", "Duplicate")]);
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.auditEvent.count({ where: { entityId: e.id, action: { in: ["expense.approve", "expense.reject"] } } })).toBe(1);
  });
});

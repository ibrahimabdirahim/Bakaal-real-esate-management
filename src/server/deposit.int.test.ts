// Agreed deposit on a rental agreement (F52): stored with the agreement, shown with its terms, and
// nothing else — no invoice line, no payment, no balance. Only rental agreements have one.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { accountContext, createAccount, createAgreement, createUnit } from "@/server/services/property";
import { issueBilling } from "@/server/services/billing";
import { accountBalance } from "@/server/services/finance";
import { addMonths, monthStart, todayISO } from "@/lib/dates";

assertTestDatabase();

const admin = actor("ADMIN");
const manager = actor("MANAGER");
const finance = actor("FINANCE");
const today = todayISO();
const start = addMonths(monthStart(today), -2);
const docs = { account: [], agreement: [], management: [] };
const tenancy = { startDate: start, endDate: null, rentAmount: 1000000, dueDay: 5, graceDays: null, reference: null, lateFeeTerms: null, allocationTerms: null, notes: null };

beforeEach(async () => {
  await resetTestData();
  await db.building.create({ data: { name: "Deposit Building" } });
});

describe("agreed deposit", () => {
  it("is saved with the rental agreement from Add Account and shown with its terms, but never billed or counted", async () => {
    const unit = await createUnit(admin, { unitNumber: "D1", floor: null, unitType: null, notes: null });
    const { party, agreement } = await createAccount(manager, {
      party: { displayName: "Deposit Tenant", phone: "0700 300 001", email: null, idNumber: null, notes: null },
      accountType: "TENANT", unitId: unit.id, tenancy: { ...tenancy, depositAmount: 2000000 }, documents: docs,
    });
    expect(String((await db.agreement.findUniqueOrThrow({ where: { id: agreement.id } })).depositAmount)).toBe("20000");
    expect(await db.auditEvent.count({ where: { entityId: agreement.id, action: "agreement.create", after: { path: ["depositAmount"], equals: 2000000 } } })).toBe(1);
    const unitCtx = (await accountContext(finance, party.id, today))!.units[0];
    expect([unitCtx.rent?.amount, unitCtx.deposit]).toEqual([1000000, 2000000]);

    await issueBilling(finance, addMonths(monthStart(today), -1));
    const lines = await db.invoiceLine.findMany({ where: { invoice: { partyId: party.id } } });
    expect(lines.map((l) => [l.category, String(l.amount)])).toEqual([["RENT", "10000"]]); // rent only, no deposit line
    expect((await accountBalance(finance, party.id)).outstanding).toBe(1000000);
    expect(await db.payment.count()).toBe(0);
  });

  it("is optional, may be zero, and is refused when negative or on an ownership or management agreement (also by the database)", async () => {
    const [u1, u2, u3] = [await createUnit(admin, { unitNumber: "D2", floor: null, unitType: null, notes: null }), await createUnit(admin, { unitNumber: "D3", floor: null, unitType: null, notes: null }), await createUnit(admin, { unitNumber: "D4", floor: null, unitType: null, notes: null })];
    const p = await db.party.create({ data: { displayName: "Deposit Owner" } });
    const base = { unitId: u1.id, partyId: p.id, reference: null, startDate: start, endDate: null, rentAmount: null, managementFeeAmount: null, dueDay: 10, graceDays: null, purchaseDate: null, ownershipEvidence: "Sale agreement", lateFeeTerms: null, allocationTerms: null, notes: null };
    await expect(createAgreement(manager, { ...base, type: "OWNERSHIP", depositAmount: 100000 })).rejects.toThrow(/rental agreement only/);
    await expect(createAgreement(manager, { ...base, type: "RENTAL", unitId: u2.id, rentAmount: 500000, ownershipEvidence: null, depositAmount: -1 })).rejects.toThrow(/cannot be negative/);
    const none = await createAgreement(manager, { ...base, type: "RENTAL", unitId: u2.id, rentAmount: 500000, ownershipEvidence: null });
    expect(none.depositAmount).toBeNull();
    const zero = await createAgreement(manager, { ...base, type: "RENTAL", unitId: u3.id, rentAmount: 500000, ownershipEvidence: null, depositAmount: 0 });
    expect(String(zero.depositAmount)).toBe("0");
    // The database check holds even if the application were bypassed.
    await expect(db.agreement.create({ data: { buildingId: u1.buildingId, unitId: u1.id, partyId: p.id, type: "OWNERSHIP", startDate: new Date(`${start}T00:00:00Z`), ownershipEvidence: "x", depositAmount: "100.00" } })).rejects.toThrow();
    await expect(db.agreement.update({ where: { id: none.id }, data: { depositAmount: "-5.00" } })).rejects.toThrow();
  });
});

// Account lookup for forms (2026-10-23): choosing an account fills in its unit, agreement and agreed
// rent only when they are unambiguous on the date, never invents rent, keeps management fees and other
// charges apart, is permission-checked, and changes nothing. Manual invoices refuse an account/unit pair
// that has no agreement, whatever the form submitted.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { accountContext, createAccount, createUnit, endAgreement, type NewAccountInput } from "@/server/services/property";
import { issueBilling } from "@/server/services/billing";
import { createManualInvoice } from "@/server/services/finance";
import { chooseUnit } from "@/lib/account-context";
import { addDays, addMonths, monthEnd, monthStart, todayISO } from "@/lib/dates";

assertTestDatabase();

const admin = actor("ADMIN");
const manager = actor("MANAGER");
const finance = actor("FINANCE");
const today = todayISO();
const thisMonth = monthStart(today);
const start = addMonths(thisMonth, -2);
const docs = { account: [], agreement: [], management: [] };
const ownership = { startDate: start, purchaseDate: null, ownershipEvidence: "Sale agreement on file", reference: "OWN-1", dueDay: 10, notes: null };
const tenancy = (rent: number, from = start, to: string | null = null) => ({ startDate: from, endDate: to, rentAmount: rent, dueDay: 5, graceDays: null, reference: "RA-1", lateFeeTerms: null, allocationTerms: null, notes: null });
const person = (name: string, phone: string) => ({ displayName: name, phone, email: null, idNumber: null, notes: null });

beforeEach(async () => {
  await resetTestData();
  await db.building.create({ data: { name: "Lookup Building" } });
});

const unit = (n: string) => createUnit(admin, { unitNumber: n, floor: null, unitType: null, notes: null });
const account = (input: Omit<NewAccountInput, "documents">) => createAccount(manager, { ...input, documents: docs });

describe("account lookup", () => {
  it("fills in the one unit, its rental agreement and the agreed rent; other charges are listed apart", async () => {
    const u = await unit("H1");
    const { party, agreement } = await account({
      party: person("One Unit", "0700 100 001"), accountType: "TENANT", unitId: u.id, tenancy: tenancy(1000000),
      charges: [{ category: "SERVICE_CHARGE", description: "Approved service charge", amount: 100000, effectiveFrom: start, effectiveTo: null }],
    });
    const ctx = (await accountContext(finance, party.id, today))!;
    const choice = chooseUnit(ctx);
    expect(choice.kind).toBe("one");
    if (choice.kind !== "one") return;
    expect(choice.unit).toMatchObject({ unitId: u.id, unitNumber: "H1", inForce: true, agreement: { id: agreement.id, type: "RENTAL", reference: "RA-1" }, rent: { amount: 1000000, agreementId: agreement.id }, managementFee: null });
    expect(choice.unit.charges).toEqual([{ description: "Approved service charge", category: "SERVICE_CHARGE", amount: 100000 }]);
  });

  it("asks for the unit when the account has several, and offers only that account's units", async () => {
    const [a, b] = [await unit("A1"), await unit("A2")];
    await unit("NOT-MINE");
    const { party } = await account({ party: person("Two Units", "0700 100 002"), accountType: "TENANT", unitId: a.id, tenancy: tenancy(500000) });
    await createAccount(manager, { party: person("Someone Else", "0700 100 003"), accountType: "TENANT", unitId: b.id, tenancy: tenancy(600000), documents: docs });
    // A second rental for the same account on another unit (A2 belongs to someone else and is not offered).
    const c = await unit("A3");
    await db.agreement.create({ data: { buildingId: c.buildingId, unitId: c.id, partyId: party.id, type: "RENTAL", startDate: new Date(`${start}T00:00:00Z`), rentAmount: "7000.00", dueDay: 5 } });
    const choice = chooseUnit((await accountContext(finance, party.id, today))!);
    expect(choice.kind).toBe("many");
    if (choice.kind === "many") expect(choice.units.map((x) => [x.unitNumber, x.rent?.amount])).toEqual([["A1", 500000], ["A3", 700000]]);
  });

  it("invents no rent: none for an owner, the management fee (apart) for a managed unit, nothing for an account without agreements", async () => {
    const [o, m, m2] = [await unit("O1"), await unit("M1"), await unit("M2")];
    const owner = await account({ party: person("Owner", "0700 100 004"), accountType: "OWNER", unitId: o.id, ownership });
    const managed = await account({ party: person("Managed", "0700 100 005"), accountType: "MANAGED", unitId: m.id, ownership, management: { startDate: start, endDate: null, managementFeeAmount: 450000, dueDay: 10, graceDays: null, reference: "MG-1", notes: null } });
    const noFee = await account({ party: person("Managed No Fee", "0700 100 006"), accountType: "MANAGED", unitId: m2.id, ownership, management: { startDate: start, endDate: null, managementFeeAmount: null, dueDay: 10, graceDays: null, reference: null, notes: null } });
    const empty = await db.party.create({ data: { displayName: "No Agreements" } });

    const own = chooseUnit((await accountContext(finance, owner.party.id, today))!);
    expect(own.kind === "one" && [own.unit.agreement?.type, own.unit.rent, own.unit.managementFee]).toEqual(["OWNERSHIP", null, null]);
    const man = chooseUnit((await accountContext(finance, managed.party.id, today))!);
    expect(man.kind === "one" && [man.unit.agreement?.type, man.unit.rent, man.unit.managementFee?.amount]).toEqual(["MANAGEMENT", null, 450000]);
    const nf = chooseUnit((await accountContext(finance, noFee.party.id, today))!);
    expect(nf.kind === "one" && nf.unit.managementFee).toEqual({ amount: null, agreementId: noFee.management!.id }); // flagged, not invented
    expect(chooseUnit((await accountContext(finance, empty.id, today))!)).toEqual({ kind: "none" });
  });

  it("uses the agreement in force on the date: an ended or future agreement is not filled in as current", async () => {
    const u = await unit("D1");
    const { party, agreement } = await account({ party: person("Dated", "0700 100 007"), accountType: "TENANT", unitId: u.id, tenancy: tenancy(800000) });
    await endAgreement(manager, agreement.id, monthEnd(addMonths(thisMonth, -1)), "Moved out");
    expect(chooseUnit((await accountContext(finance, party.id, addMonths(thisMonth, -1)))!).kind).toBe("one"); // last month: in force
    const now = chooseUnit((await accountContext(finance, party.id, today))!);
    expect(now.kind).toBe("notInForce"); // offered for a final settlement, but not filled in
    if (now.kind === "notInForce") expect([now.units[0].rent, now.units[0].agreement?.id, now.units[0].inForce]).toEqual([null, agreement.id, false]);
    expect(chooseUnit((await accountContext(finance, party.id, addDays(start, -1)))!).kind).toBe("notInForce"); // before it started
  });

  it("is refused to roles without account and agreement access, and hides amounts from roles without invoice access", async () => {
    const u = await unit("P1");
    const { party } = await account({ party: person("Private", "0700 100 008"), accountType: "TENANT", unitId: u.id, tenancy: tenancy(900000) });
    await expect(accountContext(actor("OPERATIONS"), party.id, today)).rejects.toThrow(/permission/);
    const auditor = (await accountContext(actor("AUDITOR"), party.id, today))!;
    expect(auditor.amountsShown).toBe(true); // read-only roles see invoices
    expect(await accountContext(finance, "no-such-account", today)).toBeNull();
  });

  it("changes nothing: no invoice, payment, allocation or audit entry, and issued invoices keep their amounts", async () => {
    const u = await unit("N1");
    const { party } = await account({ party: person("Untouched", "0700 100 009"), accountType: "TENANT", unitId: u.id, tenancy: tenancy(1000000) });
    await issueBilling(finance, addMonths(thisMonth, -1));
    const snapshot = async () => JSON.stringify(await Promise.all([db.invoice.findMany({ include: { lines: true } }), db.payment.count(), db.paymentAllocation.count(), db.auditEvent.count()]));
    const before = await snapshot();
    await accountContext(finance, party.id, today);
    await accountContext(manager, party.id, addMonths(today, -1));
    expect(await snapshot()).toBe(before);
  });
});

describe("manual invoice account and unit", () => {
  it("refuses a unit the account has no agreement on, and an agreement that does not match the account and unit", async () => {
    const [mine, other] = [await unit("M-1"), await unit("X-1")];
    const { party, agreement } = await account({ party: person("Invoiced", "0700 100 010"), accountType: "TENANT", unitId: mine.id, tenancy: tenancy(1000000) });
    const theirs = await createAccount(manager, { party: person("Other", "0700 100 011"), accountType: "TENANT", unitId: other.id, tenancy: tenancy(500000), documents: docs });
    const draft = (unitId: string, agreementId: string | null, partyId = party.id) =>
      createManualInvoice(finance, { partyId, unitId, agreementId, notes: null, dueDate: today, lines: [{ category: "OTHER", description: "Key replacement", amount: 150000 }] });

    await expect(draft(other.id, null)).rejects.toThrow(/no agreement on the selected unit/);
    await expect(draft(other.id, theirs.agreement.id)).rejects.toThrow(/does not match/);
    await expect(draft(mine.id, theirs.agreement.id)).rejects.toThrow(/does not match/);
    expect(await db.invoice.count({ where: { kind: "MANUAL" } })).toBe(0);

    const ok = await draft(mine.id, agreement.id);
    expect(ok).toMatchObject({ partyId: party.id, unitId: mine.id, agreementId: agreement.id, status: "DRAFT" });
  });
});

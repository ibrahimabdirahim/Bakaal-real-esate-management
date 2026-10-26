// The three account types of the Add Account form: what each creates, what it may be
// charged, and that rent / rental agreements never appear where they do not belong.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { PermissionError } from "@/server/auth/actor";
import { createAccount, createUnit, listParties, missingTermsFor, type NewAccountInput } from "@/server/services/property";
import { issueBilling, previewBilling } from "@/server/services/billing";
import { occupancyReport } from "@/server/services/reports";
import { addMonths, monthStart, todayISO } from "@/lib/dates";

assertTestDatabase();

const admin = actor("ADMIN");
const manager = actor("MANAGER");
const finance = actor("FINANCE");
const operations = actor("OPERATIONS");
const auditor = actor("AUDITOR");

const today = todayISO();
const lastMonth = addMonths(monthStart(today), -1);
const noDocs = { account: [], agreement: [], management: [] };
const party = (name: string) => ({ displayName: name, phone: null, email: null, idNumber: null, notes: null });
const ownership = (over = {}) => ({ startDate: addMonths(lastMonth, -2), purchaseDate: addMonths(lastMonth, -3), ownershipEvidence: "Sale agreement SA-9", reference: null, dueDay: 5, notes: null, ...over });
const shared = (over = {}) => ({ category: "SHARED_CHARGE" as const, description: "Approved water share", amount: 150000, effectiveFrom: lastMonth, effectiveTo: null, ...over });

let units: { id: string }[] = [];
beforeEach(async () => {
  await resetTestData();
  await db.building.create({ data: { name: "Types Building" } });
  units = await Promise.all(["A-1", "A-2", "A-3", "A-4"].map((n) => createUnit(manager, { unitNumber: n, floor: null, unitType: null, notes: null })));
});

const tenantInput = (over: Partial<NewAccountInput> = {}): NewAccountInput => ({
  party: party("Tenant T"),
  accountType: "TENANT",
  unitId: units[0].id,
  tenancy: { startDate: lastMonth, endDate: null, rentAmount: 3000000, dueDay: 5, graceDays: null, reference: "RA-1", lateFeeTerms: null, allocationTerms: null, notes: null },
  charges: [{ ...shared(), category: "SERVICE_CHARGE", description: "Approved service charge", amount: 200000 }],
  documents: noDocs,
  ...over,
});
const ownerInput = (over: Partial<NewAccountInput> = {}): NewAccountInput => ({ party: party("Owner O"), accountType: "OWNER", unitId: units[1].id, ownership: ownership(), charges: [shared()], documents: noDocs, ...over });
const managedInput = (over: Partial<NewAccountInput> = {}): NewAccountInput => ({
  party: party("Managed M"),
  accountType: "MANAGED",
  unitId: units[2].id,
  ownership: ownership({ dueDay: null }),
  management: { startDate: addMonths(lastMonth, -1), endDate: null, managementFeeAmount: 500000, dueDay: 10, graceDays: null, reference: "MA-1", notes: null },
  charges: [shared()],
  documents: noDocs,
  ...over,
});

const linesFor = async (partyId: string) => {
  await issueBilling(finance, lastMonth).catch(() => undefined);
  const invoices = await db.invoice.findMany({ where: { partyId }, include: { lines: true } });
  return invoices.flatMap((i) => i.lines.map((l) => [l.category, l.amount.toString()]));
};

describe("Rent-Paying Tenant", () => {
  it("creates one rental agreement with rent and its approved service charge, billed as separate lines", async () => {
    const { party: p, agreement, management } = await createAccount(manager, tenantInput());
    expect(management).toBeNull();
    expect(await db.agreement.findMany({ where: { partyId: p.id }, select: { type: true } })).toEqual([{ type: "RENTAL" }]);
    expect(await db.agreementCharge.findMany({ where: { agreementId: agreement.id }, select: { category: true } })).toEqual([{ category: "SERVICE_CHARGE" }]);
    expect((await linesFor(p.id)).sort()).toEqual([["RENT", "30000"], ["SERVICE_CHARGE", "2000"]]);
  });

  it("requires the rental terms by the existing rules", async () => {
    await expect(createAccount(manager, tenantInput({ tenancy: undefined }))).rejects.toThrow(/rental agreement details/);
    await expect(createAccount(manager, tenantInput({ tenancy: { ...tenantInput().tenancy!, rentAmount: null } }))).rejects.toThrow(/monthly rent amount/);
    expect(await db.party.count()).toBe(0);
  });
});

describe("Purchased Unit Owner", () => {
  it("creates only an ownership record: no rental agreement and no rent, only approved shared charges", async () => {
    const { party: p, agreement, management } = await createAccount(manager, ownerInput());
    expect(management).toBeNull();
    expect(agreement).toMatchObject({ type: "OWNERSHIP", rentAmount: null, managementFeeAmount: null, ownershipEvidence: "Sale agreement SA-9" });
    expect(await db.agreement.count({ where: { partyId: p.id, type: { in: ["RENTAL", "MANAGEMENT"] } } })).toBe(0);
    expect(await linesFor(p.id)).toEqual([["SHARED_CHARGE", "1500"]]);
    expect((await occupancyReport(manager, today)).find((r) => r.unitNumber === "A-2")?.status).toBe("Purchased (owner)");
  });

  it("bills nothing at all when no shared charge is approved", async () => {
    const { party: p } = await createAccount(manager, ownerInput({ charges: [] }));
    const preview = await previewBilling(finance, lastMonth);
    expect(preview.invoices.filter((i) => i.partyId === p.id)).toEqual([]);
    expect(preview.nothingToBill.some((n) => n.partyName === "Owner O")).toBe(true);
  });

  it("requires ownership evidence and refuses rent or fee-type charges", async () => {
    await expect(createAccount(manager, ownerInput({ ownership: ownership({ ownershipEvidence: null }) }))).rejects.toThrow(/ownership evidence/);
    await expect(createAccount(manager, ownerInput({ ownership: undefined }))).rejects.toThrow(/ownership record/);
    const rentLike = { ...shared(), category: "RENT" } as unknown as ReturnType<typeof shared>;
    await expect(createAccount(manager, ownerInput({ charges: [rentLike] }))).rejects.toThrow(/Only service or shared charges/);
    const feeLike = { ...shared(), category: "MANAGEMENT_FEE" } as unknown as ReturnType<typeof shared>;
    await expect(createAccount(manager, ownerInput({ charges: [feeLike] }))).rejects.toThrow(/Only service or shared charges/);
    await expect(createAccount(manager, ownerInput({ charges: [shared({ effectiveFrom: "2000-01-01" })] }))).rejects.toThrow(/before its agreement starts/);
    await expect(createAccount(manager, ownerInput({ charges: [shared({ amount: 0 })] }))).rejects.toThrow(/positive amount/);
    expect(await db.party.count()).toBe(0);
  });
});

describe("Purchased Unit Managed by BAKAAL", () => {
  it("creates ownership plus a management agreement; bills the agreed fee and shared charges, never rent", async () => {
    const { party: p, agreement, management } = await createAccount(manager, managedInput());
    expect(agreement).toMatchObject({ type: "OWNERSHIP", rentAmount: null });
    expect(management).toMatchObject({ type: "MANAGEMENT", rentAmount: null, reference: "MA-1" });
    expect(management!.managementFeeAmount!.toString()).toBe("5000");
    expect(await db.agreement.count({ where: { partyId: p.id, type: "RENTAL" } })).toBe(0);
    expect(await db.agreementCharge.count({ where: { agreementId: agreement.id } })).toBe(0); // charges go on the management agreement
    expect((await linesFor(p.id)).sort()).toEqual([["MANAGEMENT_FEE", "5000"], ["SHARED_CHARGE", "1500"]]);
    expect((await occupancyReport(manager, today)).find((r) => r.unitNumber === "A-3")?.status).toBe("Purchased (managed by BAKAAL)");
  });

  it("flags a missing management fee for review instead of inventing one", async () => {
    const input = managedInput({ management: { ...managedInput().management!, managementFeeAmount: null }, charges: [] });
    expect(missingTermsFor(input)).toEqual([expect.stringMatching(/No monthly management fee/)]);
    const { party: p, flags } = await createAccount(manager, input);
    expect(flags).toHaveLength(1);
    expect(await linesFor(p.id)).toEqual([]);
  });

  it("requires the management agreement, starting no earlier than the ownership", async () => {
    await expect(createAccount(manager, managedInput({ management: undefined }))).rejects.toThrow(/management agreement/);
    await expect(createAccount(manager, managedInput({ management: { ...managedInput().management!, startDate: addMonths(lastMonth, -6) } }))).rejects.toThrow(/cannot start before the owner's ownership/);
    await expect(createAccount(manager, managedInput({ ownership: ownership({ ownershipEvidence: null }) }))).rejects.toThrow(/ownership evidence/);
    expect(await db.agreement.count()).toBe(0);
  });
});

describe("account types across the application", () => {
  it("shows the right type in the register and filters by it", async () => {
    await createAccount(manager, tenantInput());
    await createAccount(manager, ownerInput());
    await createAccount(manager, managedInput());
    const all = await listParties(manager);
    expect(all.map((p) => [p.displayName, p.category]).sort()).toEqual([
      ["Managed M", "Purchased unit managed by BAKAAL"],
      ["Owner O", "Purchased unit owner"],
      ["Tenant T", "Rent-paying tenant"],
    ]);
    expect((await listParties(manager, undefined, { type: "OWNER" })).map((p) => p.displayName)).toEqual(["Owner O"]);
    expect((await listParties(manager, undefined, { type: "MANAGED" })).map((p) => p.displayName)).toEqual(["Managed M"]);
    expect((await listParties(manager, undefined, { type: "NONE" }))).toEqual([]);
  });

  it("is limited to roles that manage both accounts and agreements", async () => {
    for (const who of [finance, operations, auditor]) await expect(createAccount(who, tenantInput())).rejects.toBeInstanceOf(PermissionError);
    await createAccount(admin, ownerInput());
    expect(await db.party.count()).toBe(1);
  });

  it("rejects an unknown account type", async () => {
    await expect(createAccount(manager, tenantInput({ accountType: "LANDLORD" as never }))).rejects.toThrow(/Choose an account type/);
  });
});

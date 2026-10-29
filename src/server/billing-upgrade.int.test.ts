// Billing & Payments upgrade (F65): billing by charge type, each recurring charge at most once per
// month (database-enforced), the first invoice issued with a new account, bulk billing for chosen
// accounts, and the summary figures — all from the one shared calculation.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { createAccount, createUnit, endAgreementCharge, type NewAccountInput } from "@/server/services/property";
import { issueBilling, previewBilling } from "@/server/services/billing";
import { approvePolicy, proposePolicy } from "@/server/services/billing";
import { allocatePayment, billingSummary, createCreditNote, createManualInvoice, getInvoice, listInvoices, recordPayment } from "@/server/services/finance";
import { addMonths, monthEnd, monthStart, todayISO } from "@/lib/dates";

assertTestDatabase();

const admin = actor("ADMIN");
const manager = actor("MANAGER");
const finance = actor("FINANCE");
const operations = actor("OPERATIONS");
const auditor = actor("AUDITOR");
const today = todayISO();
const thisMonth = monthStart(today);
const lastMonth = addMonths(thisMonth, -1);
const noDocs = { account: [], agreement: [], management: [] };
const party = (name: string) => ({ displayName: name, phone: null, email: null, idNumber: null, notes: null });

let units: { id: string }[] = [];
beforeEach(async () => {
  await resetTestData();
  await db.building.create({ data: { name: "Billing Building" } });
  units = await Promise.all(["B-1", "B-2", "B-3", "B-4", "B-5"].map((n) => createUnit(manager, { unitNumber: n, floor: null, unitType: null, notes: null })));
});

const tenant = (over: Partial<NewAccountInput> = {}, start = lastMonth): NewAccountInput => ({
  party: party("Tenant T"),
  accountType: "TENANT",
  unitId: units[0].id,
  tenancy: { startDate: start, endDate: null, rentAmount: 3000000, dueDay: 5, graceDays: 3, reference: "RA-1", lateFeeTerms: null, allocationTerms: null, notes: null },
  charges: [
    { category: "SERVICE_CHARGE", description: "Service charge", amount: 200000, effectiveFrom: start, effectiveTo: null },
    { category: "SHARED_CHARGE", description: "Water share", amount: 150000, effectiveFrom: start, effectiveTo: null },
  ],
  documents: noDocs,
  ...over,
});
const owner = (over: Partial<NewAccountInput> = {}, start = lastMonth): NewAccountInput => ({
  party: party("Owner O"),
  accountType: "OWNER",
  unitId: units[1].id,
  ownership: { startDate: start, purchaseDate: start, ownershipEvidence: "Sale agreement", reference: null, dueDay: 10, notes: null },
  charges: [{ category: "SHARED_CHARGE", description: "Water share", amount: 120000, effectiveFrom: start, effectiveTo: null }],
  documents: noDocs,
  ...over,
});
const managed = (fee: number | null, over: Partial<NewAccountInput> = {}, start = lastMonth): NewAccountInput => ({
  party: party("Managed M"),
  accountType: "MANAGED",
  unitId: units[2].id,
  ownership: { startDate: start, purchaseDate: start, ownershipEvidence: "Sale agreement", reference: null, dueDay: null, notes: null },
  management: { startDate: start, endDate: null, managementFeeAmount: fee, dueDay: 10, graceDays: null, reference: "MA-1", notes: null },
  charges: [],
  documents: noDocs,
  ...over,
});
const lines = async (partyId: string, periodStart = lastMonth) =>
  (await db.invoice.findMany({ where: { partyId, periodStart: new Date(`${periodStart}T00:00:00Z`) }, include: { lines: true }, orderBy: { number: "asc" } })).flatMap((i) => i.lines.map((l) => `${l.category}:${l.amount.toString()}`)).sort();

describe("the first invoice when an account is added", () => {
  it("issues this month's rent, service and shared charges with the account, in one step", async () => {
    const r = await createAccount(admin, { ...tenant({}, thisMonth), billNow: true });
    expect(r.firstBilling?.invoices).toHaveLength(1);
    expect(await lines(r.party.id, thisMonth)).toEqual(["RENT:30000", "SERVICE_CHARGE:2000", "SHARED_CHARGE:1500"]);
    const inv = await db.invoice.findFirstOrThrow({ where: { partyId: r.party.id }, include: { billingRun: true } });
    expect(inv).toMatchObject({ status: "ISSUED", kind: "RECURRING", dueDate: new Date(`${thisMonth.slice(0, 8)}05T00:00:00Z`) });
    expect(inv.billingRun).toMatchObject({ source: "REGISTRATION", partyIds: [r.party.id], invoiceCount: 1 });
    expect(await db.auditEvent.count({ where: { action: "billing.issue_registration", entityId: inv.billingRunId! } })).toBe(1);
    // A bulk run for the same month later skips what the registration already billed.
    await expect(issueBilling(finance, thisMonth)).rejects.toThrow(/nothing new to invoice.*1 already billed/);
    expect(await db.invoice.count({ where: { partyId: r.party.id } })).toBe(1);
  });

  it("bills an owner only the approved shared charge, and a managed owner the agreed fee, never rent", async () => {
    const o = await createAccount(admin, { ...owner({}, thisMonth), billNow: true });
    expect(await lines(o.party.id, thisMonth)).toEqual(["SHARED_CHARGE:1200"]);
    const m2 = await createAccount(admin, { ...managed(500000, {}, thisMonth), billNow: true });
    expect(await lines(m2.party.id, thisMonth)).toEqual(["MANAGEMENT_FEE:5000"]);
  });

  it("flags instead of guessing: a mid-month start, or a managed unit without a fee, issues nothing", async () => {
    const midMonth = today.slice(8) === "01" ? null : today; // on the 1st every start this month is a whole month
    if (midMonth) {
      const r = await createAccount(admin, { ...tenant({}, midMonth), billNow: true });
      expect(r.firstBilling).toMatchObject({ invoices: [], run: null });
      expect(r.firstBilling!.preview.exceptions).toEqual([expect.objectContaining({ code: "PARTIAL_PERIOD" })]);
      expect(await db.party.count({ where: { id: r.party.id } })).toBe(1); // the account is still saved
    }
    const m = await createAccount(admin, { ...managed(null, { unitId: units[3].id }, thisMonth), billNow: true });
    expect(m.firstBilling).toMatchObject({ invoices: [], review: 1 });
    expect(await db.invoice.count({ where: { partyId: m.party.id } })).toBe(0);
  });

  it("issues nothing for a role that may not issue billing, or when not asked", async () => {
    const r = await createAccount(manager, { ...tenant({}, thisMonth), billNow: true });
    expect(r.firstBilling).toBeNull();
    const r2 = await createAccount(admin, { ...tenant({ unitId: units[3].id, party: party("Second") }, thisMonth) });
    expect(r2.firstBilling).toBeNull();
    expect(await db.invoice.count()).toBe(0);
  });

  it("saves neither the account nor any invoice when the first billing fails", async () => {
    // Another account's manual invoice takes the next invoice number; the counter is then put back, so the
    // registration's invoice number collides and its transaction fails part-way through.
    const other = await createAccount(admin, tenant({ unitId: units[4].id, party: party("Other") }));
    await createManualInvoice(admin, { partyId: other.party.id, unitId: units[4].id, agreementId: other.agreement.id, notes: null, dueDate: today, lines: [{ category: "OTHER", description: "Key", amount: 10000 }] }, { issue: true });
    const year = today.slice(0, 4);
    await db.$executeRawUnsafe(`UPDATE "DocumentSequence" SET "nextValue" = "nextValue" - 1 WHERE key = 'INV-${year}'`);
    const before = { parties: await db.party.count(), invoices: await db.invoice.count(), billed: await db.billedCharge.count(), runs: await db.billingRun.count(), agreements: await db.agreement.count() };
    await expect(createAccount(admin, { ...tenant({}, thisMonth), billNow: true })).rejects.toThrow();
    expect({ parties: await db.party.count(), invoices: await db.invoice.count(), billed: await db.billedCharge.count(), runs: await db.billingRun.count(), agreements: await db.agreement.count() }).toEqual(before);
  });
});

describe("each recurring charge is billed at most once per month", () => {
  it("bills charge types separately without ever repeating one, and a full run afterwards adds only the rest", async () => {
    const t = await createAccount(admin, tenant());
    await issueBilling(finance, lastMonth, { categories: ["RENT"] });
    expect(await lines(t.party.id)).toEqual(["RENT:30000"]);
    await expect(issueBilling(finance, lastMonth, { categories: ["RENT"] })).rejects.toThrow(/nothing new/);
    const { invoices } = await issueBilling(finance, lastMonth);
    expect(invoices).toHaveLength(1);
    expect(await lines(t.party.id)).toEqual(["RENT:30000", "SERVICE_CHARGE:2000", "SHARED_CHARGE:1500"]);
    await expect(issueBilling(finance, lastMonth)).rejects.toThrow(/nothing new/);
    expect(await db.invoice.count({ where: { partyId: t.party.id } })).toBe(2);
    expect(await db.billedCharge.count({ where: { agreementId: t.agreement.id } })).toBe(3);
  });

  it("creates one invoice per charge even when two runs are started at the same moment", async () => {
    const t = await createAccount(admin, tenant());
    const both = await Promise.allSettled([issueBilling(finance, lastMonth), issueBilling(admin, lastMonth)]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await lines(t.party.id)).toEqual(["RENT:30000", "SERVICE_CHARGE:2000", "SHARED_CHARGE:1500"]);
  });

  it("continues an interrupted run on retry: only what is still unbilled, the same total as one run", async () => {
    const a = await createAccount(admin, tenant());
    const b = await createAccount(admin, owner());
    // A run that got as far as the rent (as if it had stopped part-way) …
    await issueBilling(finance, lastMonth, { categories: ["RENT"] });
    // … and the retry of the full run.
    await issueBilling(finance, lastMonth);
    const total = (await db.invoice.findMany({ where: { periodStart: new Date(`${lastMonth}T00:00:00Z`) } })).reduce((s, i) => s + Number(i.total), 0);
    expect(total).toBe(30000 + 2000 + 1500 + 1200);
    expect([...(await lines(a.party.id)), ...(await lines(b.party.id))].sort()).toEqual(["RENT:30000", "SERVICE_CHARGE:2000", "SHARED_CHARGE:1200", "SHARED_CHARGE:1500"]);
  });

  it("is enforced by the database, and billed charges cannot be changed or removed", async () => {
    const t = await createAccount(admin, tenant());
    await issueBilling(finance, lastMonth, { categories: ["RENT"] });
    const row = await db.billedCharge.findFirstOrThrow({ where: { agreementId: t.agreement.id } });
    const inv = await db.invoice.findFirstOrThrow({ where: { partyId: t.party.id } });
    await expect(db.billedCharge.create({ data: { agreementId: row.agreementId, periodStart: row.periodStart, category: "RENT", sourceType: row.sourceType, sourceId: row.sourceId, invoiceId: inv.id, amount: "1.00" } })).rejects.toThrow();
    await expect(db.billedCharge.update({ where: { id: row.id }, data: { amount: "1.00" } })).rejects.toThrow(/billed charges are permanent/);
    await expect(db.billedCharge.delete({ where: { id: row.id } })).rejects.toThrow(/billed charges are permanent/);
  });

  it("bills only the chosen accounts", async () => {
    const t = await createAccount(admin, tenant());
    const o = await createAccount(admin, owner());
    const preview = await previewBilling(finance, lastMonth, { partyIds: [o.party.id] });
    expect(preview.invoices.map((i) => i.partyId)).toEqual([o.party.id]);
    const { run } = await issueBilling(finance, lastMonth, { partyIds: [o.party.id], categories: ["SHARED_CHARGE"] });
    expect(await db.billingRun.findUniqueOrThrow({ where: { id: run!.id } })).toMatchObject({ partyIds: [o.party.id], chargeTypes: ["SHARED_CHARGE"], invoiceCount: 1, alreadyBilledCount: 0 });
    expect(await db.invoice.count({ where: { partyId: t.party.id } })).toBe(0);
    await expect(previewBilling(finance, lastMonth, { categories: ["NOT_A_TYPE" as "RENT"] })).rejects.toThrow(/valid charge types/);
  });

  it("takes the due date from the agreement, else an approved policy, and holds it when neither gives one", async () => {
    const t = await createAccount(admin, tenant({ tenancy: { ...tenant().tenancy!, dueDay: null } }));
    expect((await previewBilling(finance, lastMonth)).exceptions).toEqual([expect.objectContaining({ code: "NO_DUE_DATE", partyId: t.party.id })]);
    const p = await proposePolicy(admin, { key: "DEFAULT_DUE_DAY", value: "7", effectiveFrom: addMonths(lastMonth, -1), note: null });
    await approvePolicy(admin, p.id);
    expect((await previewBilling(finance, lastMonth)).invoices[0]).toMatchObject({ dueDate: `${lastMonth.slice(0, 8)}07`, dueDateSource: "BUILDING_POLICY" });
  });
});

describe("balances, history and the summary figures", () => {
  it("keeps issued invoices as issued when the charges change later", async () => {
    const t = await createAccount(admin, tenant());
    await issueBilling(finance, lastMonth);
    const before = await db.invoice.findFirstOrThrow({ where: { partyId: t.party.id }, include: { lines: true } });
    const water = await db.agreementCharge.findFirstOrThrow({ where: { agreementId: t.agreement.id, category: "SHARED_CHARGE" } });
    await endAgreementCharge(manager, water.id, monthEnd(lastMonth));
    const after = await db.invoice.findFirstOrThrow({ where: { id: before.id }, include: { lines: true } });
    expect([after.total.toString(), after.lines.length]).toEqual([before.total.toString(), before.lines.length]);
    expect((await previewBilling(finance, thisMonth)).invoices[0]?.lines.map((l) => l.category) ?? []).not.toContain("SHARED_CHARGE");
  });

  it("reduces the outstanding balance by allocated payments and credits only, each counted once", async () => {
    const t = await createAccount(admin, tenant());
    const t2 = await createAccount(admin, tenant({ unitId: units[3].id, party: { ...party("Tenant T"), displayName: "Tenant T" } }));
    await issueBilling(finance, lastMonth);
    const inv = await db.invoice.findFirstOrThrow({ where: { partyId: t.party.id } });
    const pay = (reference: string, amount: number) => recordPayment(finance, { partyId: t.party.id, method: "MPESA", reference, amount, receivedDate: today, evidenceNote: null }, { verify: true });
    const p1 = await pay("PART-1", 1000000);
    await allocatePayment(finance, p1.id, [{ invoiceId: inv.id, amount: 1000000 }]);
    await expect(allocatePayment(finance, p1.id, [{ invoiceId: inv.id, amount: 1 }])).rejects.toThrow(); // nothing left to allocate twice
    await createCreditNote(finance, inv.id, 50000, "Agreed discount");
    await pay("UNALLOC-1", 700000); // received, not allocated: reduces no invoice
    expect((await getInvoice(finance, inv.id))!.summary).toMatchObject({ total: 3350000, allocated: 1000000, credited: 50000, balance: 2300000, paymentStatus: "PART_PAID" });

    const s = await billingSummary(finance, { from: lastMonth, to: monthEnd(lastMonth) });
    expect(s).toMatchObject({ tenants: 2, billed: 6700000, invoiceCount: 2, paid: 1000000, credited: 50000, periodOutstanding: 5650000, outstanding: 5650000, unallocated: 700000 });
    expect((await billingSummary(finance, { from: thisMonth, to: today })).billed).toBe(0);
    // The same tenant on two units is one tenant.
    expect(t2.party.id).not.toBe(t.party.id);

    const p2 = await pay("FULL-1", 2300000);
    await allocatePayment(finance, p2.id, [{ invoiceId: inv.id, amount: 2300000 }]);
    expect((await getInvoice(finance, inv.id))!.summary).toMatchObject({ balance: 0, paymentStatus: "PAID" });
  });

  it("filters and sorts the invoice list by unit, account type, charge type, outstanding and due date", async () => {
    const t = await createAccount(admin, tenant());
    const o = await createAccount(admin, owner());
    await issueBilling(finance, lastMonth);
    const ids = async (f: Parameters<typeof listInvoices>[1]) => (await listInvoices(finance, f)).map((i) => i.party.id);
    expect(await ids({ agreementType: "OWNERSHIP" })).toEqual([o.party.id]);
    expect(await ids({ category: "RENT" })).toEqual([t.party.id]);
    expect(await ids({ unitId: units[1].id })).toEqual([o.party.id]);
    expect(await ids({ minBalance: 2000000 })).toEqual([t.party.id]);
    expect(await ids({ sort: "balance" })).toEqual([t.party.id, o.party.id]);
    expect(await ids({ dueFrom: `${lastMonth.slice(0, 8)}06`, dueTo: monthEnd(lastMonth) })).toEqual([o.party.id]); // due on the 10th
    expect((await listInvoices(finance, { category: "RENT" }))[0].chargeTypes).toEqual(["RENT", "SERVICE_CHARGE", "SHARED_CHARGE"]);
  });

  it("refuses billing to roles that may not issue it", async () => {
    await createAccount(admin, tenant());
    for (const who of [manager, operations, auditor]) await expect(issueBilling(who, lastMonth)).rejects.toThrow(/permission/);
    await expect(previewBilling(operations, lastMonth)).rejects.toThrow(/permission/);
    expect(await db.invoice.count()).toBe(0);
  });
});

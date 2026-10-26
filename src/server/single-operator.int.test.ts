// Single-operator Billing & Payments (F49): someone who may both create and issue invoices, or record
// and verify payments, does each in one step; others keep the review step. Balances are one definition
// (accountBalance = partyBalances) and change only when an invoice is issued or money is allocated.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { createAccount, createUnit, partyBalances } from "@/server/services/property";
import { issueBilling } from "@/server/services/billing";
import { accountBalance, createManualInvoice, getInvoice, issueManualInvoice, recordPayment } from "@/server/services/finance";
import { addMonths, monthStart, todayISO } from "@/lib/dates";

assertTestDatabase();

const admin = actor("ADMIN");
const manager = actor("MANAGER");
const finance = actor("FINANCE");
const today = todayISO();
const thisMonth = monthStart(today);
const start = addMonths(thisMonth, -2);
const docs = { account: [], agreement: [], management: [] };
const line = (amount: number, description = "Key replacement") => ({ category: "OTHER" as const, description, amount });

beforeEach(async () => {
  await resetTestData();
  await db.building.create({ data: { name: "Single Operator Building" } });
});

async function tenant(name: string, phone: string, unitNumber: string, rent = 1000000) {
  const unit = await createUnit(admin, { unitNumber, floor: null, unitType: null, notes: null });
  const r = await createAccount(manager, {
    party: { displayName: name, phone, email: null, idNumber: null, notes: null },
    accountType: "TENANT",
    unitId: unit.id,
    tenancy: { startDate: start, endDate: null, rentAmount: rent, dueDay: 5, graceDays: null, reference: null, lateFeeTerms: null, allocationTerms: null, notes: null },
    documents: docs,
  });
  return { unit, ...r };
}
const outstanding = async (partyId: string) => (await accountBalance(finance, partyId)).outstanding;

describe("create invoice in one step", () => {
  it("issues the invoice at once, adds it to the outstanding balance exactly once, and audits it", async () => {
    const { party, unit, agreement } = await tenant("Invoice Tenant", "0700 200 001", "I1");
    await issueBilling(finance, addMonths(thisMonth, -1));
    const before = await outstanding(party.id);
    expect(before).toBe(1000000);
    const inv = await createManualInvoice(admin, { partyId: party.id, unitId: unit.id, agreementId: agreement.id, notes: null, dueDate: today, lines: [line(150000), line(50000, "Lock")] }, { issue: true });
    expect(inv).toMatchObject({ status: "ISSUED", issuedById: admin.id, createdById: admin.id });
    expect(inv.number).toMatch(/^INV-\d{4}-\d{6}$/);
    expect((await getInvoice(finance, inv.id))!.summary).toMatchObject({ total: 200000, balance: 200000 });
    expect(await outstanding(party.id)).toBe(before + 200000);
    expect(await outstanding(party.id)).toBe(before + 200000); // read twice: counted once
    expect(await db.auditEvent.count({ where: { entityId: inv.id, action: "invoice.issue_manual" } })).toBe(1);
    // The finance officer may also issue in one step.
    const second = await createManualInvoice(finance, { partyId: party.id, unitId: unit.id, agreementId: agreement.id, notes: null, dueDate: today, lines: [line(10000)] }, { issue: true });
    expect(second.status).toBe("ISSUED");
  });

  it("leaves the balance unchanged when creation fails, and keeps the review step for roles that cannot issue", async () => {
    const { party, unit, agreement } = await tenant("Failed Tenant", "0700 200 002", "I2");
    const other = await createUnit(admin, { unitNumber: "I2-X", floor: null, unitType: null, notes: null });
    const count = () => db.invoice.count();
    await expect(createManualInvoice(admin, { partyId: party.id, unitId: other.id, agreementId: null, notes: null, dueDate: today, lines: [line(1000)] }, { issue: true })).rejects.toThrow(/no agreement on the selected unit/);
    await expect(createManualInvoice(admin, { partyId: party.id, unitId: unit.id, agreementId: agreement.id, notes: null, dueDate: "2000-01-01", lines: [line(1000)] }, { issue: true })).rejects.toThrow(/due date cannot be before/);
    await expect(createManualInvoice(admin, { partyId: party.id, unitId: unit.id, agreementId: agreement.id, notes: null, dueDate: today, lines: [] }, { issue: true })).rejects.toThrow(/at least one/);
    await expect(createManualInvoice(manager, { partyId: party.id, unitId: unit.id, agreementId: agreement.id, notes: null, dueDate: today, lines: [line(1000)] }, { issue: true })).rejects.toThrow(/permission/);
    expect(await count()).toBe(0);
    expect(await outstanding(party.id)).toBe(0);
    const draft = await createManualInvoice(manager, { partyId: party.id, unitId: unit.id, agreementId: agreement.id, notes: null, dueDate: today, lines: [line(1000)] });
    expect(draft.status).toBe("DRAFT");
    expect(await outstanding(party.id)).toBe(0); // a draft owes nothing
  });
});

describe("record payment in one step", () => {
  it("saves the payment verified, allocates what was entered across invoices, and keeps the rest unallocated", async () => {
    const { party, unit, agreement } = await tenant("Paying Tenant", "0700 200 003", "P1");
    await issueBilling(finance, addMonths(thisMonth, -1));
    const extra = await createManualInvoice(finance, { partyId: party.id, unitId: unit.id, agreementId: agreement.id, notes: null, dueDate: today, lines: [line(200000)] }, { issue: true });
    const rent = await db.invoice.findFirstOrThrow({ where: { partyId: party.id, kind: { not: "MANUAL" } } });
    expect(await outstanding(party.id)).toBe(1200000);

    const p = await recordPayment(finance, { partyId: party.id, method: "MPESA", reference: "one1", amount: 1100000, receivedDate: today, evidenceNote: "Statement checked" }, {
      verify: true,
      allocations: [{ invoiceId: rent.id, amount: 1000000 }, { invoiceId: extra.id, amount: 50000 }],
    });
    expect(p).toMatchObject({ status: "VERIFIED", verifiedById: finance.id, recordedById: finance.id });
    expect(p.receiptNumber).toMatch(/^RCT-/);
    const b = await accountBalance(finance, party.id);
    expect([b.outstanding, b.unallocated]).toEqual([150000, 50000]); // the unallocated KES 500 reduces no invoice
    expect(b.openInvoices.map((i) => [i.id, i.balance])).toEqual([[extra.id, 150000]]);
    expect((await getInvoice(finance, rent.id))!.summary.paymentStatus).toBe("PAID");
    expect(await db.auditEvent.count({ where: { entityId: p.id, action: { in: ["payment.record_verified", "payment.allocate"] } } })).toBe(2);
    // The register shows the same figures.
    expect((await partyBalances([party.id])).get(party.id)).toEqual({ outstanding: 150000, unallocated: 50000 });
  });

  it("refuses over-allocation, another account's invoice and a duplicate reference, saving nothing", async () => {
    const a = await tenant("Tenant A", "0700 200 004", "A1");
    const b = await tenant("Tenant B", "0700 200 005", "B1", 500000);
    await issueBilling(finance, addMonths(thisMonth, -1));
    const invA = await db.invoice.findFirstOrThrow({ where: { partyId: a.party.id } });
    const invB = await db.invoice.findFirstOrThrow({ where: { partyId: b.party.id } });
    const pay = (reference: string, amount: number, allocations: { invoiceId: string; amount: number }[]) =>
      recordPayment(finance, { partyId: a.party.id, method: "BANK", reference, amount, receivedDate: today, evidenceNote: null }, { verify: true, allocations });

    await expect(pay("OVER-1", 100000, [{ invoiceId: invA.id, amount: 200000 }])).rejects.toThrow(/unallocated/);
    await expect(pay("OVER-2", 2000000, [{ invoiceId: invA.id, amount: 1500000 }])).rejects.toThrow(/more than the/);
    await expect(pay("CROSS-1", 100000, [{ invoiceId: invB.id, amount: 100000 }])).rejects.toThrow(/different account/);
    expect(await db.payment.count()).toBe(0); // the whole save is undone, payment included
    await pay("DUP-1", 100000, []);
    await expect(pay("dup-1", 100000, [])).rejects.toThrow(/already been recorded/);
    expect(await db.payment.count()).toBe(1);
    expect(await outstanding(b.party.id)).toBe(500000);
  });

  it("keeps the verification step for roles that may record but not verify", async () => {
    const { party } = await tenant("Manager Tenant", "0700 200 006", "M1");
    await expect(recordPayment(manager, { partyId: party.id, method: "CASH", reference: "MGR-1", amount: 1000, receivedDate: today, evidenceNote: null }, { verify: true })).rejects.toThrow(/permission/);
    const pending = await recordPayment(manager, { partyId: party.id, method: "CASH", reference: "MGR-2", amount: 1000, receivedDate: today, evidenceNote: null });
    expect(pending.status).toBe("PENDING");
    await expect(recordPayment(manager, { partyId: party.id, method: "CASH", reference: "MGR-3", amount: 1000, receivedDate: today, evidenceNote: null }, { allocations: [{ invoiceId: "x", amount: 1 }] })).rejects.toThrow(/verified/);
    await expect(recordPayment(actor("OPERATIONS"), { partyId: party.id, method: "CASH", reference: "OPS-1", amount: 1000, receivedDate: today, evidenceNote: null }, { verify: true })).rejects.toThrow(/permission/);
    await expect(accountBalance(actor("OPERATIONS"), party.id)).rejects.toThrow(/permission/);
  });
});

describe("manual invoice charge types", () => {
  it("never charges rent to an owner or a management fee outside a management agreement, also when issuing an older draft", async () => {
    const unit = await createUnit(admin, { unitNumber: "OWN-1", floor: null, unitType: null, notes: null });
    const owner = await createAccount(manager, {
      party: { displayName: "Owner Only", phone: "0700 200 010", email: null, idNumber: null, notes: null },
      accountType: "OWNER",
      unitId: unit.id,
      ownership: { startDate: start, purchaseDate: null, ownershipEvidence: "Sale agreement", reference: null, dueDay: 10, notes: null },
      documents: docs,
    });
    const draft = (category: "RENT" | "MANAGEMENT_FEE" | "SHARED_CHARGE", agreementId: string | null, issue = true) =>
      createManualInvoice(admin, { partyId: owner.party.id, unitId: unit.id, agreementId, notes: null, dueDate: today, lines: [{ category, description: "x", amount: 100000 }] }, { issue });
    await expect(draft("RENT", owner.agreement.id)).rejects.toThrow(/Rent can only be invoiced under the account's rental agreement/);
    await expect(draft("RENT", null)).rejects.toThrow(/rental agreement/);
    await expect(draft("MANAGEMENT_FEE", owner.agreement.id)).rejects.toThrow(/management agreement/);
    expect(await db.invoice.count()).toBe(0);
    expect((await draft("SHARED_CHARGE", owner.agreement.id)).status).toBe("ISSUED"); // an approved shared charge is fine
    // A draft saved before this check (inserted directly) cannot be issued either.
    const old = await db.invoice.create({ data: { buildingId: unit.buildingId, partyId: owner.party.id, unitId: unit.id, agreementId: owner.agreement.id, kind: "MANUAL", status: "DRAFT", total: "100.00", createdById: manager.id, lines: { create: [{ category: "RENT", description: "rent invoice", amount: "100.00", sourceType: "MANUAL" }] } } });
    await expect(issueManualInvoice(finance, old.id)).rejects.toThrow(/Rent can only be invoiced/);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("DRAFT");
  });
});

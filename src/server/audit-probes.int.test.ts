// System audit probes (2026-10-23): races, duplicate submissions, reversals of one-step payments,
// credit limits, direct calls from roles without access, and a full reconciliation afterwards.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { createAccount, createUnit } from "@/server/services/property";
import { issueBilling } from "@/server/services/billing";
import { accountBalance, allocatePayment, createCreditNote, createManualInvoice, getInvoice, recordPayment, reversePayment } from "@/server/services/finance";
import { accountStatement, arrearsReport, reconciliationCheck } from "@/server/services/reports";
import { runReport } from "@/server/reports/catalog";
import { addMonths, monthStart, todayISO } from "@/lib/dates";

assertTestDatabase();

const admin = actor("ADMIN");
const manager = actor("MANAGER");
const finance = actor("FINANCE");
const finance2 = actor("FINANCE", "finance-2");
const today = todayISO();
const start = addMonths(monthStart(today), -2);
const docs = { account: [], agreement: [], management: [] };

beforeEach(async () => {
  await resetTestData();
  await db.building.create({ data: { name: "Probe Building" } });
});

async function tenant(name: string, phone: string, unitNumber: string) {
  const unit = await createUnit(admin, { unitNumber, floor: null, unitType: null, notes: null });
  return createAccount(manager, { party: { displayName: name, phone, email: null, idNumber: null, notes: null }, accountType: "TENANT", unitId: unit.id, tenancy: { startDate: start, endDate: null, rentAmount: 1000000, dueDay: 5, graceDays: null, reference: null, lateFeeTerms: null, allocationTerms: null, notes: null }, documents: docs });
}
const pay = (who: typeof finance, partyId: string, reference: string, amount: number, allocations: { invoiceId: string; amount: number }[] = []) =>
  recordPayment(who, { partyId, method: "MPESA", reference, amount, receivedDate: today, evidenceNote: null }, { verify: true, allocations });

describe("races and duplicate submissions", () => {
  it("records a payment reference once even when submitted twice at the same moment", async () => {
    const { party } = await tenant("Race Payer", "0700 500 001", "P1");
    const both = await Promise.allSettled([pay(finance, party.id, "DUP-AT-ONCE", 1000), pay(finance2, party.id, "dup-at-once", 1000)]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.payment.count()).toBe(1);
  });

  it("gives two invoices issued at the same moment different numbers", async () => {
    const { party, agreement } = await tenant("Numbered", "0700 500 002", "P2");
    const line = [{ category: "OTHER" as const, description: "Key", amount: 1000 }];
    const [a, b] = await Promise.all([1, 2].map(() => createManualInvoice(admin, { partyId: party.id, unitId: agreement.unitId, agreementId: agreement.id, notes: null, dueDate: today, lines: line }, { issue: true })));
    expect(a.number).not.toBe(b.number);
  });

  it("never lets two one-step payments over-pay the same invoice", async () => {
    const { party } = await tenant("Over Payer", "0700 500 003", "P3");
    await issueBilling(finance, addMonths(monthStart(today), -1));
    const inv = await db.invoice.findFirstOrThrow({ where: { partyId: party.id } });
    const r = await Promise.allSettled([pay(finance, party.id, "OP-1", 700000, [{ invoiceId: inv.id, amount: 700000 }]), pay(finance2, party.id, "OP-2", 700000, [{ invoiceId: inv.id, amount: 700000 }])]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await getInvoice(finance, inv.id))!.summary.balance).toBe(300000);
    expect(await db.payment.count()).toBe(1); // the refused one left nothing behind
  });
});

describe("corrections keep every figure consistent", () => {
  it("reversing a one-step payment restores the invoice, the account and the reports; an over-credit is refused", async () => {
    const { party } = await tenant("Corrected", "0700 500 004", "P4");
    await issueBilling(finance, addMonths(monthStart(today), -1));
    const inv = await db.invoice.findFirstOrThrow({ where: { partyId: party.id } });
    const p = await pay(finance, party.id, "REV-1", 1000000, [{ invoiceId: inv.id, amount: 1000000 }]);
    expect((await accountBalance(finance, party.id)).outstanding).toBe(0);
    await reversePayment(finance, p.id, "Bounced");
    expect((await getInvoice(finance, inv.id))!.summary.balance).toBe(1000000);
    expect(await accountBalance(finance, party.id)).toMatchObject({ outstanding: 1000000, unallocated: 0 });
    await expect(createCreditNote(finance, inv.id, 1000001, "Too much")).rejects.toThrow();
    await createCreditNote(finance, inv.id, 250000, "Agreed correction");
    const st = await accountStatement(finance, party.id, "2000-01-01", today);
    expect(st.closing).toBe(750000);
    expect((await arrearsReport(finance)).grandTotal).toBe(750000);
    const r = await runReport(finance, "arrears", {});
    expect("doc" in r && r.doc.summary[0].value).toBe(750000);
    expect((await reconciliationCheck(finance)).every((x) => x.matches)).toBe(true);
  });
});

describe("direct calls from roles without access", () => {
  it("refuses one-step issuing, verifying, allocating and financial reports on the server", async () => {
    const { party, agreement } = await tenant("Guarded", "0700 500 005", "P5");
    const line = [{ category: "OTHER" as const, description: "x", amount: 100 }];
    for (const who of [actor("AUDITOR"), actor("OPERATIONS")]) {
      await expect(createManualInvoice(who, { partyId: party.id, unitId: agreement.unitId, agreementId: agreement.id, notes: null, dueDate: today, lines: line }, { issue: true })).rejects.toThrow(/permission/);
      await expect(pay(who, party.id, `NO-${who.role}`, 100)).rejects.toThrow(/permission/);
    }
    // The read-only auditor may read financial reports; operations may not.
    await expect(runReport(actor("OPERATIONS"), "tenant", { partyId: party.id })).rejects.toThrow(/permission/);
    expect("doc" in (await runReport(actor("AUDITOR"), "tenant", { partyId: party.id }))).toBe(true);
    await expect(createManualInvoice(manager, { partyId: party.id, unitId: agreement.unitId, agreementId: agreement.id, notes: null, dueDate: today, lines: line }, { issue: true })).rejects.toThrow(/permission/);
    const pending = await recordPayment(manager, { partyId: party.id, method: "CASH", reference: "MGR-P", amount: 100, receivedDate: today, evidenceNote: null });
    await expect(allocatePayment(manager, pending.id, [])).rejects.toThrow(/permission/);
    expect(await db.invoice.count()).toBe(0);
  });
});

// Workflow H: the combined ledger, account statements, balances, dashboard and reports must
// all reconcile from the same invoices, credit notes, payments, allocations and reversals.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { PermissionError } from "@/server/auth/actor";
import { createAgreement, createParty, createUnit, type AgreementInput } from "@/server/services/property";
import { issueBilling } from "@/server/services/billing";
import { allocatePayment, createCreditNote, partyFinancialSummary, recordPayment, rejectPayment, reversePayment, verifyPayment } from "@/server/services/finance";
import { accountStatement, arrearsReport, collectionsReport, dashboard, financeLedger, reconciliationCheck } from "@/server/services/reports";
import { addDocuments, listDocuments, removeDocument, stageUpload } from "@/server/services/documents";
import { todayISO } from "@/lib/dates";

assertTestDatabase();

const admin = actor("ADMIN");
const manager = actor("MANAGER");
const finance = actor("FINANCE");
const operations = actor("OPERATIONS");
const auditor = actor("AUDITOR");
const today = todayISO();

const rental = (unitId: string, partyId: string, rentAmount: number): AgreementInput => ({
  type: "RENTAL", unitId, partyId, rentAmount, reference: null, startDate: "2026-01-01", endDate: null, managementFeeAmount: null,
  dueDay: 5, graceDays: null, purchaseDate: null, ownershipEvidence: null, lateFeeTerms: null, allocationTerms: null, notes: null,
});

let tenants: { id: string }[] = [];
beforeEach(async () => {
  await resetTestData();
  await db.building.create({ data: { name: "Ledger Building" } });
  const units = await Promise.all(["A-1", "A-2"].map((n) => createUnit(manager, { unitNumber: n, floor: null, unitType: null, notes: null })));
  tenants = await Promise.all(["Tenant One", "Tenant Two"].map((n) => createParty(admin, { displayName: n, phone: null, email: null, idNumber: null, notes: null })));
  await createAgreement(manager, rental(units[0].id, tenants[0].id, 2000000));
  await createAgreement(manager, rental(units[1].id, tenants[1].id, 3000000));
  // Fixed past months, so the outcome never depends on today's date.
  for (const m of ["2026-01-01", "2026-02-01"]) await issueBilling(finance, m);
});

async function transactions() {
  const [inv1] = await db.invoice.findMany({ where: { partyId: tenants[0].id }, orderBy: { periodStart: "asc" } });
  const paid = await recordPayment(manager, { partyId: tenants[0].id, method: "MPESA", reference: "LED1", amount: 2500000, receivedDate: "2026-02-10", evidenceNote: null });
  await verifyPayment(finance, paid.id);
  await allocatePayment(finance, paid.id, [{ invoiceId: inv1.id, amount: 2000000 }]); // 5,000 left unallocated
  await createCreditNote(finance, (await db.invoice.findFirstOrThrow({ where: { partyId: tenants[1].id } })).id, 500000, "Agreed allowance");
  const reversed = await recordPayment(manager, { partyId: tenants[1].id, method: "BANK", reference: "LED2", amount: 1000000, receivedDate: "2026-02-12", evidenceNote: null });
  await verifyPayment(finance, reversed.id);
  await reversePayment(finance, reversed.id, "Bank returned it");
  await recordPayment(manager, { partyId: tenants[1].id, method: "CASH", reference: "LED3", amount: 700000, receivedDate: "2026-02-15", evidenceNote: null }); // stays pending
  const rejected = await recordPayment(manager, { partyId: tenants[1].id, method: "MPESA", reference: "LED4", amount: 400000, receivedDate: "2026-02-16", evidenceNote: null });
  await rejectPayment(finance, rejected.id, "Not on statement");
}

describe("combined ledger and cross-module reconciliation", () => {
  it("agrees with every account statement, balance, dashboard figure and report", async () => {
    await transactions();
    const ledger = await financeLedger(finance, "2000-01-01", today);
    // 4 invoices: 2 × 20,000 + 2 × 30,000 = 100,000; credit 5,000; verified 25,000 + 10,000; reversal 10,000.
    expect(ledger).toMatchObject({ opening: 0, charges: 10000000, credits: 500000, payments: 3500000, reversals: 1000000, closing: 7000000 });
    expect(ledger.entries.map((e) => e.kind).sort()).toEqual(["CREDIT_NOTE", "INVOICE", "INVOICE", "INVOICE", "INVOICE", "PAYMENT", "PAYMENT", "PAYMENT_REVERSAL"].sort());
    // Pending and rejected payments are listed but never counted.
    expect(ledger.notCounted.map((p) => [p.reference, p.status]).sort()).toEqual([["LED3", "PENDING"], ["LED4", "REJECTED"]]);

    const statements = await Promise.all(tenants.map((t) => accountStatement(finance, t.id, "2000-01-01", today)));
    const balances = await Promise.all(tenants.map((t) => partyFinancialSummary(t.id)));
    expect(statements[0].closing + statements[1].closing).toBe(ledger.closing);
    expect(balances[0].accountBalance + balances[1].accountBalance).toBe(ledger.closing);
    expect(balances.map((b) => b.unallocated)).toEqual([500000, 0]);

    const d = await dashboard(finance, "12m");
    expect(d.money!.outstanding).toBe(ledger.closing + 500000); // unpaid invoices = owed + verified money not yet applied
    expect(d.pendingPaymentsAmount).toBe(700000);
    expect(d.unallocatedAmount).toBe(500000);
    expect((await arrearsReport(finance)).grandTotal).toBe(d.money!.outstanding);
    // February keeps both receipts (one reversed later); the reversal belongs to the day it was made,
    // so over the whole period collections equal the ledger's payments − reversals. Pending ones never count.
    expect(await collectionsReport(finance, "2026-02-01", "2026-02-28")).toMatchObject({ received: 3500000, reversed: 0, total: 3500000 });
    expect((await collectionsReport(finance, "2026-02-01", todayISO())).total).toBe(3500000 - 1000000);
    expect((await reconciliationCheck(finance)).every((r) => r.matches)).toBe(true);
  });

  it("splits cleanly by period: one period's closing is the next period's opening", async () => {
    await transactions();
    // Statement dating (unchanged rule): invoices and credit notes by issue date (here: today),
    // payments by date received, reversals by reversal date.
    const early = await financeLedger(finance, "2000-01-01", "2026-02-11");
    const rest = await financeLedger(finance, "2026-02-12", today);
    expect(early).toMatchObject({ opening: 0, charges: 0, payments: 2500000, closing: -2500000 });
    expect(rest.opening).toBe(early.closing);
    expect(rest.closing).toBe((await financeLedger(finance, "2000-01-01", today)).closing);
    expect(early.notCounted).toHaveLength(0);
    expect(rest.notCounted).toHaveLength(2);
  });

  it("is limited to roles that see both invoices and payments", async () => {
    await expect(financeLedger(operations, "2026-01-01", today)).rejects.toBeInstanceOf(PermissionError);
    expect((await financeLedger(auditor, "2026-01-01", today)).charges).toBe(10000000);
  });
});

describe("document version history", () => {
  it("keeps replaced documents in a visible history with who removed them and why", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");
    const v1 = await stageUpload(manager, { ownerType: "PARTY", category: "OTHER", fileName: "lease-v1.pdf", bytes: pdf });
    await addDocuments(manager, "PARTY", tenants[0].id, [v1.id]);
    await removeDocument(manager, v1.id, "Replaced by the corrected copy");
    const v2 = await stageUpload(manager, { ownerType: "PARTY", category: "OTHER", fileName: "lease-v2.pdf", bytes: pdf });
    await addDocuments(manager, "PARTY", tenants[0].id, [v2.id]);

    const m = await listDocuments(manager, "PARTY", tenants[0].id);
    expect(m.documents.map((d) => d.originalName)).toEqual(["lease-v2.pdf"]);
    expect(m.history).toEqual([expect.objectContaining({ originalName: "lease-v1.pdf", removeReason: "Replaced by the corrected copy" })]);
    expect(m.canOpenHistory).toBe(false); // managers see the history; opening removed files needs audit access
    const a = await listDocuments(auditor, "PARTY", tenants[0].id);
    expect(a.history).toHaveLength(1);
    expect(a.canOpenHistory).toBe(true);
    expect(await db.document.count({ where: { ownerId: tenants[0].id } })).toBe(2); // nothing deleted
  });
});

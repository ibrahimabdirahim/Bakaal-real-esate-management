import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { PermissionError } from "@/server/auth/actor";
import { audit } from "@/server/audit";
import {
  archiveParty,
  createAgreement,
  createParty,
  createUnit,
  deleteParty,
  DuplicateAccountError,
  findDeletedParty,
  getParty,
  listParties,
  updateParty,
  type AgreementInput,
  type PartyInput,
} from "@/server/services/property";
import { createManualInvoice, recordPayment, rejectPayment } from "@/server/services/finance";
import { accountStatement, reconciliationCheck } from "@/server/services/reports";
import { todayISO } from "@/lib/dates";

assertTestDatabase();

const admin = actor("ADMIN");
const manager = actor("MANAGER");
const finance = actor("FINANCE");
const operations = actor("OPERATIONS");
const auditor = actor("AUDITOR");

const person = (over: Partial<PartyInput> = {}): PartyInput => ({ displayName: "Amina Hassan", phone: null, email: null, idNumber: null, notes: null, ...over });

const agreementDefaults: Omit<AgreementInput, "type" | "unitId" | "partyId"> = {
  reference: null, startDate: "2026-01-01", endDate: null, rentAmount: 2500000, managementFeeAmount: null,
  dueDay: 5, graceDays: null, purchaseDate: null, ownershipEvidence: null, lateFeeTerms: null, allocationTerms: null, notes: null,
};

async function duplicateError(p: Promise<unknown>): Promise<DuplicateAccountError> {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(DuplicateAccountError);
  return e as DuplicateAccountError;
}

async function setupBuilding() {
  await db.building.create({ data: { name: "Test Building" } });
  return createUnit(admin, { unitNumber: "A-101", floor: "1", unitType: "1 Bedroom", notes: null });
}

describe("duplicate account detection", () => {
  beforeEach(async () => {
    await resetTestData();
  });

  it("matches e-mail, phone and ID number after normalisation", async () => {
    const first = await createParty(admin, person({ email: "Amina@Example.com", phone: "0700 111 222", idNumber: "ab-123" }));
    const e = await duplicateError(createParty(admin, person({ displayName: "A. Hassan", email: " amina@example.com", phone: "+254700111222", idNumber: "AB 123" })));
    expect(e.matches).toEqual([{ id: first.id, displayName: "Amina Hassan", archived: false, fields: ["email", "phone", "idNumber"] }]);
    for (const only of [{ email: "AMINA@example.com" }, { phone: "254-700-111-222" }, { idNumber: "AB123" }]) {
      const m = await duplicateError(createParty(admin, person(only)));
      expect(m.matches.map((x) => x.id)).toEqual([first.id]);
    }
    expect(await db.party.count()).toBe(1);
  });

  it("does not treat different numbers or blank fields as duplicates", async () => {
    await createParty(admin, person({ phone: "0757079441" }));
    await createParty(admin, person({ phone: "0757079442" })); // one digit different: a different number, allowed
    await createParty(admin, person());
    await createParty(admin, person({ phone: "", email: null })); // blank optional fields never match
    expect(await db.party.count()).toBe(4);
  });

  it("blocks every duplicate: there is no way to create one intentionally", async () => {
    const first = await createParty(admin, person({ phone: "0700111222" }));
    for (const who of [admin, manager]) {
      const e = await duplicateError(createParty(who, person({ displayName: "Someone Else", phone: "0700111222" })));
      expect(e.message).toMatch(/already exists: Amina Hassan — same phone number\. Nothing was saved/);
      expect(e.matches.map((m) => m.id)).toEqual([first.id]);
    }
    // Old confirmation fields or extra arguments from a forged request are ignored.
    const forged = createParty as unknown as (...args: unknown[]) => Promise<unknown>;
    await duplicateError(forged(admin, person({ phone: "0700111222" }), { confirmedDuplicateIds: [first.id] }));
    expect(await db.party.count()).toBe(1);
  });

  it("blocks recreating the identity of an archived account", async () => {
    const old = await createParty(admin, person({ email: "left@example.com", idNumber: "12345678" }));
    await archiveParty(manager, old.id, "Moved out");
    const e = await duplicateError(createParty(admin, person({ displayName: "Same Person", idNumber: "1234 5678" })));
    expect(e.matches).toEqual([{ id: old.id, displayName: "Amina Hassan", archived: true, fields: ["idNumber"] }]);
    expect(e.message).toMatch(/\(archived\)/);
    expect(await db.party.count()).toBe(1);
  });

  it("refuses account creation from roles that cannot manage accounts", async () => {
    for (const who of [finance, operations, auditor]) await expect(createParty(who, person({ phone: "0700999888" }))).rejects.toBeInstanceOf(PermissionError);
    expect(await db.party.count()).toBe(0);
  });

  it("lets only one of two simultaneous identical submissions through", async () => {
    const results = await Promise.allSettled([1, 2, 3].map(() => createParty(admin, person({ email: "same@example.com" }))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(2);
    for (const r of rejected) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(DuplicateAccountError);
    expect(await db.party.count()).toBe(1);
  });

  it("blocks edits that introduce another account's details, excluding the account itself", async () => {
    const a = await createParty(admin, person({ phone: "0700111222", email: "a@example.com" }));
    // Saving the account with its own (unchanged or reformatted) details is never a duplicate of itself.
    await updateParty(admin, a.id, person({ phone: "0700111222", email: "a@example.com", notes: "Prefers SMS" }));
    await updateParty(admin, a.id, person({ phone: "+254 700 111 222", email: "A@Example.com", notes: "Prefers SMS" }));
    const c = await createParty(admin, person({ displayName: "Other", email: "other@example.com", idNumber: "X-1" }));
    for (const change of [{ email: "OTHER@example.com" }, { idNumber: "x1" }]) {
      const e = await duplicateError(updateParty(admin, a.id, person({ phone: "0700111222", email: "a@example.com", ...change })));
      expect(e.matches.map((m) => m.id)).toEqual([c.id]);
    }
    expect(await db.party.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ email: "A@Example.com", idNumber: null });
    // An archived account's details are protected too.
    const gone = await createParty(admin, person({ displayName: "Gone", phone: "0711000000" }));
    await archiveParty(admin, gone.id, "Duplicate");
    await duplicateError(updateParty(admin, a.id, person({ phone: "0711 000 000", email: "a@example.com" })));
  });

  it("still allows editing older duplicates that existed before the strict rule", async () => {
    // Records created before the rule (like the existing duplicates) are inserted directly.
    const a = await db.party.create({ data: person({ phone: "0700111222" }) });
    const b = await db.party.create({ data: person({ phone: "0700111222" }) });
    await updateParty(admin, b.id, person({ phone: "0700111222", notes: "Unchanged phone, so allowed" }));
    // Adding an e-mail that the other duplicate uses is still blocked.
    await db.party.update({ where: { id: a.id }, data: { email: "a@example.com" } });
    await duplicateError(updateParty(admin, b.id, person({ phone: "0700111222", email: "a@example.com" })));
  });

  it("refuses a duplicate created by another user after the form was opened", async () => {
    // User 1 opens the form (no match yet); user 2 saves the same person first.
    await createParty(manager, person({ email: "race@example.com" }));
    const e = await duplicateError(createParty(admin, person({ displayName: "Typed slowly", email: "race@example.com" })));
    expect(e.matches).toHaveLength(1);
  });

  it("keeps regular account creation working", async () => {
    const p = await createParty(admin, person({ displayName: "Plain Account", email: "plain@example.com" }));
    const created = await db.auditEvent.findFirstOrThrow({ where: { action: "account.create", entityId: p.id } });
    expect(created.summary).toBe("Created account Plain Account");
    expect(created.after).toMatchObject({ idNumber: null });
  });
});

describe("account archiving", () => {
  beforeEach(async () => {
    await resetTestData();
  });

  it("archives an unused account and audits actor, time and reason", async () => {
    const p = await createParty(admin, person({ email: "dup@example.com" }));
    const before = Date.now();
    await archiveParty(manager, p.id, "  Duplicate of an earlier account  ");
    const archived = await db.party.findUniqueOrThrow({ where: { id: p.id } });
    expect(archived.archivedAt).not.toBeNull();
    const event = await db.auditEvent.findFirstOrThrow({ where: { action: "account.archive", entityId: p.id } });
    expect(event).toMatchObject({ actorId: manager.id, actorEmail: manager.email, entityType: "Party", reason: "Duplicate of an earlier account" });
    expect(event.occurredAt.getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect(await db.party.count()).toBe(1); // never deleted
  });

  it("requires a reason and an authorised role", async () => {
    const p = await createParty(admin, person());
    await expect(archiveParty(admin, p.id, "   ")).rejects.toThrow(/reason/);
    for (const who of [finance, operations, auditor]) await expect(archiveParty(who, p.id, "Duplicate")).rejects.toBeInstanceOf(PermissionError);
    expect((await db.party.findUniqueOrThrow({ where: { id: p.id } })).archivedAt).toBeNull();
    await archiveParty(admin, p.id, "Duplicate");
    await expect(archiveParty(admin, p.id, "Again")).rejects.toThrow(/already archived/);
  });

  it("blocks archiving when any agreement, invoice or payment exists, including inactive ones", async () => {
    const unit = await setupBuilding();
    const withAgreement = await createParty(admin, person({ displayName: "Has agreement" }));
    await createAgreement(manager, { ...agreementDefaults, type: "RENTAL", unitId: unit.id, partyId: withAgreement.id, endDate: "2026-02-28" }); // already ended
    await expect(archiveParty(admin, withAgreement.id, "Duplicate")).rejects.toThrow(/1 agreement\(s\)/);

    const withDraftInvoice = await createParty(admin, person({ displayName: "Has draft invoice" }));
    await invoiceOnly(withDraftInvoice.id, unit);
    await expect(archiveParty(admin, withDraftInvoice.id, "Duplicate")).rejects.toThrow(/1 invoice\(s\)/);

    const withRejectedPayment = await createParty(admin, person({ displayName: "Has rejected payment" }));
    const pay = await recordPayment(manager, { partyId: withRejectedPayment.id, method: "MPESA", reference: "ABC123", amount: 100000, receivedDate: todayISO(), evidenceNote: null });
    await rejectPayment(finance, pay.id, "Not on statement");
    await expect(archiveParty(admin, withRejectedPayment.id, "Duplicate")).rejects.toThrow(/1 payment\(s\)/);

    expect(await db.party.count({ where: { archivedAt: { not: null } } })).toBe(0);
  });

  it("hides archived accounts from the register by default but keeps them inspectable", async () => {
    const keep = await createParty(admin, person({ displayName: "Active Person" }));
    const gone = await createParty(admin, person({ displayName: "Archived Person" }));
    await archiveParty(admin, gone.id, "Entered by mistake");
    expect((await listParties(admin)).map((p) => p.id)).toEqual([keep.id]);
    const all = await listParties(admin, undefined, { includeArchived: true });
    expect(all.map((p) => [p.displayName, p.archived])).toEqual([["Active Person", false], ["Archived Person", true]]);
    const detail = await getParty(auditor, gone.id);
    expect(detail?.party.archivedAt).not.toBeNull();
    expect(detail?.archive).toMatchObject({ actorEmail: admin.email, reason: "Entered by mistake" });
  });

  it("refuses new agreements, invoices, payments and edits for archived accounts", async () => {
    const unit = await setupBuilding();
    const p = await createParty(admin, person());
    await archiveParty(admin, p.id, "Duplicate");
    await expect(createAgreement(manager, { ...agreementDefaults, type: "RENTAL", unitId: unit.id, partyId: p.id })).rejects.toThrow(/archived/);
    await expect(recordPayment(manager, { partyId: p.id, method: "CASH", reference: "R1", amount: 100, receivedDate: todayISO(), evidenceNote: null })).rejects.toThrow(/archived/);
    await expect(
      createManualInvoice(finance, { partyId: p.id, unitId: unit.id, agreementId: null, notes: null, dueDate: todayISO(), lines: [{ category: "OTHER", description: "x", amount: 100 }] }),
    ).rejects.toThrow(/archived/);
    await expect(updateParty(admin, p.id, person({ notes: "edit" }))).rejects.toThrow(/archived/);
    expect(await db.agreement.count()).toBe(0);
    expect(await db.payment.count()).toBe(0);
    expect(await db.invoice.count()).toBe(0);
  });

  it("never lets an archive and a new payment for the same account both succeed", async () => {
    await setupBuilding();
    for (let i = 0; i < 5; i++) {
      const p = await createParty(admin, person({ displayName: `Race ${i}` }));
      const [archived, paid] = await Promise.allSettled([
        archiveParty(admin, p.id, "Duplicate"),
        recordPayment(manager, { partyId: p.id, method: "CASH", reference: `RACE${i}`, amount: 100, receivedDate: todayISO(), evidenceNote: null }),
      ]);
      expect([archived.status, paid.status].filter((s) => s === "fulfilled")).toHaveLength(1);
      const row = await db.party.findUniqueOrThrow({ where: { id: p.id }, include: { payments: true } });
      expect(row.archivedAt != null).toBe(row.payments.length === 0);
    }
  });

  it("keeps reports, statements and audit history intact for archived accounts", async () => {
    const unit = await setupBuilding();
    const tenant = await createParty(admin, person({ displayName: "Real Tenant" }));
    await createAgreement(manager, { ...agreementDefaults, type: "RENTAL", unitId: unit.id, partyId: tenant.id });
    const dup = await createParty(admin, person({ displayName: "Duplicate Entry" }));
    await updateParty(admin, dup.id, person({ displayName: "Duplicate Entry", notes: "typo" }));
    await archiveParty(admin, dup.id, "Duplicate");

    const history = await db.auditEvent.findMany({ where: { entityId: dup.id }, orderBy: { id: "asc" } });
    expect(history.map((h) => h.action)).toEqual(["account.create", "account.update", "account.archive"]);
    const statement = await accountStatement(finance, dup.id, "2026-01-01", todayISO());
    expect(statement.entries).toHaveLength(0);
    expect((await reconciliationCheck(finance)).every((r) => r.matches)).toBe(true);
  });
});

describe("permanent account deletion", () => {
  beforeEach(async () => {
    await resetTestData();
  });

  it("lets an administrator delete a never-used account, keeping its history and a minimal deletion record", async () => {
    const p = await createParty(admin, person({ phone: "0700111222", email: "gone@example.com", idNumber: "999" }));
    await updateParty(admin, p.id, person({ phone: "0700111222", email: "gone@example.com", idNumber: "999", notes: "typo" }));
    const before = Date.now();
    expect(await deleteParty(admin, p.id, "Created by mistake")).toEqual({ id: p.id, displayName: "Amina Hassan" });
    expect(await db.party.findUnique({ where: { id: p.id } })).toBeNull();

    const history = await db.auditEvent.findMany({ where: { entityId: p.id }, orderBy: { id: "asc" } });
    expect(history.map((h) => h.action)).toEqual(["account.create", "account.update", "account.delete"]);
    const event = history[2];
    expect(event).toMatchObject({ actorId: admin.id, actorEmail: admin.email, entityType: "Party", reason: "Created by mistake", summary: "Permanently deleted account Amina Hassan" });
    expect(event.occurredAt.getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect(JSON.stringify(event.before)).not.toMatch(/0700111222|gone@example|999/); // no contact or ID details
    expect(await findDeletedParty(auditor, p.id)).toMatchObject({ actorEmail: admin.email, reason: "Created by mistake" });
    expect(await listParties(admin, undefined, { includeArchived: true })).toEqual([]);
  });

  it("allows only administrators, enforced on the server", async () => {
    const p = await createParty(admin, person());
    for (const who of [manager, finance, operations, auditor]) await expect(deleteParty(who, p.id)).rejects.toBeInstanceOf(PermissionError);
    expect(await db.party.count()).toBe(1);
    // The test audit log is never emptied, so look only at this account.
    expect(await db.auditEvent.count({ where: { action: "account.delete", entityId: p.id } })).toBe(0);
  });

  it("needs only the one confirmation in the interface (nothing typed); the server still decides (F57)", async () => {
    const p = await createParty(admin, person());
    await deleteParty(admin, p.id);
    expect(await db.party.count()).toBe(0);
    await expect(deleteParty(admin, p.id)).rejects.toThrow(/no longer exists/);
  });

  it("refuses accounts with agreements, invoices or payments in any status, and recommends archiving", async () => {
    const unit = await setupBuilding();
    const a = await createParty(admin, person({ displayName: "Ended agreement" }));
    await createAgreement(manager, { ...agreementDefaults, type: "RENTAL", unitId: unit.id, partyId: a.id, endDate: "2026-02-28" });
    const i = await createParty(admin, person({ displayName: "Draft invoice" }));
    await invoiceOnly(i.id, unit);
    const p = await createParty(admin, person({ displayName: "Rejected payment" }));
    const pay = await recordPayment(manager, { partyId: p.id, method: "MPESA", reference: "DEL1", amount: 100, receivedDate: todayISO(), evidenceNote: null });
    await rejectPayment(finance, pay.id, "Not on statement");

    await expect(deleteParty(admin, a.id)).rejects.toThrow(/1 agreement\(s\).*Archive it instead/);
    await expect(deleteParty(admin, i.id)).rejects.toThrow(/1 invoice\(s\)/);
    await expect(deleteParty(admin, p.id)).rejects.toThrow(/1 payment\(s\)/);
    expect(await db.party.count()).toBe(3);
    expect(await db.agreement.count()).toBe(1);
    expect(await db.invoice.count()).toBe(1);
    expect(await db.payment.count()).toBe(1);
  });

  it("refuses accounts that other records' audit history refers to, even if those records are gone", async () => {
    const p = await createParty(admin, person());
    // Audit entry of another record type that mentions the account (as left behind by a removed record).
    await audit(db, manager, { action: "payment.record", entityType: "Payment", entityId: "removed-payment", summary: "Recorded payment", after: { partyId: p.id } });
    await expect(deleteParty(admin, p.id)).rejects.toThrow(/1 audit log entry about other records/);
    expect(await db.party.count()).toBe(1);
  });

  it("does not treat another account's old duplicate confirmation as a dependency", async () => {
    // Accounts created before the strict rule could record "confirmedSeparateFrom" in their audit entry.
    const first = await createParty(admin, person({ phone: "0700111222" }));
    const second = await db.party.create({ data: person({ phone: "0700111222" }) });
    await audit(db, admin, { action: "account.create", entityType: "Party", entityId: second.id, summary: "Created account", after: { id: second.id, confirmedSeparateFrom: [first.id] } });
    await deleteParty(admin, first.id);
    expect((await db.party.findMany()).map((x) => x.id)).toEqual([second.id]);
  });

  it("can delete an eligible archived account; an ineligible archived one stays archived", async () => {
    const unit = await setupBuilding();
    const unused = await createParty(admin, person({ displayName: "Unused" }));
    await archiveParty(manager, unused.id, "Duplicate");
    await deleteParty(admin, unused.id);
    expect(await db.party.findUnique({ where: { id: unused.id } })).toBeNull();

    const used = await createParty(admin, person({ displayName: "Used" }));
    await audit(db, manager, { action: "agreement.create", entityType: "Agreement", entityId: "x", summary: "x", after: { partyId: used.id, unitId: unit.id } });
    await archiveParty(manager, used.id, "Moved out");
    await expect(deleteParty(admin, used.id)).rejects.toThrow(/It stays archived/);
  });

  it("never lets a deletion and a new payment for the same account both succeed", async () => {
    await setupBuilding();
    for (let n = 0; n < 5; n++) {
      const p = await createParty(admin, person({ displayName: `Race ${n}` }));
      const [deleted, paid] = await Promise.allSettled([
        deleteParty(admin, p.id),
        recordPayment(manager, { partyId: p.id, method: "CASH", reference: `DRACE${n}`, amount: 100, receivedDate: todayISO(), evidenceNote: null }),
      ]);
      expect([deleted.status, paid.status].filter((s) => s === "fulfilled")).toHaveLength(1);
      const exists = (await db.party.count({ where: { id: p.id } })) === 1;
      expect(exists).toBe(paid.status === "fulfilled");
      if (!exists) expect(await db.payment.count({ where: { partyId: p.id } })).toBe(0);
    }
    const p = await createParty(admin, person({ displayName: "Twice" }));
    const twice = await Promise.allSettled([deleteParty(admin, p.id), deleteParty(admin, p.id)]);
    expect(twice.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(String((twice.find((r) => r.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/no longer exists/);
  });

  it("leaves reports, statements and other accounts' history intact", async () => {
    const unit = await setupBuilding();
    const tenant = await createParty(admin, person({ displayName: "Real Tenant" }));
    await createAgreement(manager, { ...agreementDefaults, type: "RENTAL", unitId: unit.id, partyId: tenant.id });
    const dup = await createParty(admin, person({ displayName: "Mistake" }));
    const auditBefore = await db.auditEvent.count();
    await deleteParty(admin, dup.id);
    expect(await db.auditEvent.count()).toBe(auditBefore + 1); // nothing removed, one entry added
    expect((await reconciliationCheck(finance)).every((r) => r.matches)).toBe(true);
    expect((await accountStatement(finance, tenant.id, "2026-01-01", todayISO())).entries).toEqual([]);
    expect(await db.agreement.count({ where: { partyId: tenant.id } })).toBe(1);
  });
});

/**
 * A draft invoice with no agreement behind it (manual invoices now need one, so older records are the
 * only way an account has an invoice alone); inserted directly to test that the invoice by itself counts.
 */
async function invoiceOnly(partyId: string, unit: { id: string; buildingId: string }) {
  await db.invoice.create({
    data: { buildingId: unit.buildingId, partyId, unitId: unit.id, kind: "MANUAL", status: "DRAFT", dueDate: new Date(`${todayISO()}T00:00:00Z`), total: "1000.00", lines: { create: [{ category: "OTHER", description: "Key", amount: "1000.00", sourceType: "MANUAL" }] } },
  });
}

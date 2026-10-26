import { beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { PermissionError } from "@/server/auth/actor";
import { addDocuments, discardStaged, documentForDownload, listDocuments, removeDocument, stageUpload } from "@/server/services/documents";
import { archiveParty, createAccount, createAgreement, createParty, createUnit, DuplicateAccountError, type NewAccountInput } from "@/server/services/property";
import { recordPayment } from "@/server/services/finance";
import { saveStaff } from "@/server/services/operations";
import { recordSalaryPayment } from "@/server/services/salaries";
import { MAX_DOCUMENT_BYTES } from "@/server/storage";
import { addMonths, monthStart, todayISO } from "@/lib/dates";

assertTestDatabase();

const admin = actor("ADMIN");
const manager = actor("MANAGER");
const finance = actor("FINANCE");
const operations = actor("OPERATIONS");
const auditor = actor("AUDITOR");

const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

const storedPath = async (id: string) => path.join(process.cwd(), "storage", "test-documents", (await db.document.findUniqueOrThrow({ where: { id } })).storageKey);
const person = (over = {}) => ({ displayName: "Amina Hassan", phone: null, email: null, idNumber: null, notes: null, ...over });
const stage = (who = manager, ownerType: "PARTY" | "AGREEMENT" | "PAYMENT" | "EXPENSE" = "PARTY", category: "ID_DOCUMENT" | "SIGNED_AGREEMENT" | "OTHER" | "PHOTO" | "PROOF_OF_PAYMENT" | "RECEIPT" = "ID_DOCUMENT", bytes = PDF, fileName = "id.pdf") =>
  stageUpload(who, { ownerType, category, fileName, bytes });

async function building() {
  await db.building.create({ data: { name: "Docs Building" } });
  return createUnit(manager, { unitNumber: "A-1", floor: null, unitType: "1 Bedroom", notes: null });
}

describe("upload validation and private storage", () => {
  beforeEach(resetTestData);

  it("accepts PDF, JPEG and PNG by their contents, stored privately under a random name", async () => {
    for (const [bytes, type] of [[PDF, "application/pdf"], [PNG, "image/png"], [JPG, "image/jpeg"]] as const) {
      const d = await stage(manager, "PARTY", "OTHER", bytes, "../../etc/evil name.exe");
      expect(d).toMatchObject({ mimeType: type, originalName: "evil name.exe", sizeBytes: bytes.byteLength });
      const file = await storedPath(d.id);
      expect(existsSync(file)).toBe(true);
      expect(file).not.toContain("public");
      expect(path.basename(file)).toMatch(/^[0-9a-f-]{36}\.(pdf|png|jpg)$/); // never the user's file name
    }
  });

  it("rejects disguised, empty, oversized and unauthorised uploads", async () => {
    await expect(stage(manager, "PARTY", "OTHER", new TextEncoder().encode("<html><script>x</script>"), "scan.pdf")).rejects.toThrow(/Only PDF, JPEG and PNG/);
    await expect(stage(manager, "PARTY", "OTHER", new Uint8Array(), "x.pdf")).rejects.toThrow(/empty/);
    const big = new Uint8Array(MAX_DOCUMENT_BYTES + 1);
    big.set(PDF);
    await expect(stage(manager, "PARTY", "OTHER", big, "big.pdf")).rejects.toThrow(/larger than/);
    await expect(stage(operations, "PARTY", "OTHER")).rejects.toBeInstanceOf(PermissionError);
    await expect(stage(auditor, "PAYMENT", "PROOF_OF_PAYMENT")).rejects.toBeInstanceOf(PermissionError);
    await expect(stage(manager, "PAYMENT", "ID_DOCUMENT")).rejects.toThrow(/cannot be attached here/);
    expect(await db.document.count()).toBe(0);
  });

  it("lets only the uploader discard or attach a staged file, and purges abandoned uploads", async () => {
    const party = await createParty(admin, person());
    const mine = await stage(manager);
    await expect(addDocuments(admin, "PARTY", party.id, [mine.id])).rejects.toThrow(/could not be found/); // someone else's upload
    await expect(discardStaged(admin, mine.id)).rejects.toThrow(/cannot be removed/);
    const file = await storedPath(mine.id);
    await discardStaged(manager, mine.id);
    expect(existsSync(file)).toBe(false);
    expect(await db.document.count()).toBe(0);

    const old = await stage(manager);
    const oldFile = await storedPath(old.id);
    await db.document.update({ where: { id: old.id }, data: { uploadedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    await stage(manager); // any upload triggers the clean-up of day-old staged files
    expect(await db.document.findUnique({ where: { id: old.id } })).toBeNull();
    expect(existsSync(oldFile)).toBe(false);
  });
});

describe("access, removal and replacement", () => {
  beforeEach(resetTestData);

  it("restricts identity documents to roles with sensitive access and hides staged files", async () => {
    const party = await createParty(admin, person());
    const id = await stage(manager, "PARTY", "ID_DOCUMENT");
    const other = await stage(manager, "PARTY", "OTHER");
    await addDocuments(manager, "PARTY", party.id, [id.id, other.id]);

    expect((await listDocuments(manager, "PARTY", party.id)).documents).toHaveLength(2);
    const forAuditor = await listDocuments(auditor, "PARTY", party.id);
    expect(forAuditor.documents.map((d) => d.category)).toEqual(["OTHER"]);
    expect(forAuditor.hidden).toBe(1);
    await expect(listDocuments(operations, "PARTY", party.id)).rejects.toBeInstanceOf(PermissionError);

    expect((await documentForDownload(manager, id.id))?.bytes.equals(Buffer.from(PDF))).toBe(true);
    expect(await documentForDownload(auditor, id.id)).toBeNull();
    expect(await documentForDownload(operations, other.id)).toBeNull();
    const staged = await stage(manager);
    expect(await documentForDownload(admin, staged.id)).toBeNull(); // not yet attached: only its uploader
    expect(await documentForDownload(manager, staged.id)).not.toBeNull();
  });

  it("soft-removes with a reason, keeps the file, and supports replacement", async () => {
    const party = await createParty(admin, person());
    const first = await stage(manager, "PARTY", "ID_DOCUMENT");
    await addDocuments(manager, "PARTY", party.id, [first.id]);
    await expect(removeDocument(auditor, first.id, "x")).rejects.toBeInstanceOf(PermissionError);
    await removeDocument(manager, first.id, "Expired ID");
    await expect(removeDocument(manager, first.id, "again")).rejects.toThrow(/already been removed/);
    expect(existsSync(await storedPath(first.id))).toBe(true); // file kept for history
    expect(await documentForDownload(manager, first.id)).toBeNull();
    expect(await documentForDownload(admin, first.id)).not.toBeNull(); // audit roles can still open it

    const replacement = await stage(manager, "PARTY", "ID_DOCUMENT", PNG, "new-id.png");
    await addDocuments(manager, "PARTY", party.id, [replacement.id]);
    expect((await listDocuments(manager, "PARTY", party.id)).documents.map((d) => d.originalName)).toEqual(["new-id.png"]);
    const audit = await db.auditEvent.findMany({ where: { entityId: party.id, action: { startsWith: "document." } }, orderBy: { id: "asc" } });
    expect(audit.map((a) => [a.action, a.reason])).toEqual([["document.attach", null], ["document.remove", "Expired ID"], ["document.attach", null]]);
  });

  it("protects attached documents in the database itself", async () => {
    const party = await createParty(admin, person());
    const d = await stage(manager);
    await addDocuments(manager, "PARTY", party.id, [d.id]);
    await expect(db.document.delete({ where: { id: d.id } })).rejects.toThrow(/never deleted/);
    await expect(db.document.update({ where: { id: d.id }, data: { ownerId: "another" } })).rejects.toThrow(/cannot change/);
    await expect(db.document.update({ where: { id: d.id }, data: { mimeType: "text/html" } })).rejects.toThrow();
  });

  it("refuses new documents on archived accounts", async () => {
    const party = await createParty(admin, person());
    await archiveParty(manager, party.id, "Duplicate");
    const d = await stage(manager);
    await expect(addDocuments(manager, "PARTY", party.id, [d.id])).rejects.toThrow(/archived/);
  });

  it("attaches proof of payment and receipts when those records are created; salary receipts stay private", async () => {
    await building();
    const party = await createParty(admin, person());
    const proof = await stage(manager, "PAYMENT", "PROOF_OF_PAYMENT", PNG, "mpesa.png");
    const pay = await recordPayment(manager, { partyId: party.id, method: "MPESA", reference: "DOC1", amount: 100, receivedDate: todayISO(), evidenceNote: null }, { documentIds: [proof.id] });
    expect((await listDocuments(finance, "PAYMENT", pay.id)).documents.map((d) => d.originalName)).toEqual(["mpesa.png"]);

    const receipt = await stageUpload(finance, { ownerType: "EXPENSE", category: "RECEIPT", fileName: "payslip.pdf", bytes: PDF });
    const mary = await saveStaff(admin, null, { fullName: "Mary", position: "Cleaner", phone: null, salaryAmount: null, startDate: null, endDate: null, notes: null });
    const exp = await recordSalaryPayment(finance, { staffMemberId: mary.id, month: monthStart(todayISO()), gross: 100, allowances: 0, deductions: 0, notes: null, evidenceNote: null }, true, { documentIds: [receipt.id] });
    expect((await listDocuments(finance, "EXPENSE", exp.id)).documents).toHaveLength(1);
    expect((await listDocuments(manager, "EXPENSE", exp.id)).documents).toHaveLength(0); // no salary access
    expect(await documentForDownload(manager, receipt.id)).toBeNull();
  });
});

describe("Add Account: account, agreement and documents in one transaction", () => {
  beforeEach(resetTestData);

  const tenancy = (over = {}) => ({
    startDate: addMonths(monthStart(todayISO()), -1), endDate: null, rentAmount: 2500000, dueDay: 5, graceDays: null, reference: "RA-001", lateFeeTerms: null, allocationTerms: null, notes: null, ...over,
  });
  const tenant = (unitId: string, over: Partial<NewAccountInput> = {}): NewAccountInput => ({
    party: person(), accountType: "TENANT", unitId, tenancy: tenancy(), documents: { account: [], agreement: [], management: [] }, ...over,
  });

  it("creates the account and its rental agreement and routes each document to the right record", async () => {
    const unit = await building();
    const id = await stage(manager, "PARTY", "ID_DOCUMENT");
    const signed = await stage(manager, "AGREEMENT", "SIGNED_AGREEMENT", PDF, "agreement.pdf");
    const { party, agreement } = await createAccount(manager, tenant(unit.id, { party: person({ phone: "0700111222" }), documents: { account: [id.id], agreement: [signed.id], management: [] } }));
    expect(agreement).toMatchObject({ partyId: party.id, unitId: unit.id, type: "RENTAL", status: "ACTIVE", reference: "RA-001", dueDay: 5 });
    expect(agreement.rentAmount!.toString()).toBe("25000");
    expect(await db.document.findUniqueOrThrow({ where: { id: id.id } })).toMatchObject({ ownerType: "PARTY", ownerId: party.id });
    expect(await db.document.findUniqueOrThrow({ where: { id: signed.id } })).toMatchObject({ ownerType: "AGREEMENT", ownerId: agreement.id });
    const actions = (await db.auditEvent.findMany({ where: { entityId: { in: [party.id, agreement.id] } }, orderBy: { id: "asc" } })).map((e) => e.action);
    expect(actions).toEqual(["account.create", "agreement.create", "document.attach", "document.attach"]);
  });

  it("saves nothing when any part fails, and keeps the uploads staged for a retry", async () => {
    const unit = await building();
    const other = await createParty(admin, person({ displayName: "Existing tenant" }));
    await createAgreement(manager, { ...tenancy(), type: "RENTAL", unitId: unit.id, partyId: other.id, managementFeeAmount: null, purchaseDate: null, ownershipEvidence: null });
    const unit2 = await createUnit(manager, { unitNumber: "A-2", floor: null, unitType: null, notes: null });
    const upload = await stage(manager);
    const before = { parties: await db.party.count(), agreements: await db.agreement.count(), audit: await db.auditEvent.count() };
    const docs = { account: [upload.id], agreement: [], management: [] };

    await expect(createAccount(manager, tenant(unit.id, { party: person({ displayName: "New" }), documents: docs }))).rejects.toThrow(/already has an agreement/);
    await expect(createAccount(manager, tenant(unit.id, { party: person({ displayName: "New" }), tenancy: tenancy({ endDate: "2000-01-01" }), documents: docs }))).rejects.toThrow(/End date/);
    await expect(createAccount(manager, tenant("no-such-unit", { party: person({ displayName: "New" }), documents: docs }))).rejects.toThrow(/Choose a unit/);
    await expect(createAccount(manager, tenant(unit2.id, { party: person({ displayName: "New" }), documents: { account: [upload.id, "missing-upload"], agreement: [], management: [] } }))).rejects.toThrow(/could not be found/);

    expect({ parties: await db.party.count(), agreements: await db.agreement.count(), audit: await db.auditEvent.count() }).toEqual(before);
    expect(await db.document.findUniqueOrThrow({ where: { id: upload.id } })).toMatchObject({ ownerType: null }); // can be reused
    const ok = await createAccount(manager, tenant(unit2.id, { party: person({ displayName: "New" }), documents: docs }));
    expect(await db.document.findUniqueOrThrow({ where: { id: upload.id } })).toMatchObject({ ownerType: "PARTY", ownerId: ok.party.id });
  });

  it("refuses a retired unit and duplicate accounts, including simultaneous submissions", async () => {
    const unit = await building();
    const spare = await Promise.all(["B-1", "B-2", "B-3", "B-4"].map((n) => createUnit(manager, { unitNumber: n, floor: null, unitType: null, notes: null })));
    await db.unit.update({ where: { id: unit.id }, data: { isActive: false } });
    await expect(createAccount(manager, tenant(unit.id))).rejects.toThrow(/retired/);
    await createAccount(manager, tenant(spare[0].id, { party: person({ email: "a@x.com" }) }));
    await expect(createAccount(manager, tenant(spare[1].id, { party: person({ email: "A@X.com " }) }))).rejects.toBeInstanceOf(DuplicateAccountError);
    const results = await Promise.allSettled([1, 2, 3].map((k) => createAccount(manager, tenant(spare[k].id, { party: person({ phone: "0711000000" }) }))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.party.count()).toBe(2);
  });
});

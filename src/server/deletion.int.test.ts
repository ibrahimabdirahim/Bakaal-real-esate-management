// One simple confirmation for deletions (F57): nothing to type, and the server still decides.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { createAccount, createUnit } from "@/server/services/property";
import { createManualInvoice, discardDraftInvoice } from "@/server/services/finance";
import { todayISO } from "@/lib/dates";

assertTestDatabase();

const admin = actor("ADMIN");
const manager = actor("MANAGER");
const finance = actor("FINANCE");
const today = todayISO();

beforeEach(async () => {
  await resetTestData();
  await db.building.create({ data: { name: "Delete Building" } });
});

describe("deleting a draft invoice", () => {
  it("needs no reason, is audited, refuses an issued invoice and a role without the permission", async () => {
    const unit = await createUnit(admin, { unitNumber: "D1", floor: null, unitType: null, notes: null });
    const { party, agreement } = await createAccount(manager, { party: { displayName: "Draft Owner", phone: "0700 600 001", email: null, idNumber: null, notes: null }, accountType: "TENANT", unitId: unit.id, tenancy: { startDate: today, endDate: null, rentAmount: 100000, dueDay: 5, graceDays: null, reference: null, lateFeeTerms: null, allocationTerms: null, notes: null }, documents: { account: [], agreement: [], management: [] } });
    const lines = [{ category: "OTHER" as const, description: "Key", amount: 5000 }];
    const draft = await createManualInvoice(manager, { partyId: party.id, unitId: unit.id, agreementId: agreement.id, notes: null, dueDate: today, lines });
    const issued = await createManualInvoice(finance, { partyId: party.id, unitId: unit.id, agreementId: agreement.id, notes: null, dueDate: today, lines }, { issue: true });
    await expect(discardDraftInvoice(actor("OPERATIONS"), draft.id)).rejects.toThrow(/permission/);
    await expect(discardDraftInvoice(finance, issued.id)).rejects.toThrow(/Only drafts/);
    await discardDraftInvoice(manager, draft.id);
    expect(await db.invoice.findUnique({ where: { id: draft.id } })).toBeNull();
    expect(await db.invoice.findUnique({ where: { id: issued.id } })).not.toBeNull();
    expect(await db.auditEvent.count({ where: { entityId: draft.id, action: "invoice.draft_discard", reason: null } })).toBe(1);
  });
});

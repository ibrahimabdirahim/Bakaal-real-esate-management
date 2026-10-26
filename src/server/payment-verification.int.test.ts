// Payment verification: independent verification by default; a System Administrator may verify
// a payment they recorded under the self-verification exception, always explicit, reasoned and audited.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { PermissionError, type Actor } from "@/server/auth/actor";
import { createAgreement, createParty, createUnit } from "@/server/services/property";
import { issueBilling } from "@/server/services/billing";
import {
  allocatePayment,
  partyFinancialSummary,
  recordPayment,
  rejectPayment,
  selfVerificationEligibility,
  verifyPayment,
  verifyPaymentSelf,
} from "@/server/services/finance";
import { addMonths, monthStart, todayISO } from "@/lib/dates";

assertTestDatabase();

const manager = actor("MANAGER");
const operations = actor("OPERATIONS");
const today = todayISO();
const lastMonth = addMonths(monthStart(today), -1);
const REASON = "Sole administrator; matched code on the M-Pesa statement";

/** Real staff rows, because the exception depends on who else exists and is active. */
async function staff(role: Actor["role"], email: string, isActive = true): Promise<Actor> {
  const u = await db.user.create({ data: { email, name: `${role} ${email}`, role, passwordHash: "x", isActive } });
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

let tenantId = "";
let ref = 0;
const pay = (who: Actor, amount = 1000000) => recordPayment(who, { partyId: tenantId, method: "MPESA", reference: `SV${++ref}`, amount, receivedDate: today, evidenceNote: null });

beforeEach(async () => {
  await resetTestData();
  await db.building.create({ data: { name: "Verification Building" } });
  const unit = await createUnit(manager, { unitNumber: "A-1", floor: null, unitType: null, notes: null });
  const tenant = await createParty(actor("ADMIN"), { displayName: "Tenant", phone: null, email: null, idNumber: null, notes: null });
  tenantId = tenant.id;
  await createAgreement(manager, { type: "RENTAL", unitId: unit.id, partyId: tenant.id, reference: null, startDate: lastMonth, endDate: null, rentAmount: 2500000, managementFeeAmount: null, dueDay: 5, graceDays: null, purchaseDate: null, ownershipEvidence: null, lateFeeTerms: null, allocationTerms: null, notes: null });
  await issueBilling(actor("FINANCE"), lastMonth);
});

describe("administrator self-verification exception", () => {
  it("lets the sole administrator verify their own payment, explicitly, with a full audit record", async () => {
    const admin = await staff("ADMIN", "only.admin@test.local");
    const p = await pay(admin);
    await expect(verifyPayment(admin, p.id)).rejects.toThrow(/someone other than the person who recorded it/); // normal path unchanged
    expect(await selfVerificationEligibility(admin, p)).toMatchObject({ eligible: true });

    const before = Date.now();
    const v = await verifyPaymentSelf(admin, p.id, { reason: REASON, confirmed: true });
    expect(v).toMatchObject({ status: "VERIFIED", verifiedById: admin.id, recordedById: admin.id });
    expect(v.receiptNumber).toMatch(/^RCT-\d{4}-000001$/);

    const event = await db.auditEvent.findFirstOrThrow({ where: { entityId: p.id, action: "payment.verify_self_exception" } });
    expect(event).toMatchObject({ actorId: admin.id, actorEmail: admin.email, reason: REASON });
    expect(event.occurredAt.getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect(event.after).toMatchObject({ exception: "ADMINISTRATOR_SELF_APPROVAL", otherActiveVerifiers: 0, recordedById: admin.id, verifiedById: admin.id, reference: p.reference, amount: "10000", method: "MPESA", receiptNumber: v.receiptNumber });

    // Balances move only through the normal allocation rules.
    expect((await partyFinancialSummary(tenantId)).accountBalance).toBe(1500000);
    const inv = await db.invoice.findFirstOrThrow();
    await expect(allocatePayment(admin, p.id, [{ invoiceId: inv.id, amount: 1000001 }])).rejects.toThrow(/unallocated/);
    await allocatePayment(admin, p.id, [{ invoiceId: inv.id, amount: 1000000 }]);
    expect(await partyFinancialSummary(tenantId)).toMatchObject({ accountBalance: 1500000, invoiceBalances: 1500000, unallocated: 0 });
  });

  it("is never automatic: needs the confirmation and a real reason, else nothing changes", async () => {
    const admin = await staff("ADMIN", "only.admin@test.local");
    const p = await pay(admin);
    await expect(verifyPaymentSelf(admin, p.id, { reason: REASON, confirmed: false })).rejects.toThrow(/Confirm/);
    await expect(verifyPaymentSelf(admin, p.id, { reason: "   ok   ", confirmed: true })).rejects.toThrow(/at least 10 characters/);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("PENDING");
    expect(await db.auditEvent.count({ where: { entityId: p.id, action: { startsWith: "payment.verify" } } })).toBe(0);
  });

  it("is not blocked by another active verifier, but says so and records how many there were", async () => {
    const admin = await staff("ADMIN", "admin@test.local");
    const fin = await staff("FINANCE", "finance@test.local");
    const p = await pay(admin);
    expect(await selfVerificationEligibility(admin, p)).toMatchObject({ eligible: true, others: 1, why: expect.stringMatching(/1 other active staff member/) });
    await verifyPaymentSelf(admin, p.id, { reason: REASON, confirmed: true });
    const event = await db.auditEvent.findFirstOrThrow({ where: { entityId: p.id, action: "payment.verify_self_exception" } });
    expect(event.after).toMatchObject({ otherActiveVerifiers: 1 });

    // Independent verification by the other person still works as before.
    const q = await pay(admin);
    const v = await verifyPayment(fin, q.id);
    expect(v).toMatchObject({ status: "VERIFIED", verifiedById: fin.id, recordedById: admin.id });
    expect(await db.auditEvent.count({ where: { entityId: q.id, action: "payment.verify" } })).toBe(1);
  });

  it("counts only active staff as other verifiers", async () => {
    const admin = await staff("ADMIN", "admin@test.local");
    await staff("FINANCE", "left@test.local", false);
    const p = await pay(admin);
    expect(await selfVerificationEligibility(admin, p)).toMatchObject({ eligible: true, others: 0 });
  });

  it("is only for administrators, only for their own payments", async () => {
    const admin = await staff("ADMIN", "admin@test.local");
    const fin = await staff("FINANCE", "finance@test.local");
    const byFinance = await pay(fin);
    await expect(verifyPaymentSelf(fin, byFinance.id, { reason: REASON, confirmed: true })).rejects.toThrow(/Only a System Administrator/);
    const byManager = await pay(manager);
    await expect(verifyPaymentSelf(manager, byManager.id, { reason: REASON, confirmed: true })).rejects.toBeInstanceOf(PermissionError);
    await expect(verifyPaymentSelf(operations, byManager.id, { reason: REASON, confirmed: true })).rejects.toBeInstanceOf(PermissionError);
    await expect(verifyPaymentSelf(admin, byManager.id, { reason: REASON, confirmed: true })).rejects.toThrow(/only applies to payments you recorded/);
    await verifyPayment(admin, byManager.id); // someone else's payment: normal independent verification
    expect((await db.payment.findUniqueOrThrow({ where: { id: byManager.id } })).verifiedById).toBe(admin.id);
  });

  it("verifies at most once under concurrent or repeated requests", async () => {
    const admin = await staff("ADMIN", "only.admin@test.local");
    const p = await pay(admin);
    const results = await Promise.allSettled([1, 2, 3].map(() => verifyPaymentSelf(admin, p.id, { reason: REASON, confirmed: true })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(verifyPaymentSelf(admin, p.id, { reason: REASON, confirmed: true })).rejects.toThrow(/already verified/);
    expect(await db.payment.count({ where: { receiptNumber: { not: null } } })).toBe(1);

    const q = await pay(admin);
    const race = await Promise.allSettled([verifyPaymentSelf(admin, q.id, { reason: REASON, confirmed: true }), rejectPayment(admin, q.id, "Not on statement")]);
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(["VERIFIED", "REJECTED"]).toContain((await db.payment.findUniqueOrThrow({ where: { id: q.id } })).status);
  });

  it("leaves rejection unchanged and keeps rejected payments out of balances", async () => {
    const admin = await staff("ADMIN", "only.admin@test.local");
    const p = await pay(admin);
    await rejectPayment(admin, p.id, "Not on statement");
    await expect(verifyPaymentSelf(admin, p.id, { reason: REASON, confirmed: true })).rejects.toThrow(/already rejected/);
    expect((await partyFinancialSummary(tenantId)).accountBalance).toBe(2500000);
  });
});

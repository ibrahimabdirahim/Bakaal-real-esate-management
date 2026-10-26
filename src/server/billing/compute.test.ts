import { describe, expect, it } from "vitest";
import { computeBillingPreview, resolveDueDay, type BillableAgreement } from "@/server/billing/compute";

const P = "2026-11-01";

function agreement(over: Partial<BillableAgreement> = {}): BillableAgreement {
  return {
    id: "ag1",
    type: "RENTAL",
    status: "ACTIVE",
    partyId: "p1",
    partyName: "Tenant One",
    unitId: "u1",
    unitNumber: "A-101",
    startDate: "2026-01-01",
    endDate: null,
    rentAmount: 2500000,
    managementFeeAmount: null,
    dueDay: 5,
    charges: [],
    ...over,
  };
}

function run(agreements: BillableAgreement[], opts: { invoiced?: string[]; policies?: { value: string; effectiveFrom: string }[] } = {}) {
  return computeBillingPreview({
    periodStart: P,
    agreements,
    policies: (opts.policies ?? []).map((p) => ({ key: "DEFAULT_DUE_DAY" as const, ...p })),
    alreadyInvoicedAgreementIds: new Set(opts.invoiced ?? []),
  });
}

describe("monthly billing", () => {
  it("bills rent for an active tenant with a valid agreement", () => {
    const r = run([agreement()]);
    expect(r.invoices).toHaveLength(1);
    expect(r.invoices[0]).toMatchObject({ total: 2500000, dueDate: "2026-11-05", dueDateSource: "AGREEMENT", periodEnd: "2026-11-30" });
    expect(r.invoices[0].lines).toEqual([expect.objectContaining({ category: "RENT", amount: 2500000 })]);
  });

  it("keeps rent and approved shared charges on separate lines", () => {
    const r = run([
      agreement({
        charges: [{ id: "c1", category: "SHARED_CHARGE", description: "Water", amount: 150000, effectiveFrom: "2026-01-01", effectiveTo: null }],
      }),
    ]);
    expect(r.invoices[0].lines.map((l) => [l.category, l.amount])).toEqual([
      ["RENT", 2500000],
      ["SHARED_CHARGE", 150000],
    ]);
    expect(r.invoices[0].total).toBe(2650000);
  });

  it("never charges rent to a purchased-unit owner; only approved charges", () => {
    const r = run([
      agreement({
        type: "OWNERSHIP",
        rentAmount: null,
        charges: [{ id: "c1", category: "SERVICE_CHARGE", description: "Cleaning", amount: 50000, effectiveFrom: "2026-01-01", effectiveTo: null }],
      }),
    ]);
    expect(r.invoices[0].lines.map((l) => l.category)).toEqual(["SERVICE_CHARGE"]);
  });

  it("creates nothing for an owner with no approved charges", () => {
    const r = run([agreement({ type: "OWNERSHIP", rentAmount: null })]);
    expect(r.invoices).toHaveLength(0);
    expect(r.nothingToBill).toHaveLength(1);
    expect(r.exceptions).toHaveLength(0);
  });

  it("bills a management fee for a unit managed by Bakaal, with no rent", () => {
    const r = run([agreement({ type: "MANAGEMENT", rentAmount: null, managementFeeAmount: 300000 })]);
    expect(r.invoices[0].lines).toEqual([expect.objectContaining({ category: "MANAGEMENT_FEE", amount: 300000 })]);
  });

  it("bills no fee, but flags for review, a managed unit whose fee is not recorded; its approved charges are still billed", () => {
    const noFee = agreement({ id: "m1", type: "MANAGEMENT", rentAmount: null, managementFeeAmount: null });
    const r = run([noFee]);
    expect(r.invoices).toHaveLength(0);
    expect(r.reviews).toEqual([expect.objectContaining({ agreementId: "m1", message: expect.stringMatching(/No management fee is recorded/) })]);
    expect(r.exceptions).toHaveLength(0); // not held: nothing is invented, nothing is blocked
    const withCharge = run([{ ...noFee, charges: [{ id: "c1", category: "SHARED_CHARGE", description: "Approved water share", amount: 80000, effectiveFrom: "2026-01-01", effectiveTo: null }] }]);
    expect(withCharge.invoices[0].lines.map((l) => l.category)).toEqual(["SHARED_CHARGE"]);
    expect(withCharge.reviews).toHaveLength(1);
    expect(run([agreement({ type: "MANAGEMENT", rentAmount: null, managementFeeAmount: 300000 })]).reviews).toEqual([]);
  });

  it("does not bill a vacant unit (no agreement means no invoice)", () => {
    expect(run([]).invoices).toHaveLength(0);
  });

  it("ignores agreements that ended before the month or start after it", () => {
    const r = run([
      agreement({ id: "old", endDate: "2026-10-31" }),
      agreement({ id: "future", startDate: "2026-12-01" }),
      agreement({ id: "cancelled", status: "CANCELLED" }),
    ]);
    expect(r.invoices).toHaveLength(0);
    expect(r.exceptions).toHaveLength(0);
  });

  it("flags, and does not prorate, an agreement starting mid-month", () => {
    const r = run([agreement({ startDate: "2026-11-15" })]);
    expect(r.invoices).toHaveLength(0);
    expect(r.exceptions[0].code).toBe("PARTIAL_PERIOD");
  });

  it("flags, and does not prorate, an agreement ending mid-month", () => {
    const r = run([agreement({ endDate: "2026-11-20", status: "ENDED" })]);
    expect(r.invoices).toHaveLength(0);
    expect(r.exceptions[0].code).toBe("PARTIAL_PERIOD");
  });

  it("bills an agreement whose end date is the last day of the month", () => {
    expect(run([agreement({ endDate: "2026-11-30", status: "ENDED" })]).invoices).toHaveLength(1);
  });

  it("holds the invoice when a charge covers only part of the month", () => {
    const r = run([
      agreement({ charges: [{ id: "c1", category: "SHARED_CHARGE", description: "Water", amount: 1000, effectiveFrom: "2026-11-10", effectiveTo: null }] }),
    ]);
    expect(r.invoices).toHaveLength(0);
    expect(r.exceptions[0].code).toBe("PARTIAL_CHARGE_PERIOD");
  });

  it("does not duplicate an invoice when the month is run twice", () => {
    const r = run([agreement()], { invoiced: ["ag1"] });
    expect(r.invoices).toHaveLength(0);
    expect(r.exceptions[0].code).toBe("ALREADY_INVOICED");
  });
});

describe("due date policy hierarchy", () => {
  it("uses the agreement's due day first", () => {
    expect(resolveDueDay(10, [{ key: "DEFAULT_DUE_DAY", value: "5", effectiveFrom: "2026-01-01" }], P)).toEqual({ day: 10, source: "AGREEMENT" });
  });

  it("falls back to an approved, effective building policy when the agreement is silent", () => {
    const r = run([agreement({ dueDay: null })], { policies: [{ value: "7", effectiveFrom: "2026-01-01" }] });
    expect(r.invoices[0]).toMatchObject({ dueDate: "2026-11-07", dueDateSource: "BUILDING_POLICY" });
  });

  it("uses the latest policy effective on the period start", () => {
    const policies = [
      { key: "DEFAULT_DUE_DAY" as const, value: "3", effectiveFrom: "2026-01-01" },
      { key: "DEFAULT_DUE_DAY" as const, value: "9", effectiveFrom: "2026-11-01" },
      { key: "DEFAULT_DUE_DAY" as const, value: "20", effectiveFrom: "2026-12-01" },
    ];
    expect(resolveDueDay(null, policies, P)).toEqual({ day: 9, source: "BUILDING_POLICY" });
  });

  it("flags the invoice for review when neither gives a due date", () => {
    const r = run([agreement({ dueDay: null })], { policies: [{ value: "7", effectiveFrom: "2027-01-01" }] });
    expect(r.invoices).toHaveLength(0);
    expect(r.exceptions[0].code).toBe("NO_DUE_DATE");
  });
});

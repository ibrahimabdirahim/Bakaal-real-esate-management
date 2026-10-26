import { describe, expect, it } from "vitest";
import { ageingBucket, buildStatement, compareByBillingPeriod, dueState, invoiceBalance, invoicePaymentStatus, type StatementEntry } from "@/server/ledger";

describe("invoice balance and status", () => {
  it("subtracts allocations and credit notes", () => {
    expect(invoiceBalance({ total: 10000, allocated: 4000, credited: 1000 })).toBe(5000);
  });

  it("classifies paid, part-paid and unpaid", () => {
    expect(invoicePaymentStatus({ total: 10000, allocated: 10000, credited: 0 })).toBe("PAID");
    expect(invoicePaymentStatus({ total: 10000, allocated: 2500, credited: 0 })).toBe("PART_PAID");
    expect(invoicePaymentStatus({ total: 10000, allocated: 0, credited: 0 })).toBe("UNPAID");
    expect(invoicePaymentStatus({ total: 10000, allocated: 0, credited: 10000 })).toBe("PAID");
  });
});

describe("due state", () => {
  it("is settled when nothing is owed", () => {
    expect(dueState(0, "2026-11-05", 3, "2026-12-01")).toBe("SETTLED");
  });
  it("is not due on or before the due date", () => {
    expect(dueState(100, "2026-11-05", null, "2026-11-05")).toBe("NOT_DUE");
  });
  it("does not invent a grace period when the agreement has none", () => {
    expect(dueState(100, "2026-11-05", null, "2026-11-06")).toBe("PAST_DUE_GRACE_UNKNOWN");
  });
  it("applies the agreement's grace period", () => {
    expect(dueState(100, "2026-11-05", 3, "2026-11-08")).toBe("WITHIN_GRACE");
    expect(dueState(100, "2026-11-05", 3, "2026-11-09")).toBe("OVERDUE");
  });
});

describe("arrears ageing", () => {
  it("buckets by days past due", () => {
    expect(ageingBucket("2026-11-05", "2026-11-05")).toBe("Not yet due");
    expect(ageingBucket("2026-11-05", "2026-11-06")).toBe("1–30 days");
    expect(ageingBucket("2026-09-01", "2026-11-01")).toBe("61–90 days");
    expect(ageingBucket("2026-01-01", "2026-11-01")).toBe("Over 90 days");
  });
});

describe("account statement", () => {
  const entries: StatementEntry[] = [
    { date: "2026-09-01", kind: "INVOICE", reference: "INV-1", description: "Sep", debit: 25000, credit: 0 },
    { date: "2026-09-10", kind: "PAYMENT", reference: "RCT-1", description: "", debit: 0, credit: 20000 },
    { date: "2026-10-01", kind: "INVOICE", reference: "INV-2", description: "Oct", debit: 25000, credit: 0 },
    { date: "2026-10-03", kind: "CREDIT_NOTE", reference: "CN-1", description: "", debit: 0, credit: 1000 },
    { date: "2026-10-05", kind: "PAYMENT", reference: "RCT-2", description: "", debit: 0, credit: 30000 },
    { date: "2026-10-20", kind: "PAYMENT_REVERSAL", reference: "RCT-2", description: "", debit: 30000, credit: 0 },
  ];

  it("carries unpaid debt forward as the opening balance", () => {
    const s = buildStatement(entries, "2026-10-01", "2026-10-31");
    expect(s.opening).toBe(5000);
  });

  it("satisfies opening + charges − payments − credits (+ reversals) = closing", () => {
    const s = buildStatement(entries, "2026-10-01", "2026-10-31");
    expect(s).toMatchObject({ charges: 25000, payments: 30000, credits: 1000, reversals: 30000 });
    expect(s.closing).toBe(s.opening + s.charges - s.payments - s.credits + s.reversals);
    expect(s.closing).toBe(29000);
    expect(s.entries.at(-1)?.balance).toBe(s.closing);
  });

  it("keeps each month's invoice as its own entry", () => {
    const s = buildStatement(entries, "2026-09-01", "2026-10-31");
    expect(s.entries.filter((e) => e.kind === "INVOICE").map((e) => e.reference)).toEqual(["INV-1", "INV-2"]);
  });
});

describe("open-invoice order for allocation", () => {
  const inv = (id: string, periodStart: string | null, issueDate: string | null, number: string | null) => ({ id, periodStart, issueDate, number });

  it("puts the oldest billing month first even when every month was issued the same day", () => {
    const list = [inv("c", "2026-09-01", "2026-10-22", "INV-1"), inv("a", "2026-07-01", "2026-10-22", "INV-2"), inv("d", "2026-10-01", "2026-10-22", "INV-3"), inv("b", "2026-08-01", "2026-10-22", "INV-4")];
    expect([...list].sort(compareByBillingPeriod).map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("orders a manual invoice by its issue date among the monthly ones", () => {
    const list = [inv("manual", null, "2026-08-15", "INV-9"), inv("sep", "2026-09-01", "2026-09-01", "INV-2"), inv("aug", "2026-08-01", "2026-08-01", "INV-1")];
    expect([...list].sort(compareByBillingPeriod).map((i) => i.id)).toEqual(["aug", "manual", "sep"]);
  });

  it("breaks ties by issue date, then number, then id, whatever the input order", () => {
    const list = [inv("z", "2026-08-01", "2026-08-03", "INV-1"), inv("y", "2026-08-01", "2026-08-02", "INV-2"), inv("x2", "2026-08-01", "2026-08-02", "INV-1"), inv("x1", "2026-08-01", "2026-08-02", "INV-1")];
    const expected = ["x1", "x2", "y", "z"];
    expect([...list].sort(compareByBillingPeriod).map((i) => i.id)).toEqual(expected);
    expect([...list].reverse().sort(compareByBillingPeriod).map((i) => i.id)).toEqual(expected);
  });
});

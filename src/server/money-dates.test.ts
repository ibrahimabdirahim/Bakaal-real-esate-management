import { describe, expect, it } from "vitest";
import { expensePaidDate, expenseServiceDate, inRange, isReceipt, reversalDate } from "@/server/money-dates";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("reporting dates", () => {
  it("dates an expense's cost by its service month, else the building-local day it was recorded", () => {
    expect(expenseServiceDate({ servicePeriodStart: d("2026-09-01"), createdAt: new Date("2026-10-20T08:00:00Z") })).toBe("2026-09-01");
    // 22:30 UTC on 31 Oct is already 1 Nov in Nairobi (UTC+3).
    expect(expenseServiceDate({ servicePeriodStart: null, createdAt: new Date("2026-10-31T22:30:00Z") })).toBe("2026-11-01");
  });

  it("dates money paid out by the actual payment date, falling back to the day it was marked paid", () => {
    expect(expensePaidDate({ status: "PAID", paidDate: d("2026-10-05"), paidAt: new Date("2026-10-07T09:00:00Z") })).toBe("2026-10-05");
    expect(expensePaidDate({ status: "PAID", paidDate: null, paidAt: new Date("2026-10-07T09:00:00Z") })).toBe("2026-10-07");
    expect(expensePaidDate({ status: "APPROVED", paidDate: null, paidAt: null })).toBeNull(); // approval is not payment
  });

  it("keeps a reversed receipt as received, and dates the reversal on its own day", () => {
    expect(isReceipt({ status: "VERIFIED" })).toBe(true);
    expect(isReceipt({ status: "REVERSED" })).toBe(true);
    expect(isReceipt({ status: "PENDING" })).toBe(false);
    expect(isReceipt({ status: "REJECTED" })).toBe(false);
    expect(reversalDate({ status: "REVERSED", reversedAt: new Date("2026-10-03T21:30:00Z") })).toBe("2026-10-04");
    expect(reversalDate({ status: "VERIFIED", reversedAt: null })).toBeNull();
  });

  it("treats a missing date as outside every range", () => {
    expect(inRange("2026-10-01", "2026-10-01", "2026-10-31")).toBe(true);
    expect(inRange("2026-11-01", "2026-10-01", "2026-10-31")).toBe(false);
    expect(inRange(null, "2026-10-01", "2026-10-31")).toBe(false);
  });
});

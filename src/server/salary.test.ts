import { describe, expect, it } from "vitest";
import { employedDuring, isFutureMonth, netSalary, salaryPeriod } from "@/server/salary";

describe("net salary", () => {
  it("adds allowances and subtracts deductions in exact cents", () => {
    expect(netSalary({ gross: 1800050, allowances: 250025, deductions: 100075 })).toEqual({ net: 1950000 });
    expect(netSalary({ gross: 1, allowances: 0, deductions: 0 })).toEqual({ net: 1 });
  });

  it("applies no statutory deduction of its own", () => {
    expect(netSalary({ gross: 5000000, allowances: 0, deductions: 0 })).toEqual({ net: 5000000 });
  });

  it("refuses a zero gross, negative parts, fractions of a cent and deductions that wipe out the pay", () => {
    expect(netSalary({ gross: 0, allowances: 100, deductions: 0 })).toMatchObject({ error: expect.stringMatching(/more than zero/) });
    expect(netSalary({ gross: 1000, allowances: -1, deductions: 0 })).toMatchObject({ error: expect.stringMatching(/Allowances/) });
    expect(netSalary({ gross: 1000, allowances: 0, deductions: 0.5 })).toMatchObject({ error: expect.stringMatching(/Deductions/) });
    expect(netSalary({ gross: 1000, allowances: 200, deductions: 1200 })).toMatchObject({ error: expect.stringMatching(/cannot equal or exceed/) });
  });
});

describe("salary periods", () => {
  it("covers a whole calendar month, including leap-year February", () => {
    expect(salaryPeriod("2026-10-17")).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(salaryPeriod("2028-02-03")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });

  it("allows the current and past months, never a future one", () => {
    expect(isFutureMonth("2026-10-01", "2026-10-22")).toBe(false);
    expect(isFutureMonth("2026-09-01", "2026-10-22")).toBe(false);
    expect(isFutureMonth("2026-11-01", "2026-10-22")).toBe(true);
  });

  it("counts a month as employed if any part of it falls within the employment dates", () => {
    expect(employedDuring({ startDate: "2026-10-31", endDate: null }, "2026-10-01")).toBe(true);
    expect(employedDuring({ startDate: null, endDate: "2026-10-01" }, "2026-10-01")).toBe(true);
    expect(employedDuring({ startDate: "2026-11-01", endDate: null }, "2026-10-01")).toBe(false);
    expect(employedDuring({ startDate: null, endDate: "2026-09-30" }, "2026-10-01")).toBe(false);
  });
});

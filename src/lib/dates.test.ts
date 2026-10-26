import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  dayOfMonth,
  daysBetween,
  fromDbDate,
  isISODate,
  monthEnd,
  monthStart,
  toDbDate,
  todayISO,
} from "@/lib/dates";

describe("date helpers", () => {
  it("validates real calendar dates only", () => {
    expect(isISODate("2026-02-28")).toBe(true);
    expect(isISODate("2026-02-29")).toBe(false);
    expect(isISODate("2028-02-29")).toBe(true);
    expect(isISODate("2026-13-01")).toBe(false);
    expect(isISODate("26-1-1")).toBe(false);
  });

  it("round-trips through database dates without shifting a day", () => {
    expect(fromDbDate(toDbDate("2026-10-31"))).toBe("2026-10-31");
  });

  it("finds month boundaries including leap years", () => {
    expect(monthStart("2026-10-21")).toBe("2026-10-01");
    expect(monthEnd("2026-02-01")).toBe("2026-02-28");
    expect(monthEnd("2028-02-01")).toBe("2028-02-29");
    expect(monthEnd("2026-12-01")).toBe("2026-12-31");
  });

  it("adds months and days across year ends", () => {
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-01-01", "2026-03-01")).toBe(59);
  });

  it("builds due dates only for days 1–28", () => {
    expect(dayOfMonth("2026-02-01", 5)).toBe("2026-02-05");
    expect(() => dayOfMonth("2026-02-01", 29)).toThrow();
    expect(() => dayOfMonth("2026-02-01", 0)).toThrow();
  });

  it("uses the building time zone for today", () => {
    // 22:30 UTC on 31 Oct is already 1 Nov in Nairobi (UTC+3).
    expect(todayISO(new Date("2026-10-31T22:30:00Z"))).toBe("2026-11-01");
  });
});

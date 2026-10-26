import { describe, expect, it } from "vitest";
import { todayISO } from "./dates";
import { chartMonths, periodQuery, periodRange, resolveDashboardPeriod } from "./dashboard-period";

const today = "2026-10-24";

describe("dashboard periods", () => {
  it("keeps the named periods as they were", () => {
    expect(periodRange("month", today)).toEqual({ from: "2026-10-01", to: today });
    expect(periodRange("last-month", today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodRange("3m", today)).toEqual({ from: "2026-08-01", to: today });
    expect(periodRange("ytd", today)).toEqual({ from: "2026-01-01", to: today });
    expect(resolveDashboardPeriod({}, today)).toEqual({ period: "month", range: { from: "2026-10-01", to: today }, label: "This month" });
    expect(resolveDashboardPeriod({ period: "6m" }, today)).toMatchObject({ period: "6m", label: "Last 6 months" });
    expect(resolveDashboardPeriod({ period: "nonsense" }, today)).toMatchObject({ period: "month" });
  });

  it("uses a valid custom range, labelled with both dates", () => {
    expect(resolveDashboardPeriod({ period: "custom", from: "2026-09-15", to: "2026-10-05" }, today)).toEqual({
      period: "custom",
      range: { from: "2026-09-15", to: "2026-10-05" },
      label: "15 Sept 2026 – 05 Oct 2026",
    });
    // A single day, and today itself, are allowed.
    expect(resolveDashboardPeriod({ period: "custom", from: today, to: today }, today)).toMatchObject({ period: "custom", range: { from: today, to: today } });
  });

  it("refuses a start after the end, missing or impossible dates, the future and before 2000", () => {
    const cases: [Record<string, string>, RegExp][] = [
      [{ from: "2026-10-10", to: "2026-10-09" }, /start date is after the end date/],
      [{ from: "", to: "2026-10-09" }, /both a start date and an end date/],
      [{ from: "2026-02-30", to: "2026-03-01" }, /valid start and end dates/],
      [{ from: "2026-10-01", to: "2026-10-25" }, /cannot be after today \(24 Oct 2026\)/],
      [{ from: "1999-12-31", to: "2000-01-05" }, /cannot be before 01 Jan 2000/],
    ];
    for (const [q, msg] of cases) {
      const r = resolveDashboardPeriod({ period: "custom", ...q }, today);
      expect(r.error).toMatch(msg);
      expect(r).toMatchObject({ period: "month", range: periodRange("month", today), entered: q }); // falls back, keeps what was typed
    }
  });

  it("handles month, year and leap-year boundaries", () => {
    expect(resolveDashboardPeriod({ period: "custom", from: "2026-01-31", to: "2026-02-01" }, today).range).toEqual({ from: "2026-01-31", to: "2026-02-01" });
    expect(resolveDashboardPeriod({ period: "custom", from: "2025-12-31", to: "2026-01-01" }, today)).toMatchObject({ period: "custom", label: "31 Dec 2025 – 01 Jan 2026" });
    expect(resolveDashboardPeriod({ period: "custom", from: "2024-02-29", to: "2024-03-01" }, today).period).toBe("custom");
    expect(resolveDashboardPeriod({ period: "custom", from: "2025-02-29", to: "2025-03-01" }, today).error).toMatch(/valid/);
    expect(periodRange("last-month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(periodRange("last-month", "2024-03-10")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(periodRange("ytd", "2026-01-01")).toEqual({ from: "2026-01-01", to: "2026-01-01" });
  });

  it("takes today, and the latest allowed end, in Nairobi time around midnight", () => {
    // 20:59 UTC on 31 Dec is 23:59 in Nairobi (still 31 Dec); 21:00 UTC is already 1 Jan.
    expect(todayISO(new Date("2026-12-31T20:59:59Z"))).toBe("2026-12-31");
    const newYear = todayISO(new Date("2026-12-31T21:00:00Z"));
    expect(newYear).toBe("2027-01-01");
    expect(periodRange("month", newYear)).toEqual({ from: "2027-01-01", to: "2027-01-01" });
    expect(periodRange("ytd", newYear)).toEqual({ from: "2027-01-01", to: "2027-01-01" });
    expect(resolveDashboardPeriod({ period: "custom", from: "2026-12-31", to: "2027-01-01" }, newYear).period).toBe("custom");
    expect(resolveDashboardPeriod({ period: "custom", from: "2026-12-31", to: "2027-01-01" }, todayISO(new Date("2026-12-31T20:59:59Z"))).error).toMatch(/after today \(31 Dec 2026\)/);
  });

  it("builds the address for other pages and the chart months", () => {
    expect(periodQuery({ period: "month", range: periodRange("month", today) })).toBe("");
    expect(periodQuery({ period: "3m", range: periodRange("3m", today) })).toBe("period=3m");
    expect(periodQuery({ period: "custom", range: { from: "2026-09-15", to: "2026-10-05" } })).toBe("period=custom&from=2026-09-15&to=2026-10-05");
    expect(chartMonths({ from: "2026-10-03", to: "2026-10-24" })).toEqual(["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"]);
    expect(chartMonths({ from: "2025-11-20", to: "2026-02-03" })).toEqual(["2025-09-01", "2025-10-01", "2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
    const long = chartMonths({ from: "2020-01-01", to: "2026-10-24" });
    expect([long.length, long[0], long.at(-1)]).toEqual([24, "2024-11-01", "2026-10-01"]);
  });
});

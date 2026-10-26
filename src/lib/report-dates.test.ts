import { describe, expect, it } from "vitest";
import { checkRange, monthsOf, sameSpanLastYear, within, yearRange } from "./report-dates";

describe("report periods", () => {
  it("rejects a start after the end and invalid dates, keeping a valid range as given", () => {
    const fb = { from: "2026-10-01", to: "2026-10-23" };
    expect(checkRange("2026-10-10", "2026-10-01", fb)).toEqual({ error: expect.stringMatching(/start date is after the end date/) });
    expect(checkRange("2026-02-30", "2026-03-01", fb)).toEqual({ error: "Enter valid start and end dates." });
    expect(checkRange("2026-01-31", "2026-01-31", fb)).toEqual({ range: { from: "2026-01-31", to: "2026-01-31" } });
    expect(checkRange(undefined, undefined, fb)).toEqual({ range: fb });
  });
  it("gives calendar months with their real last day, including leap Februaries", () => {
    expect(monthsOf(2024)[1]).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(monthsOf(2026)[1]).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthsOf(2026)[11]).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(monthsOf(2026).map((m) => m.to.slice(8))).toEqual(["31", "28", "31", "30", "31", "30", "31", "31", "30", "31", "30", "31"]);
  });
  it("cuts the current year at today and keeps past years whole", () => {
    expect(yearRange(2026, "2026-10-23")).toEqual({ from: "2026-01-01", to: "2026-10-23", partial: true });
    expect(yearRange(2025, "2026-10-23")).toEqual({ from: "2025-01-01", to: "2025-12-31", partial: false });
  });
  it("compares the same span a year earlier, 29 February becoming 28 February", () => {
    expect(sameSpanLastYear({ from: "2026-01-01", to: "2026-10-23" })).toEqual({ from: "2025-01-01", to: "2025-10-23" });
    expect(sameSpanLastYear({ from: "2024-02-01", to: "2024-02-29" })).toEqual({ from: "2023-02-01", to: "2023-02-28" });
  });
  it("includes both ends of a range", () => {
    const r = { from: "2026-01-31", to: "2026-02-01" };
    expect([within("2026-01-30", r), within("2026-01-31", r), within("2026-02-01", r), within("2026-02-02", r)]).toEqual([false, true, true, false]);
  });
});

describe("dates in the building's time zone (Africa/Nairobi)", () => {
  it("turns a timestamp after local midnight on 31 December into the new year, and shows stored dates unshifted", async () => {
    const { todayISO, formatDate } = await import("./dates");
    const { formatCell } = await import("./report-doc");
    expect(todayISO(new Date("2026-12-31T21:00:00Z"))).toBe("2027-01-01"); // 00:00 in Nairobi
    expect(todayISO(new Date("2026-12-31T20:59:59Z"))).toBe("2026-12-31");
    expect(formatDate("2024-02-29")).toBe("29 Feb 2024");
    expect(formatCell("2026-12-31", "date")).toBe("31 Dec 2026");
  });
});

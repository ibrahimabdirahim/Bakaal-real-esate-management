import { describe, expect, it } from "vitest";
import { sharePercents } from "./charts";

describe("sharePercents", () => {
  it("always adds up to 100", () => {
    expect(sharePercents([1, 7])).toEqual([13, 87]);
    expect(sharePercents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(sharePercents([0, 50])).toEqual([0, 100]);
    expect(sharePercents([3, 47]).reduce((a, b) => a + b)).toBe(100);
  });

  it("handles a zero total without dividing by zero", () => {
    expect(sharePercents([0, 0])).toEqual([0, 0]);
    expect(sharePercents([])).toEqual([]);
  });
});

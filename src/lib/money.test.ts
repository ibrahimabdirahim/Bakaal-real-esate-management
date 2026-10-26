import { describe, expect, it } from "vitest";
import { centsToDecimalString, formatMoney, sumCents, toCents, tryCents } from "@/lib/money";

describe("toCents", () => {
  it("parses whole, one-decimal and two-decimal amounts", () => {
    expect(toCents("1250")).toBe(125000);
    expect(toCents("1250.5")).toBe(125050);
    expect(toCents("1,250.05")).toBe(125005);
    expect(toCents("0.01")).toBe(1);
  });

  it("parses database decimals passed as objects", () => {
    expect(toCents({ toString: () => "980000.00" })).toBe(98000000);
  });

  it("rejects malformed and over-precise amounts", () => {
    expect(() => toCents("12.345")).toThrow();
    expect(() => toCents("abc")).toThrow();
    expect(() => toCents("")).toThrow();
    expect(() => toCents("1e5")).toThrow();
    expect(tryCents("12.345")).toBeNull();
    expect(tryCents("  ")).toBeNull();
  });

  it("rejects amounts that do not fit the database column", () => {
    expect(() => toCents("1000000000000000")).toThrow();
  });
});

describe("cent arithmetic avoids floating-point error", () => {
  it("adds 0.10 + 0.20 exactly", () => {
    expect(centsToDecimalString(sumCents([toCents("0.10"), toCents("0.20")]))).toBe("0.30");
  });

  it("round-trips through the decimal string format", () => {
    for (const s of ["0.00", "0.07", "15.50", "123456789.99"]) {
      expect(centsToDecimalString(toCents(s))).toBe(s);
    }
    expect(centsToDecimalString(-150)).toBe("-1.50");
  });
});

describe("formatMoney", () => {
  it("formats with currency and thousands separators", () => {
    expect(formatMoney(98000000)).toBe("KES 980,000.00");
    expect(formatMoney(-5)).toBe("-KES 0.05");
  });
});

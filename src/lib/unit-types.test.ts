import { describe, expect, it } from "vitest";
import { UNIT_TYPES, matchUnitType, unitTypeProblem } from "./unit-types";

describe("unit types", () => {
  it("lists the seven types in the agreed order", () => {
    expect(UNIT_TYPES).toEqual(["1 Bedroom", "2 Bedroom", "3 Bedroom", "4 Bedroom", "5 Bedroom", "Shop", "Store"]);
  });

  it("accepts each listed type and a blank type", () => {
    for (const t of UNIT_TYPES) expect(unitTypeProblem(t)).toBeNull();
    expect(unitTypeProblem(null)).toBeNull();
  });

  it("refuses anything else, including a different spelling", () => {
    for (const t of ["Studio", "2 bedroom", "2 Bedrooms", "Shop 01"]) expect(unitTypeProblem(t)).toMatch(/must be one of/);
  });

  it("matches a typed type to the listed one regardless of case and spacing", () => {
    expect(matchUnitType("1 bedroom")).toBe("1 Bedroom");
    expect(matchUnitType("  2   BEDROOM ")).toBe("2 Bedroom");
    expect(matchUnitType("store")).toBe("Store");
    expect(matchUnitType("Studio")).toBeNull();
    expect(matchUnitType(null)).toBeNull();
  });

  it("lets a unit keep a type saved before the list, but not change to another unlisted one", () => {
    expect(unitTypeProblem("Studio", "Studio")).toBeNull();
    expect(unitTypeProblem("Penthouse", "Studio")).toMatch(/must be one of/);
  });
});

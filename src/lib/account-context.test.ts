import { describe, expect, it } from "vitest";
import { chooseUnit, type ContextUnit } from "./account-context";

const unit = (unitNumber: string, inForce: boolean): ContextUnit => ({ unitId: `u-${unitNumber}`, unitNumber, inForce, agreement: null, rent: null, deposit: null, managementFee: null, charges: [], agreements: [] });

describe("chooseUnit", () => {
  it("fills in the unit only when exactly one has an agreement in force", () => {
    expect(chooseUnit({ units: [unit("A", true), unit("B", false)] })).toEqual({ kind: "one", unit: unit("A", true) });
  });
  it("asks when several units have agreements in force, offering only those", () => {
    expect(chooseUnit({ units: [unit("A", true), unit("B", true), unit("C", false)] })).toEqual({ kind: "many", units: [unit("A", true), unit("B", true)] });
  });
  it("never fills in a unit whose agreements are not in force; offers them to choose", () => {
    expect(chooseUnit({ units: [unit("A", false)] })).toEqual({ kind: "notInForce", units: [unit("A", false)] });
  });
  it("reports an account without agreements", () => {
    expect(chooseUnit({ units: [] })).toEqual({ kind: "none" });
  });
});

import { describe, expect, it } from "vitest";
import { capacityProblem, registrationProgress } from "./capacity";

describe("registration progress", () => {
  it("reports 'not configured' instead of zeros when there is no capacity", () => {
    expect(registrationProgress(null, 3)).toEqual({ configured: false, registered: 3 });
  });

  it("calculates remaining units and progress", () => {
    expect(registrationProgress(48, 12)).toEqual({ configured: true, capacity: 48, registered: 12, remaining: 36, overBy: 0, percent: 25 });
    expect(registrationProgress(48, 0)).toMatchObject({ remaining: 48, percent: 0 });
    expect(registrationProgress(3, 1)).toMatchObject({ percent: 33 }); // rounded down: never shows 100% early
    expect(registrationProgress(3, 2)).toMatchObject({ percent: 66 });
  });

  it("shows completion exactly at capacity", () => {
    expect(registrationProgress(10, 10)).toMatchObject({ remaining: 0, overBy: 0, percent: 100 });
  });

  it("never reports a negative remaining count when over capacity", () => {
    expect(registrationProgress(10, 13)).toMatchObject({ remaining: 0, overBy: 3, percent: 130 });
  });
});

describe("capacity validation", () => {
  it("accepts blank (not configured) and positive whole numbers", () => {
    expect(capacityProblem(null)).toBeNull();
    expect(capacityProblem(1)).toBeNull();
    expect(capacityProblem(250)).toBeNull();
  });

  it("rejects zero, negative, fractional and absurd values", () => {
    for (const bad of [0, -5, 1.5, Number.NaN, 10001]) expect(capacityProblem(bad)).toMatch(/whole number from 1/);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { clientAddress, MAX_FAILURES, recordSignInFailure, resetSignInLimits, signInBlocked, WINDOW_MS } from "./rate-limit";

beforeEach(() => resetSignInLimits());

describe("failed sign-ins per address", () => {
  it("blocks an address after the limit within the window, and only that address", () => {
    const t = 1_000_000;
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordSignInFailure("1.2.3.4", t + i);
    expect(signInBlocked("1.2.3.4", t + 100)).toBe(false);
    recordSignInFailure("1.2.3.4", t + 100);
    expect(signInBlocked("1.2.3.4", t + 101)).toBe(true);
    expect(signInBlocked("5.6.7.8", t + 101)).toBe(false);
  });

  it("lets the address in again once the window has passed", () => {
    const t = 5_000_000;
    for (let i = 0; i < MAX_FAILURES; i++) recordSignInFailure("9.9.9.9", t);
    expect(signInBlocked("9.9.9.9", t + WINDOW_MS - 1)).toBe(true);
    expect(signInBlocked("9.9.9.9", t + WINDOW_MS + 1)).toBe(false);
  });

  it("takes the address the hosting proxy appended, not one the client wrote", () => {
    const h = (v: Record<string, string>) => ({ get: (n: string) => v[n] ?? null });
    expect(clientAddress(h({ "x-forwarded-for": "6.6.6.6, 41.90.1.2" }))).toBe("41.90.1.2");
    expect(clientAddress(h({ "x-forwarded-for": "41.90.1.2" }))).toBe("41.90.1.2");
    expect(clientAddress(h({ "x-real-ip": "10.0.0.5" }))).toBe("10.0.0.5");
    expect(clientAddress(h({}))).toBe("unknown");
  });
});

// Sign-in lockout (audit 2026-10-29): wrong passwords sent at the same moment are each counted, so the
// lockout after five failures cannot be outrun with a burst of simultaneous attempts.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { assertTestDatabase, resetTestData } from "@/server/testing";
import { hashPassword } from "@/server/auth/password";
import { login } from "@/server/auth/session";

assertTestDatabase();

const EMAIL = "lockout@test.local";
const PASSWORD = "Correct-Horse-2026!";

beforeEach(async () => {
  await resetTestData();
  await db.user.create({ data: { email: EMAIL, name: "Lockout", role: "FINANCE", passwordHash: await hashPassword(PASSWORD) } });
});

describe("sign-in lockout", () => {
  it("counts every wrong password, one after another, and locks at the fifth", async () => {
    for (let i = 1; i <= 4; i++) {
      expect(await login(EMAIL, "wrong-password-123")).toEqual({ ok: false, error: "Incorrect e-mail or password." });
      expect((await db.user.findUniqueOrThrow({ where: { email: EMAIL } })).failedLoginCount).toBe(i);
    }
    expect(await login(EMAIL, "wrong-password-123")).toMatchObject({ ok: false, error: expect.stringContaining("locked for 15 minutes") });
    const u = await db.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(u.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    // Even the right password is refused while locked.
    expect(await login(EMAIL, PASSWORD)).toMatchObject({ ok: false, error: expect.stringContaining("temporarily locked") });
  });

  it("locks the account when eight wrong passwords arrive at the same moment", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => login(EMAIL, "wrong-password-123")));
    expect(results.every((r) => !r.ok)).toBe(true);
    const u = await db.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(u.lockedUntil).not.toBeNull();
    expect(u.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(await login(EMAIL, PASSWORD)).toMatchObject({ ok: false, error: expect.stringContaining("temporarily locked") });
    expect(await db.auditEvent.count({ where: { entityId: u.id, action: "auth.account_locked" } })).toBeGreaterThanOrEqual(1);
  });
});

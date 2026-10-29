import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import type { Actor } from "@/server/auth/actor";
import { can, type Permission } from "@/server/auth/permissions";
import { hashPassword, verifyPassword } from "@/server/auth/password";

// Server-side sessions: the browser holds a random token; the database stores only its
// SHA-256 hash, so a database leak does not reveal usable session tokens.
// Provisional settings (session policy is unresolved): 12-hour maximum, 60-minute idle
// timeout, account locked for 15 minutes after 5 consecutive failed sign-ins.

export const SESSION_COOKIE = "bakaal_session";
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const IDLE_MS = 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;

/** Sessions that can no longer be used (past their maximum age, or idle too long) are deleted at each sign-in. */
export async function purgeEndedSessions(now = Date.now()) {
  const { count } = await db.session.deleteMany({ where: { OR: [{ expiresAt: { lte: new Date(now) } }, { lastSeenAt: { lte: new Date(now - IDLE_MS) } }] } });
  return count;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string) {
  await purgeEndedSessions();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + MAX_AGE_MS);
  await db.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt } });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/** The signed-in staff member for this request, or null. Cached per request. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session || session.revokedAt || !session.user.isActive) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now || session.lastSeenAt.getTime() + IDLE_MS <= now) {
    await db.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return null;
  }
  if (session.lastSeenAt.getTime() + TOUCH_INTERVAL_MS <= now) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  const { id, email, name, role } = session.user;
  return { id, email, name, role };
});

/** For pages: the signed-in actor, or a redirect to the sign-in page. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return actor;
}

/** For pages: the actor, redirected to /no-access when the permission is missing. */
export async function requirePage(permission: Permission): Promise<Actor> {
  const actor = await requireActor();
  if (!can(actor.role, permission)) redirect("/no-access");
  return actor;
}

// A fixed hash so unknown e-mail addresses take as long to reject as wrong passwords.
let dummyHash: Promise<string> | null = null;

export type LoginResult = { ok: true } | { ok: false; error: string };

export async function login(emailInput: string, password: string): Promise<LoginResult> {
  const email = emailInput.trim().toLowerCase();
  const generic = "Incorrect e-mail or password.";
  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    dummyHash ??= hashPassword("not-a-real-password");
    await verifyPassword(password, await dummyHash);
    await audit(db, null, { action: "auth.login_failed", entityType: "User", summary: `Failed sign-in for unknown e-mail ${email}` });
    return { ok: false, error: generic };
  }
  const actor: Actor = { id: user.id, email: user.email, name: user.name, role: user.role };
  if (!user.isActive) {
    await audit(db, actor, { action: "auth.login_failed", entityType: "User", entityId: user.id, summary: "Sign-in attempt on a deactivated account" });
    return { ok: false, error: generic };
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await audit(db, actor, { action: "auth.login_blocked", entityType: "User", entityId: user.id, summary: "Sign-in attempt while account is locked" });
    return { ok: false, error: "This account is temporarily locked after repeated failed sign-ins. Try again later." };
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    // Counted in the database (atomic increment), so wrong passwords sent at the same moment are each
    // counted and cannot slip past the lockout by all reading the same old count.
    const { failedLoginCount: failed } = await db.user.update({ where: { id: user.id }, data: { failedLoginCount: { increment: 1 } }, select: { failedLoginCount: true } });
    const lock = failed >= MAX_FAILED_LOGINS;
    if (lock) await db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MS) } });
    await audit(db, actor, {
      action: lock ? "auth.account_locked" : "auth.login_failed",
      entityType: "User",
      entityId: user.id,
      summary: lock ? "Account locked after repeated failed sign-ins" : "Failed sign-in (wrong password)",
    });
    return { ok: false, error: lock ? "Too many failed attempts. The account is locked for 15 minutes." : generic };
  }
  await db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await createSession(user.id);
  await audit(db, actor, { action: "auth.login", entityType: "User", entityId: user.id, summary: "Signed in" });
  return { ok: true };
}

export async function logout() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    if (session && !session.revokedAt) {
      await db.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      const u = session.user;
      await audit(db, { id: u.id, email: u.email, name: u.name, role: u.role }, { action: "auth.logout", entityType: "User", entityId: u.id, summary: "Signed out" });
    }
  }
  store.delete(SESSION_COOKIE);
}

/** Ends every session of a user (after a password change, reset or deactivation). */
export async function revokeAllSessions(userId: string, exceptCurrent = false) {
  let keep: string | undefined;
  if (exceptCurrent) {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    keep = token ? hashToken(token) : undefined;
  }
  await db.session.updateMany({
    where: { userId, revokedAt: null, ...(keep ? { tokenHash: { not: keep } } : {}) },
    data: { revokedAt: new Date() },
  });
}

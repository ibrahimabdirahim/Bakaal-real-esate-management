// Staff user accounts, building settings, audit log.

import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { BusinessError, requirePermission, type Actor } from "@/server/auth/actor";
import { can, type RoleName } from "@/server/auth/permissions";
import { generateTemporaryPassword, hashPassword, passwordProblem, verifyPassword } from "@/server/auth/password";
import { revokeAllSessions } from "@/server/auth/session";
import { findBuilding, linkableRecords } from "@/server/services/common";
import { capacityProblem } from "@/lib/capacity";

export async function listUsers(actor: Actor) {
  requirePermission(actor, "users.manage");
  return db.user.findMany({
    select: { id: true, email: true, name: true, role: true, isActive: true, lastLoginAt: true, lockedUntil: true, createdAt: true },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
}

/** Creates a staff account with a one-time temporary password, returned once to the admin. */
export async function createUser(actor: Actor, input: { email: string; name: string; role: RoleName }) {
  requirePermission(actor, "users.manage");
  const email = input.email.trim().toLowerCase();
  if (await db.user.findUnique({ where: { email } })) throw new BusinessError("A staff account with this e-mail already exists.");
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const user = await db.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { email, name: input.name, role: input.role, passwordHash } });
    await audit(tx, actor, { action: "user.create", entityType: "User", entityId: u.id, summary: `Created staff account ${email} (${input.role})`, after: { email, name: input.name, role: input.role } });
    return u;
  });
  return { user, temporaryPassword };
}

export async function updateUser(actor: Actor, id: string, input: { name: string; role: RoleName; isActive: boolean }) {
  requirePermission(actor, "users.manage");
  if (id === actor.id && (!input.isActive || input.role !== "ADMIN")) {
    throw new BusinessError("You cannot deactivate your own account or remove your own administrator role.");
  }
  const result = await db.$transaction(async (tx) => {
    const before = await tx.user.findUniqueOrThrow({ where: { id }, select: { name: true, role: true, isActive: true, email: true } });
    if (before.role === "ADMIN" && (input.role !== "ADMIN" || !input.isActive)) {
      const otherAdmins = await tx.user.count({ where: { role: "ADMIN", isActive: true, id: { not: id } } });
      if (otherAdmins === 0) throw new BusinessError("At least one active administrator must remain.");
    }
    const after = await tx.user.update({ where: { id }, data: input, select: { name: true, role: true, isActive: true } });
    await audit(tx, actor, { action: "user.update", entityType: "User", entityId: id, summary: `Updated staff account ${before.email}`, before, after });
    return { before, after };
  });
  if (!input.isActive || result.before.role !== input.role) await revokeAllSessions(id);
  return result.after;
}

export async function resetUserPassword(actor: Actor, id: string) {
  requirePermission(actor, "users.manage");
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await db.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null } });
    await audit(tx, actor, { action: "user.password_reset", entityType: "User", entityId: id, summary: `Reset the password of ${u.email}` });
  });
  await revokeAllSessions(id);
  return temporaryPassword;
}

export async function changeOwnPassword(actor: Actor, current: string, next: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await verifyPassword(current, user.passwordHash))) throw new BusinessError("The current password is incorrect.");
  const problem = passwordProblem(next);
  if (problem) throw new BusinessError(problem);
  const passwordHash = await hashPassword(next);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: actor.id }, data: { passwordHash } });
    await audit(tx, actor, { action: "user.password_change", entityType: "User", entityId: actor.id, summary: "Changed own password" });
  });
  await revokeAllSessions(actor.id, true);
}

// ---------------------------------------------------------------- building

export async function getBuildingSettings(actor: Actor) {
  requirePermission(actor, "settings.view");
  return findBuilding();
}

/** `totalUnits` is the building's physical capacity; null clears it, undefined leaves it unchanged. */
export async function saveBuilding(actor: Actor, input: { name: string; address: string | null; totalUnits?: number | null }) {
  requirePermission(actor, "settings.manage");
  const problem = input.totalUnits === undefined ? null : capacityProblem(input.totalUnits);
  if (problem) throw new BusinessError(problem);
  const existing = await findBuilding();
  return db.$transaction(async (tx) => {
    if (existing) {
      const after = await tx.building.update({ where: { id: existing.id }, data: input });
      await audit(tx, actor, { action: "building.update", entityType: "Building", entityId: existing.id, summary: "Updated building profile", before: existing, after });
      return after;
    }
    const b = await tx.building.create({ data: input });
    await audit(tx, actor, { action: "building.create", entityType: "Building", entityId: b.id, summary: `Created building ${b.name}`, after: b });
    return b;
  });
}

// ---------------------------------------------------------------- audit log

type AuditRow = Awaited<ReturnType<typeof db.auditEvent.findMany>>[number];

/**
 * Salary payments are restricted to roles with salary access, also in the audit log: for other
 * readers (e.g. the auditor) a salary event keeps its time, actor and action, but not the staff
 * member, amounts, reason or before/after values. The stored events are never changed.
 */
async function redactSalaryEvents(actor: Actor, events: AuditRow[]): Promise<AuditRow[]> {
  if (can(actor.role, "salary.view")) return events;
  const ids = [...new Set(events.filter((e) => e.entityType === "Expense" && e.entityId).map((e) => e.entityId!))];
  const salaries = new Set((await db.expense.findMany({ where: { id: { in: ids }, category: "SALARIES" }, select: { id: true } })).map((x) => x.id));
  return events.map((e) =>
    e.entityType === "Expense" && ((e.entityId && salaries.has(e.entityId)) || e.action.startsWith("salary.") || /salar/i.test(e.summary))
      ? { ...e, summary: "Salary payment record — details restricted to staff with salary access", before: null, after: null, reason: null }
      : e,
  );
}

export async function listAuditEvents(actor: Actor, filter: { entityType?: string; entityId?: string; q?: string; page?: number }) {
  requirePermission(actor, "audit.view");
  const take = 50;
  const page = Math.max(1, filter.page ?? 1);
  const where = {
    ...(filter.entityType ? { entityType: filter.entityType } : {}),
    ...(filter.entityId ? { entityId: filter.entityId } : {}),
    ...(filter.q
      ? { OR: [{ summary: { contains: filter.q, mode: "insensitive" as const } }, { actorEmail: { contains: filter.q, mode: "insensitive" as const } }, { action: { contains: filter.q } }] }
      : {}),
  };
  const [events, total] = await Promise.all([
    db.auditEvent.findMany({ where, orderBy: { id: "desc" }, take, skip: (page - 1) * take }),
    db.auditEvent.count({ where }),
  ]);
  const linkable = await linkableRecords(actor, events);
  let shown = await redactSalaryEvents(actor, events);
  // A search must not reveal which salary events matched a name or amount the reader cannot see.
  if (filter.q) shown = shown.filter((e, i) => e.summary === events[i].summary);
  return { events: shown, linkable, total, page, pages: Math.max(1, Math.ceil(total / take)) };
}

/** Audit history of an account and the records linked to it (agreements, invoices, payments). */
export async function accountActivity(actor: Actor, partyId: string, take = 50) {
  requirePermission(actor, "audit.view");
  const [agreements, invoices, payments] = await Promise.all([
    db.agreement.findMany({ where: { partyId }, select: { id: true } }),
    db.invoice.findMany({ where: { partyId }, select: { id: true } }),
    db.payment.findMany({ where: { partyId }, select: { id: true } }),
  ]);
  const ids = [partyId, ...agreements.map((x) => x.id), ...invoices.map((x) => x.id), ...payments.map((x) => x.id)];
  const events = await db.auditEvent.findMany({ where: { entityId: { in: ids } }, orderBy: { id: "desc" }, take });
  return { events, linkable: await linkableRecords(actor, events) };
}

export async function auditTrailFor(actor: Actor, entityType: string, entityId: string) {
  requirePermission(actor, "audit.view");
  return redactSalaryEvents(actor, await db.auditEvent.findMany({ where: { entityType, entityId }, orderBy: { id: "asc" } }));
}

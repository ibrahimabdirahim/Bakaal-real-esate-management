// Administrator self-approval exception (DECISIONS.md F30, widened by F33 on 2026-10-22).
//
// Separation of duties stays the rule for payments still pending and manual invoices still in draft:
// whoever recorded or drafted it is normally not the person who verifies or issues it. (Expenses and
// salary payments no longer use the exception: an approver who may also record approves own ones in
// one step, audited as own — DECISIONS.md F61.) A System
// Administrator may complete their own item, but never automatically: it needs a ticked
// confirmation and a written reason, and it writes a distinct audit event that names the
// exception and how many other active staff could have done it independently.

import type { DbOrTx } from "@/server/db";
import { BusinessError, type Actor } from "@/server/auth/actor";
import { can, ROLES, type Permission } from "@/server/auth/permissions";

export const SELF_EXCEPTION_MIN_REASON = 10;
export const SELF_EXCEPTION = "ADMINISTRATOR_SELF_APPROVAL";

export interface SelfException {
  reason: string;
  confirmed: boolean;
}

export function canUseSelfException(actor: Actor) {
  return can(actor.role, "approvals.self_exception");
}

/** Validates a request to use the exception and returns the trimmed reason. */
export function checkSelfException(actor: Actor, input: SelfException): string {
  if (!canUseSelfException(actor)) throw new BusinessError("Only a System Administrator can use the self-approval exception; ask another authorised person.");
  if (!input.confirmed) throw new BusinessError("Confirm that you have checked this yourself before using the exception.");
  const reason = input.reason.trim();
  if (reason.length < SELF_EXCEPTION_MIN_REASON) throw new BusinessError(`Explain why the exception is used and what you checked (at least ${SELF_EXCEPTION_MIN_REASON} characters).`);
  return reason;
}

/** Active staff, other than the actor, whose role holds the permission (recorded with every exception). */
export async function otherHolders(tx: DbOrTx, actorId: string, permission: Permission) {
  const roles = ROLES.filter((r) => can(r, permission));
  return tx.user.count({ where: { isActive: true, id: { not: actorId }, role: { in: [...roles] } } });
}

/** The sentence added to a "someone else must do it" refusal, pointing an administrator to the exception. */
export function selfExceptionHint(actor: Actor) {
  return canUseSelfException(actor) ? " As a System Administrator you can complete it yourself with the audited self-approval exception." : "";
}

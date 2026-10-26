// Server-side builders for RowActions items (plain module, usable from server components).
import type { RowAction } from "@/components/row-actions";
import type { ActionState } from "@/server/action";
import { deleteMessage } from "@/lib/delete-confirm";
import { APPROVALS, APPROVE_LABEL, type ApprovalKind } from "@/lib/approval";

/**
 * A Delete item for a record the server may delete (F57): one confirmation ("Delete record?" —
 * Cancel / Confirm Delete), then the deletion runs from the menu; if the server refuses
 * (permissions, history, state), its reason is shown there. Nothing to type.
 */
export function deleteAction(label: string, action: (state: ActionState, form: FormData) => Promise<ActionState>, what = "record"): RowAction {
  return { label, action, kind: "delete", tone: "danger", confirm: deleteMessage(what) };
}

/**
 * An Approve item (F61): one confirmation ("Approve expense?" — Cancel / Confirm Approval), then the
 * approval runs from the menu and the list reloads with the success message (`returnTo`: the list
 * with its filters). If the server refuses (permission, status), its reason is shown in the menu.
 */
export function approveAction(label: string, action: (state: ActionState, form: FormData) => Promise<ActionState>, kind: ApprovalKind, returnTo: string): RowAction {
  const a = APPROVALS[kind];
  return { label, action, confirm: a.message, confirmTitle: a.title, confirmLabel: APPROVE_LABEL, fields: { returnTo } };
}

// The Actions menus of invoices and payments (F49, F54), shared by Billing & Payments and the account
// page so the same record offers the same actions everywhere. Business rules stay in the services;
// these only choose which existing workflows to offer, and the server checks them again.
import type { Actor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import type { RowAction } from "@/components/row-actions";
import { deleteAction } from "@/components/row-action-items";
import { discardDraftAction } from "../invoices/actions";

const NO_EDIT = "Payments are not edited. Reject a wrong pending payment and record it again; reverse a verified one.";
const NO_DELETE = "Payments are never deleted: they are kept for the record. Reject a wrong pending payment or reverse a verified one.";

/**
 * What can be done with an invoice from the list (F49). Issued invoices are kept as issued (database
 * rule): they are corrected with a credit note, never edited or deleted. Only a draft can be deleted.
 */
export function invoiceActions(actor: Actor, i: { id: string; number: string | null; status: string; balance: number; party: { id: string } }): RowAction[] {
  const issued = i.status === "ISSUED";
  const items: RowAction[] = [{ label: "View invoice", href: `/invoices/${i.id}` }];
  if (issued) items.push({ label: "Print or save as PDF", href: `/invoices/${i.id}?print=1` });
  if (issued && i.balance > 0 && can(actor.role, "payments.record")) items.push({ label: "Record payment", href: `/payments/new?partyId=${i.party.id}&invoiceId=${i.id}` });
  if (issued && can(actor.role, "payments.view")) items.push({ label: "View payment allocations", href: `/invoices/${i.id}#payments` });
  if (!issued && can(actor.role, "invoices.issue_manual")) items.push({ label: "Review and issue", href: `/invoices/${i.id}#issue` });
  if (issued) {
    items.push(
      can(actor.role, "credits.create") && i.balance > 0
        ? { label: "Correct with a credit note", href: `/invoices/${i.id}#credit` }
        : { label: "Edit invoice", unavailable: "Issued invoices are not edited; an amount still owed can be reduced with a credit note." },
    );
    items.push({ label: "Delete invoice", unavailable: "Issued invoices are kept for the record. A credit note cancels what is still owed." });
  } else {
    items.push({ label: "Edit invoice", unavailable: "Drafts are not edited: delete the draft and create it again." });
    if (can(actor.role, "invoices.create_manual")) items.push(deleteAction("Delete draft", discardDraftAction.bind(null, i.id), "draft invoice"));
  }
  if (can(actor.role, "audit.view")) items.push({ label: "View audit history", href: `/audit?entityType=Invoice&entityId=${i.id}` });
  return items;
}

/**
 * What can be done with a payment from the list (F49). Payments are never edited or deleted
 * (database rules): a pending one is rejected, a verified one is reversed; allocation is its own step.
 */
export function paymentActions(
  actor: Actor,
  p: { id: string; status: string; unallocated: number; recordedById: string; invoices: { id: string; number: string | null }[] },
): RowAction[] {
  const items: RowAction[] = [{ label: "View payment", href: `/payments/${p.id}` }];
  for (const inv of p.invoices.slice(0, 3)) items.push({ label: `View invoice ${inv.number}`, href: `/invoices/${inv.id}` });
  if (p.status === "PENDING" && can(actor.role, "payments.verify")) {
    items.push({ label: p.recordedById === actor.id ? "Review (recorded by you)" : "Verify", href: `/payments/${p.id}#verify` });
    items.push({ label: "Reject", href: `/payments/${p.id}#reject`, tone: "danger" });
  }
  if (p.status === "VERIFIED" && p.unallocated > 0 && can(actor.role, "payments.allocate")) items.push({ label: "Allocate to invoices", href: `/payments/${p.id}#allocate` });
  if (p.status === "VERIFIED" && can(actor.role, "payments.reverse")) items.push({ label: "Reverse payment", href: `/payments/${p.id}#reverse`, tone: "danger" });
  items.push({ label: "Edit payment", unavailable: NO_EDIT });
  items.push({ label: "Delete payment", unavailable: NO_DELETE });
  return items;
}

"use server";

import { z } from "zod";
import { finish, parseForm, runAction, type ActionState } from "@/server/action";
import { createCreditNote, createManualInvoice, discardDraftInvoice, issueManualInvoice } from "@/server/services/finance";
import { BusinessError } from "@/server/auth/actor";
import { isoDate, money, optionalText, requiredText } from "@/server/validation";
import { tryCents } from "@/lib/money";

const CATEGORIES = ["RENT", "MANAGEMENT_FEE", "SERVICE_CHARGE", "SHARED_CHARGE", "OTHER"] as const;

export async function createManualInvoiceAction(_: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  const state = await runAction(async (actor) => {
    const head = parseForm(
      z.object({ partyId: requiredText("Account"), unitId: requiredText("Unit"), agreementId: optionalText(40), dueDate: isoDate("Due date"), notes: optionalText() }),
      form,
    );
    const categories = form.getAll("lineCategory").map(String);
    const descriptions = form.getAll("lineDescription").map((v) => String(v).trim());
    const amounts = form.getAll("lineAmount").map((v) => String(v).trim());
    const lines = [];
    for (let i = 0; i < descriptions.length; i++) {
      if (!descriptions[i] && !amounts[i]) continue;
      const amount = tryCents(amounts[i]);
      if (!descriptions[i] || amount == null || amount <= 0) throw new BusinessError(`Line ${i + 1}: enter a description and a positive amount.`);
      const category = CATEGORIES.find((c) => c === categories[i]);
      if (!category) throw new BusinessError(`Line ${i + 1}: choose a category.`);
      lines.push({ category, description: descriptions[i], amount });
    }
    // "issue" = create and issue in one step (single-operator, F49); the service checks the issuing permission.
    id = (await createManualInvoice(actor, { ...head, lines }, { issue: form.get("issue") === "1" })).id;
  });
  if (state?.error) return state;
  finish(`/invoices/${id}`);
}

export async function issueManualInvoiceAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    const self = form.get("selfException") === "yes" ? { reason: String(form.get("reason") ?? ""), confirmed: form.get("confirmSelf") === "yes" } : undefined;
    await issueManualInvoice(actor, id, self);
    return "Invoice reviewed and issued.";
  });
}

export async function discardDraftAction(id: string, _: ActionState): Promise<ActionState> {
  const state = await runAction(async (actor) => {
    await discardDraftInvoice(actor, id);
  });
  if (state?.error) return state;
  finish("/invoices?discarded=1");
}

export async function creditNoteAction(invoiceId: string, _: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    const { amount, reason } = parseForm(z.object({ amount: money("Amount"), reason: requiredText("Reason", 500) }), form);
    const cn = await createCreditNote(actor, invoiceId, amount, reason);
    return `Credit note ${cn.number} recorded.`;
  });
}

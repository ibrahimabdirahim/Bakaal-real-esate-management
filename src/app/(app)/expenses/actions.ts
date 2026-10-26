"use server";

import { z } from "zod";
import { finish, parseForm, runAction, type ActionState } from "@/server/action";
import { approvedReturn } from "@/lib/approval";
import { createExpense, decideExpense, deleteDraftExpense, EXPENSE_CATEGORIES, markExpensePaid, updateDraftExpense } from "@/server/services/operations";
import { isoDate, money, optionalIsoDate, optionalText, requiredText } from "@/server/validation";

const expenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES, { message: "Choose a category." }),
  payee: requiredText("Payee", 150),
  description: requiredText("Description", 500),
  amount: money("Amount"),
  servicePeriodStart: optionalIsoDate("Service period start"),
  servicePeriodEnd: optionalIsoDate("Service period end"),
  costCentre: optionalText(60),
  evidenceNote: optionalText(1000),
  workOrderId: optionalText(40),
  staffMemberId: optionalText(40),
});

export async function createExpenseAction(_: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  const state = await runAction(async (actor) => {
    id = (await createExpense(actor, parseForm(expenseSchema, form), form.get("intent") === "submit", { documentIds: form.getAll("documentIds").map(String) })).id;
  });
  if (state?.error) return state;
  finish(`/expenses/${id}`);
}

export async function updateExpenseAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    const submit = form.get("intent") === "submit";
    await updateDraftExpense(actor, id, parseForm(expenseSchema, form), submit);
    return submit ? "Expense submitted for approval." : "Draft saved.";
  });
}

/** Approves a submitted expense after the one confirmation (F61), then returns to the page it came from. */
export async function approveExpenseAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  const state = await runAction(async (actor) => {
    await decideExpense(actor, id, "APPROVED", null);
  });
  if (state?.error) return state;
  finish(approvedReturn(form.get("returnTo"), "/expenses"));
}

/** Rejects a submitted expense; a reason is required (it is kept as the decision reason). */
export async function rejectExpenseAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    await decideExpense(actor, id, "REJECTED", String(form.get("reason") ?? "").trim() || null);
    return "Expense rejected.";
  });
}

export async function payExpenseAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    const { method, reference, paidDate } = parseForm(
      z.object({ method: z.enum(["MPESA", "BANK", "CASH"], { message: "Choose a method." }), reference: requiredText("Reference", 80), paidDate: isoDate("Payment date") }),
      form,
    );
    await markExpensePaid(actor, id, method, reference, { paidDate, documentIds: form.getAll("documentIds").map(String) });
    return "Expense marked as paid.";
  });
}

export async function deleteDraftExpenseAction(id: string, _: ActionState): Promise<ActionState> {
  const state = await runAction(async (actor) => {
    await deleteDraftExpense(actor, id);
  });
  if (state?.error) return state;
  finish("/expenses?deleted=1");
}

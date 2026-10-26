"use server";

import { z } from "zod";
import { finish, parseForm, runAction, type ActionState } from "@/server/action";
import { approvedReturn } from "@/lib/approval";
import { decideExpense, markExpensePaid } from "@/server/services/operations";
import { deleteSalaryDraft, recordSalaryPayment, updateSalaryPayment, type SalaryInput } from "@/server/services/salaries";
import { isoDate, optionalText, requiredText } from "@/server/validation";
import { tryCents } from "@/lib/money";

const FIELDS = ["staffMemberId", "month", "gross", "allowances", "deductions", "notes", "evidenceNote"] as const;

/** An amount field: empty means zero for allowances and deductions; the gross salary is required. */
const amount = (label: string, required: boolean) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) {
        if (required) ctx.addIssue({ code: "custom", message: `${label} is required.` });
        return 0;
      }
      const c = tryCents(v);
      if (c == null || c < 0) {
        ctx.addIssue({ code: "custom", message: `${label} must be zero or a positive amount with at most 2 decimals.` });
        return 0;
      }
      return c;
    });

const salarySchema = z.object({
  staffMemberId: requiredText("Staff member"),
  // <input type="month"> sends YYYY-MM.
  month: z
    .string()
    .trim()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose the salary month.")
    .transform((v) => `${v}-01`),
  gross: amount("Gross salary", true),
  allowances: amount("Allowances", false),
  deductions: amount("Deductions", false),
  notes: optionalText(300),
  evidenceNote: optionalText(500),
});

function values(form: FormData) {
  return Object.fromEntries(FIELDS.map((k) => [k, String(form.get(k) ?? "")]));
}

function parse(form: FormData): SalaryInput {
  return parseForm(salarySchema, form);
}

export async function recordSalaryAction(_: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  const state = await runAction(async (actor) => {
    const submit = form.get("intent") === "submit";
    id = (await recordSalaryPayment(actor, parse(form), submit, { documentIds: form.getAll("documentIds").map(String) })).id;
  });
  if (state?.error) return { ...state, values: values(form) };
  // Back to Staff Payments, which shows its status and confirms it.
  finish(`/staff/salary-payments?recorded=${id}`);
}

export async function updateSalaryAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  const state = await runAction(async (actor) => {
    const submit = form.get("intent") === "submit";
    await updateSalaryPayment(actor, id, parse(form), submit);
    return submit ? "Salary payment submitted for approval." : "Draft saved.";
  });
  return state?.error ? { ...state, values: values(form) } : state;
}

/** Approves a pending salary payment after the one confirmation (F61); it is not paid until the payment is recorded. */
export async function approveSalaryAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  const state = await runAction(async (actor) => {
    await decideExpense(actor, id, "APPROVED", null);
  });
  if (state?.error) return state;
  finish(approvedReturn(form.get("returnTo"), "/staff/salary-payments"));
}

/** Rejects a pending salary payment; a reason is required. */
export async function rejectSalaryAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    await decideExpense(actor, id, "REJECTED", String(form.get("reason") ?? "").trim() || null);
    return "Salary payment rejected. The month is free to record again.";
  });
}

/** Deletes a draft salary payment (drafts only; enforced by the service and the database). */
export async function deleteSalaryDraftAction(id: string, _: ActionState): Promise<ActionState> {
  return runAction(async (actor) => {
    await deleteSalaryDraft(actor, id);
    return "Draft deleted.";
  });
}

const paySchema = z.object({
  paidDate: isoDate("Payment date"),
  method: z.enum(["MPESA", "BANK", "CASH"], { message: "Choose how it was paid." }),
  reference: optionalText(80).transform((v) => v ?? ""),
});

/**
 * Records the actual payment of an approved salary: date, method, reference and proof. On success the
 * page reloads (the payment form is gone once paid) with the success message; a refusal stays on the form.
 */
export async function paySalaryAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  const state = await runAction(async (actor) => {
    const { paidDate, method, reference } = parseForm(paySchema, form);
    await markExpensePaid(actor, id, method, reference, { paidDate, documentIds: form.getAll("documentIds").map(String) });
  });
  if (state?.error) return state;
  finish(`/staff/salary-payments/${id}?paid=1`);
}


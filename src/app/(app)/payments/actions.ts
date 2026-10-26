"use server";

import { z } from "zod";
import { finish, parseForm, runAction, type ActionState } from "@/server/action";
import { allocatePayment, recordPayment, rejectPayment, reversePayment, verifyPayment, verifyPaymentSelf } from "@/server/services/finance";
import { BusinessError } from "@/server/auth/actor";
import { isoDate, money, optionalText, requiredText } from "@/server/validation";
import { tryCents } from "@/lib/money";

const paymentSchema = z.object({
  partyId: requiredText("Account"),
  method: z.enum(["MPESA", "BANK", "CASH"], { message: "Choose a payment method." }),
  reference: requiredText("Reference", 60),
  amount: money("Amount"),
  receivedDate: isoDate("Received date"),
  evidenceNote: optionalText(1000),
});

export async function recordPaymentAction(_: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  const state = await runAction(async (actor) => {
    const input = parseForm(paymentSchema, form);
    // Single-operator (F49): "verify" records it verified, with any allocations entered; the service checks permissions and limits.
    const ids = form.getAll("allocInvoiceId").map(String);
    const amounts = form.getAll("allocAmount").map((v) => String(v).trim());
    const allocations = ids.flatMap((invoiceId, i) => {
      if (!amounts[i]) return [];
      const amount = tryCents(amounts[i]);
      if (amount == null || amount < 0) throw new BusinessError("Enter each amount to allocate as a positive number, or leave it blank.");
      return [{ invoiceId, amount }];
    });
    id = (await recordPayment(actor, input, { documentIds: form.getAll("documentIds").map(String), verify: form.get("verify") === "1", allocations })).id;
  });
  if (state?.error) return state;
  // Back to the Payments list, where the new payment is shown with its status (pending verification).
  finish(`/payments?recorded=${id}`);
}

export async function verifyPaymentAction(id: string, _: ActionState): Promise<ActionState> {
  return runAction(async (actor) => {
    const p = await verifyPayment(actor, id);
    return `Payment verified. Receipt ${p.receiptNumber} issued. Now allocate it to invoices.`;
  });
}

export async function verifyPaymentSelfAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    const p = await verifyPaymentSelf(actor, id, { reason: String(form.get("reason") ?? ""), confirmed: form.get("confirmSelf") === "yes" });
    return `Payment verified under the administrator self-verification exception. Receipt ${p.receiptNumber} issued. Now allocate it to invoices.`;
  });
}

export async function rejectPaymentAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    const { reason } = parseForm(z.object({ reason: requiredText("Reason", 500) }), form);
    await rejectPayment(actor, id, reason);
    return "Payment rejected. It does not affect any balance.";
  });
}

export async function reversePaymentAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    const { reason } = parseForm(z.object({ reason: requiredText("Reason", 500) }), form);
    await reversePayment(actor, id, reason);
    return "Payment reversed. Its allocations were reversed and the invoices are outstanding again.";
  });
}

export async function allocateAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    const invoiceIds = form.getAll("invoiceId").map(String);
    const amounts = form.getAll("allocate").map((v) => String(v).trim());
    const allocations = [];
    for (let i = 0; i < invoiceIds.length; i++) {
      if (!amounts[i]) continue;
      const amount = tryCents(amounts[i]);
      if (amount == null || amount < 0) throw new BusinessError(`"${amounts[i]}" is not a valid amount.`);
      if (amount > 0) allocations.push({ invoiceId: invoiceIds[i], amount });
    }
    await allocatePayment(actor, id, allocations);
    return "Allocation saved.";
  });
}

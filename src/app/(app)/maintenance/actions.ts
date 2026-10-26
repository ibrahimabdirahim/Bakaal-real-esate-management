"use server";

import { z } from "zod";
import { finish, parseForm, runAction, type ActionState } from "@/server/action";
import { approvedReturn } from "@/lib/approval";
import { createWorkOrder, decideQuote, updateWorkOrder } from "@/server/services/operations";
import { optionalMoney, optionalText, requiredText } from "@/server/validation";

const createSchema = z.object({
  title: requiredText("Issue", 200),
  description: optionalText(),
  unitId: optionalText(40),
  location: optionalText(200),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  reportedVia: optionalText(40),
});

export async function createWorkOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  const state = await runAction(async (actor) => {
    id = (await createWorkOrder(actor, parseForm(createSchema, form))).id;
  });
  if (state?.error) return state;
  finish(`/maintenance/${id}`);
}

const updateSchema = z.object({
  status: z.enum(["OPEN", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
  assignee: optionalText(150),
  quoteAmount: optionalMoney("Quote"),
  outcome: optionalText(),
  costTreatment: optionalText(200),
});

export async function updateWorkOrderAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    await updateWorkOrder(actor, id, parseForm(updateSchema, form));
    return "Work order updated.";
  });
}

/** Approves the work order's quote after the one confirmation (F61); the work order's status does not change. */
export async function approveQuoteAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  const state = await runAction(async (actor) => {
    await decideQuote(actor, id, true);
  });
  if (state?.error) return state;
  finish(approvedReturn(form.get("returnTo"), "/maintenance"));
}

export async function rejectQuoteAction(id: string, _: ActionState): Promise<ActionState> {
  return runAction(async (actor) => {
    await decideQuote(actor, id, false);
    return "Quote rejected.";
  });
}

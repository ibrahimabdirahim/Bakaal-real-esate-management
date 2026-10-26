"use server";

import { z } from "zod";
import { finish, parseForm, runAction, type ActionState } from "@/server/action";
import { addAgreementCharge, cancelAgreement, createAgreement, endAgreement, endAgreementCharge } from "@/server/services/property";
import { isoDate, money, optionalInt, optionalIsoDate, optionalMoney, optionalNonNegativeMoney, optionalText, requiredText } from "@/server/validation";

const agreementSchema = z.object({
  type: z.enum(["RENTAL", "OWNERSHIP", "MANAGEMENT"], { message: "Choose an agreement type." }),
  unitId: requiredText("Unit"),
  partyId: requiredText("Account"),
  reference: optionalText(80),
  startDate: isoDate("Start date"),
  endDate: optionalIsoDate("End date"),
  rentAmount: optionalMoney("Monthly rent"),
  managementFeeAmount: optionalMoney("Management fee"),
  depositAmount: optionalNonNegativeMoney("Deposit amount"),
  dueDay: optionalInt("Due day", 1, 28),
  graceDays: optionalInt("Grace period", 0, 60),
  purchaseDate: optionalIsoDate("Purchase date"),
  ownershipEvidence: optionalText(500),
  lateFeeTerms: optionalText(1000),
  allocationTerms: optionalText(1000),
  notes: optionalText(),
});

export async function createAgreementAction(_: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  const state = await runAction(async (actor) => {
    const input = parseForm(agreementSchema, form);
    // Fields that do not apply to the chosen type are ignored rather than stored.
    const clean = {
      ...input,
      rentAmount: input.type === "RENTAL" ? input.rentAmount : null,
      managementFeeAmount: input.type === "MANAGEMENT" ? input.managementFeeAmount : null,
      depositAmount: input.type === "RENTAL" ? input.depositAmount : null,
      purchaseDate: input.type === "OWNERSHIP" ? input.purchaseDate : null,
      ownershipEvidence: input.type === "OWNERSHIP" ? input.ownershipEvidence : null,
    };
    id = (await createAgreement(actor, clean)).id;
  });
  if (state?.error) return state;
  finish(`/agreements/${id}`);
}

const chargeSchema = z.object({
  category: z.enum(["SERVICE_CHARGE", "SHARED_CHARGE", "OTHER"], { message: "Choose a category." }),
  description: requiredText("Description", 120),
  amount: money("Amount"),
  effectiveFrom: isoDate("Effective from"),
  effectiveTo: optionalIsoDate("Effective to"),
});

export async function addChargeAction(agreementId: string, _: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    await addAgreementCharge(actor, agreementId, parseForm(chargeSchema, form));
    return "Recurring charge added. It will be billed for whole months it covers.";
  });
}

export async function endChargeAction(chargeId: string, _: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    const { effectiveTo } = parseForm(z.object({ effectiveTo: isoDate("End date") }), form);
    await endAgreementCharge(actor, chargeId, effectiveTo);
    return "Charge end date set.";
  });
}

export async function endAgreementAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    const { endDate, reason } = parseForm(z.object({ endDate: isoDate("End date"), reason: requiredText("Reason", 500) }), form);
    await endAgreement(actor, id, endDate, reason);
    return "Agreement ended. Recurring billing stops after the end date; existing invoices and debts are kept.";
  });
}

export async function cancelAgreementAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    const { reason } = parseForm(z.object({ reason: requiredText("Reason", 500) }), form);
    await cancelAgreement(actor, id, reason);
    return "Agreement cancelled.";
  });
}

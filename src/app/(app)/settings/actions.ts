"use server";

import { z } from "zod";
import { parseForm, runAction, type ActionState } from "@/server/action";
import { saveBuilding, createUser, updateUser, resetUserPassword, changeOwnPassword } from "@/server/services/admin";
import { approvePolicy, proposePolicy } from "@/server/services/billing";
import { isoDate, optionalInt, optionalText, requiredText } from "@/server/validation";
import { ROLES } from "@/server/auth/permissions";
import { MAX_BUILDING_UNITS } from "@/lib/capacity";

export async function saveBuildingAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    const schema = z.object({
      name: requiredText("Building name", 150),
      address: optionalText(300),
      totalUnits: optionalInt("Total units in the building", 1, MAX_BUILDING_UNITS),
    });
    await saveBuilding(actor, parseForm(schema, form));
    return "Building profile saved.";
  });
}

export async function proposePolicyAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    const input = parseForm(
      z.object({ key: z.literal("DEFAULT_DUE_DAY"), value: requiredText("Value", 10), effectiveFrom: isoDate("Effective from"), note: optionalText(500) }),
      form,
    );
    await proposePolicy(actor, input);
    return "Policy proposed. It has no effect until it is approved.";
  });
}

export async function approvePolicyAction(id: string, _: ActionState): Promise<ActionState> {
  return runAction(async (actor) => {
    await approvePolicy(actor, id);
    return "Policy approved. It now applies to agreements that do not state this term.";
  });
}

const roleEnum = z.enum(ROLES, { message: "Choose a role." });

export async function createUserAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    const input = parseForm(z.object({ email: requiredText("E-mail", 200).email("E-mail address is not valid."), name: requiredText("Name", 150), role: roleEnum }), form);
    const { temporaryPassword } = await createUser(actor, input);
    return { success: `Staff account ${input.email} created.`, reveal: { label: "Temporary password", value: temporaryPassword } };
  });
}

export async function updateUserAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    const input = parseForm(z.object({ name: requiredText("Name", 150), role: roleEnum }), form);
    await updateUser(actor, id, { ...input, isActive: form.get("isActive") === "on" });
    return "Staff account updated.";
  });
}

export async function resetPasswordAction(id: string, _: ActionState): Promise<ActionState> {
  return runAction(async (actor) => {
    const temporaryPassword = await resetUserPassword(actor, id);
    return { success: "Password reset. All of this user's sessions were signed out.", reveal: { label: "New temporary password", value: temporaryPassword } };
  });
}

export async function changePasswordAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    const current = String(form.get("current") ?? "");
    const next = String(form.get("next") ?? "");
    if (next !== String(form.get("confirm") ?? "")) return { error: "The new passwords do not match." };
    await changeOwnPassword(actor, current, next);
    return "Password changed. Your other sessions were signed out.";
  });
}

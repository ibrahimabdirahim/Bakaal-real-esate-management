"use server";

import { z } from "zod";
import { finish, parseForm, runAction, type ActionState } from "@/server/action";
import { createUnit, updateUnit } from "@/server/services/property";
import { optionalText, requiredText } from "@/server/validation";

const unitSchema = z.object({
  unitNumber: requiredText("Unit ID/Name", 30),
  floor: optionalText(30),
  unitType: optionalText(60),
  notes: optionalText(),
});

export async function createUnitAction(_: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  const state = await runAction(async (actor) => {
    id = (await createUnit(actor, parseForm(unitSchema, form))).id;
  });
  if (state?.error) return { ...state, values: submittedValues(form) };
  finish(`/units/${id}?created=1`);
}

/** The typed values, returned with a refused save so the form shows them again. */
function submittedValues(form: FormData) {
  return Object.fromEntries(["unitNumber", "floor", "unitType", "notes", "isActive"].map((k) => [k, String(form.get(k) ?? "")]));
}

export async function updateUnitAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  const state = await runAction(async (actor) => {
    const input = parseForm(unitSchema, form);
    await updateUnit(actor, id, { ...input, isActive: form.get("isActive") === "on" });
    return "Unit updated.";
  });
  return state?.error ? { ...state, values: submittedValues(form) } : state;
}

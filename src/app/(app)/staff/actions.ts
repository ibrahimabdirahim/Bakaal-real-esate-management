"use server";

import { z } from "zod";
import { finish, parseForm, runAction, type ActionState } from "@/server/action";
import { createTask, saveStaff, setStaffSalary, setTaskStatus } from "@/server/services/operations";
import { optionalIsoDate, optionalMoney, optionalText, requiredText } from "@/server/validation";

const staffSchema = z.object({
  fullName: requiredText("Name", 150),
  position: requiredText("Position", 80),
  phone: optionalText(40),
  salaryAmount: optionalMoney("Monthly salary"),
  startDate: optionalIsoDate("Start date"),
  endDate: optionalIsoDate("End date"),
  notes: optionalText(),
});

export async function createStaffAction(_: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  const state = await runAction(async (actor) => {
    id = (await saveStaff(actor, null, parseForm(staffSchema, form))).id;
  });
  if (state?.error) return state;
  // Back to the staff list, which confirms the new record.
  finish(`/staff?created=${id}`);
}

export async function updateStaffAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    await saveStaff(actor, id, parseForm(staffSchema, form));
    return "Staff record updated.";
  });
}

const taskSchema = z.object({
  title: requiredText("Task", 200),
  staffMemberId: optionalText(40),
  dueDate: optionalIsoDate("Due date"),
  notes: optionalText(),
});

export async function createTaskAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    await createTask(actor, parseForm(taskSchema, form));
    return "Task created.";
  });
}

export async function closeTaskAction(id: string, status: "DONE" | "CANCELLED", _: ActionState): Promise<ActionState> {
  return runAction(async (actor) => {
    await setTaskStatus(actor, id, status);
    return status === "DONE" ? "Task completed." : "Task cancelled.";
  });
}

export async function setSalaryAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    const { salaryAmount } = parseForm(z.object({ salaryAmount: optionalMoney("Monthly salary") }), form);
    await setStaffSalary(actor, id, salaryAmount);
    return "Salary updated.";
  });
}

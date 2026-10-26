"use client";

import { ActionForm, SubmitButton, TextArea, TextInput } from "@/components/forms";
import type { ActionState } from "@/server/action";

export type StaffDefaults = Partial<Record<"fullName" | "position" | "phone" | "salaryAmount" | "startDate" | "endDate" | "notes", string>>;

export function StaffForm({ action, defaults = {}, canSalary }: { action: (s: ActionState, f: FormData) => Promise<ActionState>; defaults?: StaffDefaults; canSalary: boolean }) {
  return (
    <ActionForm action={action}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TextInput label="Full name" name="fullName" required defaultValue={defaults.fullName} />
        <TextInput label="Position" name="position" required defaultValue={defaults.position} placeholder="Cleaner, Guard, Caretaker…" />
        <TextInput label="Phone" name="phone" type="tel" defaultValue={defaults.phone} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TextInput label="Start date" name="startDate" type="date" defaultValue={defaults.startDate} />
        <TextInput label="End date" name="endDate" type="date" defaultValue={defaults.endDate} />
        {canSalary && <TextInput label="Monthly salary (restricted)" name="salaryAmount" inputMode="decimal" defaultValue={defaults.salaryAmount} hint="Visible only to staff with salary access." />}
      </div>
      <TextArea label="Notes / duties" name="notes" defaultValue={defaults.notes} />
      <SubmitButton>{defaults.fullName ? "Save changes" : "Add staff member"}</SubmitButton>
    </ActionForm>
  );
}

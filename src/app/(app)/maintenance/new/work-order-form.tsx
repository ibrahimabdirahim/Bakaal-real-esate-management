"use client";

import { ActionForm, Select, SubmitButton, TextArea, TextInput } from "@/components/forms";
import { createWorkOrderAction } from "../actions";
import { REPORTED_VIA } from "../labels";

export function WorkOrderForm({ units, unitId }: { units: { value: string; label: string }[]; unitId: string }) {
  return (
    <ActionForm action={createWorkOrderAction}>
      <TextInput label="Issue" name="title" required placeholder="e.g. Leaking pipe in kitchen" />
      <TextArea label="Description" name="description" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select label="Unit" name="unitId" defaultValue={unitId} placeholder="Common area (no unit)" options={units} />
        <TextInput label="Common area / location" name="location" placeholder="e.g. Stairwell B, roof tank" hint="Required if no unit is chosen" />
        <Select label="Priority" name="priority" defaultValue="MEDIUM" options={[{ value: "LOW", label: "Low" }, { value: "MEDIUM", label: "Medium" }, { value: "HIGH", label: "High" }, { value: "URGENT", label: "Urgent" }]} />
        <Select label="Reported via" name="reportedVia" placeholder="Choose" options={REPORTED_VIA.map((v) => ({ value: v, label: v }))} />
      </div>
      <SubmitButton>Open work order</SubmitButton>
    </ActionForm>
  );
}

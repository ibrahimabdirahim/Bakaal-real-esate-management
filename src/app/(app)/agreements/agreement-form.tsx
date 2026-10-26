"use client";

import { useState } from "react";
import { ActionForm, Select, SubmitButton, TextArea, TextInput } from "@/components/forms";
import type { ActionState } from "@/server/action";
import { AGREEMENT_TYPE_LABELS } from "./labels";

type Option = { value: string; label: string };

export function AgreementForm({
  action,
  units,
  parties,
  defaults,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  units: Option[];
  parties: Option[];
  defaults: { unitId?: string; partyId?: string };
}) {
  const [type, setType] = useState<"RENTAL" | "OWNERSHIP" | "MANAGEMENT">("RENTAL");
  return (
    <ActionForm action={action}>
      <Select
        label="Agreement type"
        name="type"
        required
        value={type}
        onChange={(e) => setType(e.target.value as typeof type)}
        options={Object.entries(AGREEMENT_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
        hint={
          type === "RENTAL"
            ? "A tenant renting the unit. Rent and approved charges are billed monthly."
            : type === "OWNERSHIP"
              ? "A purchased unit. Owners are never charged rent; only approved charges you add later are billed."
              : "Bakaal manages an owner's purchased unit for a fee. Record the ownership first."
        }
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select label="Unit" name="unitId" required defaultValue={defaults.unitId ?? ""} placeholder="Choose a unit" options={units} />
        <Select label={type === "RENTAL" ? "Tenant" : "Owner"} name="partyId" required defaultValue={defaults.partyId ?? ""} placeholder="Choose an account" options={parties} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TextInput label="Start date" name="startDate" type="date" required />
        <TextInput label="End date" name="endDate" type="date" hint="Leave empty if open-ended" />
        <TextInput label="Agreement reference" name="reference" placeholder="e.g. contract number" />
      </div>

      {type === "RENTAL" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextInput label="Monthly rent (KES)" name="rentAmount" inputMode="decimal" required placeholder="25000.00" />
          <TextInput label="Deposit Amount (KES)" name="depositAmount" inputMode="decimal" placeholder="Optional" hint="Agreed amount only: not invoiced, not counted as received." />
        </div>
      )}
      {type === "MANAGEMENT" && (
        <TextInput label="Monthly management fee (KES)" name="managementFeeAmount" inputMode="decimal" hint="Leave empty if the agreement sets no fixed monthly fee" />
      )}
      {type === "OWNERSHIP" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextInput label="Purchase date" name="purchaseDate" type="date" />
          <TextInput label="Ownership evidence" name="ownershipEvidence" required placeholder="e.g. sale agreement / title reference" />
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextInput label="Due day of the month" name="dueDay" inputMode="numeric" placeholder="1–28" hint="From the agreement. If empty, an approved building policy is used, otherwise the invoice is held for review." />
        <TextInput label="Grace period (days)" name="graceDays" inputMode="numeric" hint="Only if the agreement states one. Not invented if empty." />
      </div>
      <TextArea label="Late-fee terms (recorded only)" name="lateFeeTerms" hint="Late fees are not calculated by the system (policy deferred). Record the agreement's wording for reference." />
      <TextArea label="Payment allocation terms (recorded only)" name="allocationTerms" hint="Payments are always allocated by staff; record what the agreement says." />
      <TextArea label="Notes" name="notes" />
      <SubmitButton>Create agreement</SubmitButton>
    </ActionForm>
  );
}

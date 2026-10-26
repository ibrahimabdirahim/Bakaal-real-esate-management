"use client";

import Link from "next/link";
import { ActionForm, Select, SubmitButton, TextArea, TextInput } from "@/components/forms";
import type { ActionState } from "@/server/action";
import { DocumentUploader } from "@/components/document-uploader";
import { EXPENSE_CATEGORY_LABELS } from "./labels";

type Option = { value: string; label: string };
export type ExpenseDefaults = Partial<Record<"category" | "payee" | "description" | "amount" | "servicePeriodStart" | "servicePeriodEnd" | "costCentre" | "evidenceNote" | "workOrderId" | "staffMemberId", string>>;

export function ExpenseForm({
  action,
  defaults = {},
  workOrders,
  allowSalaries,
  uploadMaxBytes,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  defaults?: ExpenseDefaults;
  workOrders: Option[];
  /** Shows where salaries are recorded instead (roles with salary access). */
  allowSalaries: boolean;
  /** Shows upload areas (new expenses); drafts add files on the expense page instead. */
  uploadMaxBytes?: number;
}) {
  const categories = Object.entries(EXPENSE_CATEGORY_LABELS)
    // Salaries are recorded under Staff → Salary Payments (linked to a staff member and month).
    .filter(([v]) => v !== "SALARIES")
    .map(([value, label]) => ({ value, label }));
  return (
    <ActionForm action={action}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Select label="Category" name="category" required defaultValue={defaults.category ?? ""} placeholder="Choose" options={categories} />
        <TextInput label="Payee" name="payee" required defaultValue={defaults.payee} />
        <TextInput label="Amount (KES)" name="amount" inputMode="decimal" required defaultValue={defaults.amount} />
      </div>
      <TextArea label="Description" name="description" required defaultValue={defaults.description} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TextInput label="Service period from" name="servicePeriodStart" type="date" defaultValue={defaults.servicePeriodStart} />
        <TextInput label="Service period to" name="servicePeriodEnd" type="date" defaultValue={defaults.servicePeriodEnd} />
        <TextInput label="Cost centre" name="costCentre" defaultValue={defaults.costCentre} placeholder="e.g. Common areas" />
      </div>
      <TextArea label="Evidence (invoice / receipt details)" name="evidenceNote" defaultValue={defaults.evidenceNote} hint="Supplier invoice number, receipt number and where the paper copy is filed." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select label="Linked work order" name="workOrderId" defaultValue={defaults.workOrderId ?? ""} placeholder="None" options={workOrders} />
        {allowSalaries && (
          <p className="self-end pb-2 text-xs text-muted">
            Salaries are recorded under <Link href="/staff/salary-payments/new" className="font-medium text-primary-600 hover:underline">Staff → Salary Payments</Link>, linked to the staff member and month.
          </p>
        )}
      </div>
      {uploadMaxBytes && (
        <DocumentUploader
          ownerType="EXPENSE"
          maxBytes={uploadMaxBytes}
          slots={[
            { category: "RECEIPT", label: "Receipt (optional)", multiple: true },
            { category: "SUPPLIER_INVOICE", label: "Supplier invoice or quote (optional)", multiple: true },
          ]}
        />
      )}
      <p className="text-xs text-slate-500">Recording an expense never bills tenants or owners. Any recovery from occupants must be added as an approved charge on their agreement.</p>
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="intent" value="submit">Submit for approval</SubmitButton>
        <SubmitButton name="intent" value="draft" variant="secondary">Save as draft</SubmitButton>
      </div>
    </ActionForm>
  );
}

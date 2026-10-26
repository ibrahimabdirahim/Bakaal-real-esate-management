"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { ActionForm, DeleteButton, SubmitButton, TextArea, TextInput } from "@/components/forms";
import type { ActionState } from "@/server/action";

type Party = { displayName: string; phone: string | null; email: string | null; idNumber: string | null; notes: string | null };
type Duplicates = NonNullable<NonNullable<ActionState>["duplicates"]>;

export function DuplicateError({ duplicates, isEdit, cancelHref }: { duplicates: Duplicates; isEdit: boolean; cancelHref: string }) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-950">
      <p className="flex items-center gap-2 font-semibold">
        <TriangleAlert className="size-4 shrink-0" aria-hidden /> {isEdit ? "These details belong to another account" : "This account already exists"} — nothing was saved
      </p>
      <p className="mt-1">Each person or company can have only one account. These existing accounts already use the details you entered (they open in a new tab):</p>
      <ul className="mt-2 space-y-1">
        {duplicates.map((d) => (
          <li key={d.id}>
            <Link href={`/accounts/${d.id}`} target="_blank" className="font-medium text-primary-700 underline">
              {d.displayName}
            </Link>
            {d.archived && <span className="ml-1 text-xs">(archived)</span>} — {d.reasons.join(", ")}
          </li>
        ))}
      </ul>
      <p className="mt-3">Use the existing account instead, or correct the highlighted details above and check again.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <SubmitButton variant="secondary">Check again</SubmitButton>
        <Link href={cancelHref} className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-red-100">
          Cancel
        </Link>
      </div>
    </div>
  );
}

export function PartyForm({
  action,
  party,
  canEditSensitive = true,
  cancelHref = "/accounts",
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  party?: Party;
  canEditSensitive?: boolean;
  cancelHref?: string;
}) {
  return (
    <ActionForm action={action}>
      {(state) => {
        // After a warning or error, show what was submitted rather than the saved values.
        const submitted = state?.values;
        const value = (key: keyof Party) => (submitted ? (submitted[key] ?? "") : (party?.[key] ?? ""));
        const duplicates = state?.duplicates ?? [];
        return (
          <div key={submitted ? JSON.stringify(submitted) : "saved"} className="space-y-4">
            <TextInput label="Full name or company" name="displayName" required defaultValue={value("displayName")} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextInput label="Phone" name="phone" type="tel" defaultValue={value("phone")} />
              <TextInput label="E-mail" name="email" type="email" defaultValue={value("email")} />
            </div>
            {canEditSensitive && (
              <TextInput label="ID / registration number" name="idNumber" defaultValue={value("idNumber")} hint="Sensitive: visible only to roles with access to sensitive account details." />
            )}
            <TextArea label="Notes" name="notes" defaultValue={value("notes")} />
            {duplicates.length > 0 ? (
              <DuplicateError duplicates={duplicates} isEdit={!!party} cancelHref={cancelHref} />
            ) : (
              <SubmitButton>{party ? "Save changes" : "Create account"}</SubmitButton>
            )}
          </div>
        );
      }}
    </ActionForm>
  );
}

export function DeleteAccountForm({ action, name }: { action: (s: ActionState, f: FormData) => Promise<ActionState>; name: string }) {
  return (
    <ActionForm action={action}>
      <p className="text-sm text-slate-600">{`This permanently removes “${name}”. Its audit history is kept.`}</p>
      <DeleteButton what="account">Delete account permanently</DeleteButton>
    </ActionForm>
  );
}

export function ArchiveAccountForm({ action, name }: { action: (s: ActionState, f: FormData) => Promise<ActionState>; name: string }) {
  return (
    <ActionForm action={action}>
      <TextArea
        label="Reason for archiving"
        name="archiveReason"
        required
        hint="Recorded in the audit log with your name and the time, e.g. “Duplicate of the account created on 21 Oct 2026”."
      />
      <SubmitButton
        variant="danger"
        name="archive"
        confirm={`Archive “${name}”? It will be hidden from the register and cannot be used for new agreements, invoices or payments. Nothing is deleted, and it stays visible under “Show archived”.`}
      >
        Archive account
      </SubmitButton>
    </ActionForm>
  );
}

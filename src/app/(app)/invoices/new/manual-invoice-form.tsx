"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, TextArea, TextInput } from "@/components/forms";
import { AccountUnitPicker } from "@/components/account-picker";
import { formatDate, isISODate, todayISO } from "@/lib/dates";
import { sumCents, tryCents } from "@/lib/money";
import { CHARGE_CATEGORY_LABELS } from "../../agreements/labels";
import { createManualInvoiceAction } from "../actions";

type Option = { value: string; label: string };
const categoryOptions = Object.entries(CHARGE_CATEGORY_LABELS).map(([value, label]) => ({ value, label }));

/**
 * Create invoice. With `canIssue` (single-operator, F49: someone who may create and issue manual
 * invoices) it is saved and issued in one step; otherwise it is saved as a draft for review, as before.
 */
export function ManualInvoiceForm({
  parties,
  defaults,
  defaultPartyId = "",
  canIssue,
}: {
  parties: Option[];
  defaultPartyId?: string;
  canIssue: boolean;
  defaults: { agreementId: string; unitId: string; partyId: string; label: string } | null;
}) {
  const [rows, setRows] = useState(2);
  // Agreements are looked up as at the due date (today until one is entered).
  const [dueDate, setDueDate] = useState("");
  const on = isISODate(dueDate) ? dueDate : todayISO();
  // Total of the lines typed so far (shown only; the server adds them up again when saving).
  const [total, setTotal] = useState(0);
  const recount = (fieldset: HTMLFieldSetElement) =>
    setTotal(sumCents([...fieldset.querySelectorAll<HTMLInputElement>('input[name="lineAmount"]')].map((i) => tryCents(i.value) ?? 0).filter((c) => c > 0)));
  return (
    <ActionForm action={createManualInvoiceAction}>
      {canIssue && <input type="hidden" name="issue" value="1" />}
      {defaults ? (
        <>
          <input type="hidden" name="agreementId" value={defaults.agreementId} />
          <input type="hidden" name="unitId" value={defaults.unitId} />
          <input type="hidden" name="partyId" value={defaults.partyId} />
          <p className="text-sm">
            For: <span className="font-medium">{defaults.label}</span>
          </p>
        </>
      ) : (
        <AccountUnitPicker parties={parties} on={on} defaultPartyId={defaultPartyId} invoiceTotal={total} />
      )}
      {canIssue && <p className="text-sm text-muted">{`Invoice date: today, ${formatDate(todayISO())} (the date it is issued).`}</p>}
      <TextInput label="Due date" name="dueDate" type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} hint="The account's agreements are checked as at this date. The agreed rent is shown for reference; add only the lines this invoice is authorised to charge." />
      <fieldset className="space-y-3" onInput={(e) => recount(e.currentTarget)}>
        <legend className="text-sm font-medium text-slate-700">Lines</legend>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50/50 p-3 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-500" htmlFor={`cat-${i}`}>Category</label>
              <select id={`cat-${i}`} name="lineCategory" defaultValue="OTHER" className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none">
                {categoryOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="sm:col-span-3">
              <label className="block text-xs text-slate-500" htmlFor={`desc-${i}`}>Description</label>
              <input id={`desc-${i}`} name="lineDescription" className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs text-slate-500" htmlFor={`amt-${i}`}>Amount</label>
              <input id={`amt-${i}`} name="lineAmount" inputMode="decimal" className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none" />
            </div>
          </div>
        ))}
        <button type="button" onClick={() => setRows((r) => r + 1)} className="text-sm font-medium text-primary-600 hover:underline">+ Add line</button>
      </fieldset>
      <TextArea label="Notes" name="notes" placeholder="e.g. Final settlement under the ended agreement; reference of approval" />
      <p className="text-sm">Invoice total <strong className="tabular-nums" data-form-total>{`KES ${(total / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}</strong></p>
      <SubmitButton>{canIssue ? "Create and issue invoice" : "Save draft for review"}</SubmitButton>
      {!canIssue && <p className="text-xs text-muted">Your role drafts manual invoices; a finance officer or administrator issues them.</p>}
    </ActionForm>
  );
}

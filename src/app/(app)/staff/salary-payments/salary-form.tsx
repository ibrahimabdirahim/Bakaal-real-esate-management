"use client";

import { useState } from "react";
import Link from "next/link";
import { ActionForm, Select, SubmitButton, TextArea, TextInput } from "@/components/forms";
import { DocumentUploader } from "@/components/document-uploader";
import { Money } from "@/components/ui";
import type { ActionState } from "@/server/action";
import { formatMoney, tryCents } from "@/lib/money";

type StaffOption = { value: string; label: string; salary: string | null };
export type SalaryDefaults = Partial<Record<"staffMemberId" | "month" | "gross" | "allowances" | "deductions" | "notes" | "evidenceNote", string>>;

/**
 * Record or edit a salary payment. Net payable = gross + allowances − deductions, shown as
 * the user types and computed again on the server. No statutory deductions are calculated.
 */
export function SalaryForm({
  action,
  staff,
  defaults = {},
  maxMonth,
  uploadMaxBytes,
  cancelHref,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  staff: StaffOption[];
  defaults?: SalaryDefaults;
  maxMonth: string;
  /** Shows the supporting-document upload (new records); drafts add files on the record page. */
  uploadMaxBytes?: number;
  cancelHref: string;
}) {
  return (
    <ActionForm action={action}>
      {(state) => <Fields key={state?.values ? JSON.stringify(state.values) : "new"} staff={staff} defaults={{ ...defaults, ...state?.values }} maxMonth={maxMonth} uploadMaxBytes={uploadMaxBytes} cancelHref={cancelHref} />}
    </ActionForm>
  );
}

function Fields({ staff, defaults, maxMonth, uploadMaxBytes, cancelHref }: { staff: StaffOption[]; defaults: SalaryDefaults; maxMonth: string; uploadMaxBytes?: number; cancelHref: string }) {
  const [staffId, setStaffId] = useState(defaults.staffMemberId ?? "");
  const agreed = staff.find((s) => s.value === staffId)?.salary ?? null;
  const [gross, setGross] = useState(defaults.gross ?? agreed ?? "");
  const [allowances, setAllowances] = useState(defaults.allowances ?? "");
  const [deductions, setDeductions] = useState(defaults.deductions ?? "");
  const parts = [gross, allowances || "0", deductions || "0"].map((v) => tryCents(v));
  const net = parts.every((p) => p != null && p >= 0) ? parts[0]! + parts[1]! - parts[2]! : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Staff member"
          name="staffMemberId"
          required
          value={staffId}
          onChange={(e) => {
            const next = staff.find((s) => s.value === e.target.value);
            setStaffId(e.target.value);
            // Start from the agreed salary unless the user already typed a gross amount.
            if (!gross && next?.salary) setGross(next.salary);
          }}
          placeholder="Choose a staff member"
          options={staff}
        />
        <TextInput label="Salary month" name="month" type="month" required max={maxMonth} defaultValue={defaults.month?.slice(0, 7)} hint="The month this salary is for. Future months are not allowed." />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TextInput
          label="Gross salary (KES)"
          name="gross"
          inputMode="decimal"
          required
          value={gross}
          onChange={(e) => setGross(e.target.value)}
          hint={agreed && tryCents(agreed) != null ? `Agreed monthly salary: ${formatMoney(tryCents(agreed)!)}` : "No agreed salary recorded for this staff member."}
        />
        <TextInput label="Allowances (KES)" name="allowances" inputMode="decimal" value={allowances} onChange={(e) => setAllowances(e.target.value)} placeholder="0.00" hint="Optional" />
        <TextInput label="Deductions (KES)" name="deductions" inputMode="decimal" value={deductions} onChange={(e) => setDeductions(e.target.value)} placeholder="0.00" hint="Optional, as agreed (e.g. an advance)." />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-slate-50 px-4 py-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Net salary payable</p>
          <p className="text-xl font-semibold text-ink">{net != null && net > 0 ? <Money cents={net} /> : "—"}</p>
        </div>
        <p className="max-w-md text-xs text-muted">
          Gross + allowances − deductions. PAYE, NSSF, SHIF, the housing levy and other statutory deductions are <strong>not calculated</strong> by the system (no payroll rules are
          approved): enter any agreed deduction yourself.
        </p>
      </div>
      {net != null && net <= 0 && <p className="text-sm text-red-700">Deductions cannot equal or exceed the gross salary plus allowances.</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextArea label="Notes" name="notes" defaultValue={defaults.notes} hint="Optional, e.g. overtime agreed for the month." />
        <TextArea label="Supporting details" name="evidenceNote" defaultValue={defaults.evidenceNote} hint="Optional: attendance sheet, payslip number or where the paper copy is filed." />
      </div>
      {uploadMaxBytes != null && (
        <DocumentUploader ownerType="EXPENSE" maxBytes={uploadMaxBytes} slots={[{ category: "OTHER", label: "Supporting documents (optional)", hint: "e.g. signed payslip or attendance sheet. PDF, JPEG or PNG, stored privately.", multiple: true }]} />
      )}
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
        <Link href={cancelHref} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
          Cancel
        </Link>
        <SubmitButton variant="secondary" name="intent" value="draft">
          Save draft
        </SubmitButton>
        <SubmitButton name="intent" value="submit">
          Submit for approval
        </SubmitButton>
      </div>
    </div>
  );
}

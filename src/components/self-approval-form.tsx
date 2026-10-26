"use client";

import { ActionForm, SubmitButton, TextArea } from "@/components/forms";
import type { ActionState } from "@/server/action";

type Button = { label: string; name: string; value?: string; variant?: "primary" | "secondary" | "danger"; confirm: string };

/**
 * The administrator self-approval exception (payments, manual invoices): a written
 * reason, an explicit confirmation and a confirm dialog. The server checks all of it again.
 */
export function SelfApprovalForm({
  action,
  minReason,
  confirmText,
  placeholder,
  buttons,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  minReason: number;
  confirmText: string;
  placeholder: string;
  buttons: Button[];
}) {
  return (
    <ActionForm action={action}>
      {/* Tells the server the exception is requested; it still checks eligibility itself. */}
      <input type="hidden" name="selfException" value="yes" />
      <TextArea
        label="Reason and what you checked"
        name="reason"
        required
        minLength={minReason}
        placeholder={placeholder}
        hint={`At least ${minReason} characters. Recorded permanently in the audit log with your name and the time.`}
      />
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" name="confirmSelf" value="yes" required className="mt-0.5" />
        <span>{confirmText}</span>
      </label>
      <div className="flex flex-wrap gap-2">
        {buttons.map((b) => (
          <SubmitButton key={b.label} variant={b.variant ?? "secondary"} name={b.name} value={b.value} confirm={b.confirm}>
            {b.label}
          </SubmitButton>
        ))}
      </div>
    </ActionForm>
  );
}

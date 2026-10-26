import { ActionForm, SubmitButton } from "@/components/forms";
import { Notice } from "@/components/ui";
import { APPROVALS, APPROVE_LABEL, type ApprovalKind } from "@/lib/approval";
import type { ActionState } from "@/server/action";

/**
 * The Approve button of a record page (F61): one confirmation (Cancel / Confirm Approval), nothing to
 * type. On success the page reloads with ApprovedNotice; a refusal (permission, status) is shown here.
 */
export function ApproveForm({
  action,
  kind,
  returnTo,
  label = "Approve",
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  kind: ApprovalKind;
  returnTo: string;
  label?: string;
}) {
  const a = APPROVALS[kind];
  return (
    <ActionForm action={action} className="space-y-3">
      <input type="hidden" name="returnTo" value={returnTo} />
      <SubmitButton name="approve" confirm={a.message} confirmTitle={a.title} confirmLabel={APPROVE_LABEL}>
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

/** The success message after an approval (the page was opened with `approved=1`). */
export function ApprovedNotice({ kind, show }: { kind: ApprovalKind; show: boolean }) {
  if (!show) return null;
  return (
    <div className="mb-6">
      <Notice tone="green">{APPROVALS[kind].success}</Notice>
    </div>
  );
}

import Link from "next/link";
import { DocumentsCard } from "../../documents/documents-card";
import { notFound } from "next/navigation";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { allowedNextStatuses, getWorkOrder, listStaff } from "@/server/services/operations";
import { cents } from "@/server/services/common";
import { ButtonLink, Card, DescriptionList, Money, PageHeader, Table, Td } from "@/components/ui";
import { ActionForm, Select, SubmitButton, TextArea, TextInput } from "@/components/forms";
import { formatDateTime, fromDbDate, todayISO } from "@/lib/dates";
import { centsToDecimalString } from "@/lib/money";
import { STATUS_LABELS } from "../labels";
import { approveQuoteAction, rejectQuoteAction, updateWorkOrderAction } from "../actions";
import { ApprovedNotice, ApproveForm } from "@/components/approve-form";

import { StatusBadge } from "@/components/status";
import { Wrench } from "lucide-react";

export default async function WorkOrderPage({ params, searchParams }: PageProps<"/maintenance/[id]">) {
  const actor = await requirePage("workorders.view");
  const { id } = await params;
  const sp = await searchParams;
  const data = await getWorkOrder(actor, id);
  if (!data) notFound();
  const { workOrder: w, users } = data;
  const closed = w.status === "COMPLETED" || w.status === "CANCELLED";
  const quote = cents(w.quoteAmount);
  const statusOptions = [w.status, ...allowedNextStatuses(w.status)].map((s) => ({ value: s, label: STATUS_LABELS[s as keyof typeof STATUS_LABELS] }));
  // "Mark completed" / "Cancel request" from the list preselect that step when it is allowed (the server checks it again).
  const preset = typeof sp.set === "string" && statusOptions.some((o) => o.value === sp.set && o.value !== w.status) ? sp.set : w.status;
  // Suggestions for the assignee: current staff (an outside contractor can still be typed in).
  const staffNames = can(actor.role, "staff.view") ? (await listStaff(actor)).filter((m) => !m.endDate || fromDbDate(m.endDate) >= todayISO()).map((m) => m.fullName) : [];

  return (
    <>
      <PageHeader icon={Wrench}
        title={`${w.number}: ${w.title}`}
        back={{ href: "/maintenance", label: "Maintenance" }}
        description={<span className="flex gap-2"><StatusBadge kind="priority" status={w.priority} /><StatusBadge kind="workorder" status={w.status} /></span>}
        actions={can(actor.role, "expenses.submit") ? <ButtonLink variant="secondary" href={`/expenses/new?workOrderId=${w.id}&category=REPAIRS`}>Record linked expense</ButtonLink> : null}
      />
      <ApprovedNotice kind="maintenance" show={sp.approved === "1" && w.quoteApproved === true} />
      <Card title="Details">
        <DescriptionList
          items={[
            ["Location", w.unit ? <Link key="u" href={`/units/${w.unit.id}`} className="text-primary-600 hover:underline">Unit {w.unit.unitNumber}</Link> : w.location],
            ["Description", w.description],
            ["Reported via", w.reportedVia],
            ["Assigned to", w.assignee],
            ["Quote", quote != null ? <span key="q"><Money cents={quote} /> — {w.quoteApproved == null ? "awaiting decision" : w.quoteApproved ? "approved" : "rejected"}</span> : "—"],
            ["Outcome", w.outcome],
            ["Cost treatment", w.costTreatment],
            ["Opened", `${users.get(w.createdById) ?? "—"} · ${formatDateTime(w.createdAt)}`],
            ["Closed", w.closedAt ? formatDateTime(w.closedAt) : "—"],
          ]}
        />
      </Card>

      {!closed && quote != null && w.quoteApproved == null && can(actor.role, "workorders.approve_quote") && (
        <Card title="Quote decision" id="quote" className="mt-6 scroll-mt-20">
          <p className="mb-4 text-sm">
            Quote of <Money cents={quote} /> from {w.assignee ?? "the assigned worker/vendor"}. Approving it does not change the work order&apos;s status or complete it.
          </p>
          <div className="flex flex-wrap items-start gap-2">
            <ApproveForm action={approveQuoteAction.bind(null, w.id)} kind="maintenance" returnTo={`/maintenance/${w.id}`} label="Approve quote" />
            <ActionForm action={rejectQuoteAction.bind(null, w.id)} className="space-y-3">
              <SubmitButton variant="danger">Reject quote</SubmitButton>
            </ActionForm>
          </div>
        </Card>
      )}

      {!closed && can(actor.role, "workorders.manage") && (
        <Card title="Update" id="update" className="mt-6 scroll-mt-20" description={preset === "COMPLETED" ? "Completing needs the outcome and the cost treatment." : preset === "CANCELLED" ? "Cancelling closes the work order; it stays in the history." : undefined}>
          <ActionForm action={updateWorkOrderAction.bind(null, w.id)}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Select label="Status" name="status" defaultValue={preset} options={statusOptions} />
              <TextInput label="Assigned worker / vendor" name="assignee" defaultValue={w.assignee ?? ""} list="staff-names" hint="A staff member, or type a contractor's name" />
              <datalist id="staff-names">{staffNames.map((n) => <option key={n} value={n} />)}</datalist>
              <TextInput label="Quote amount (KES)" name="quoteAmount" inputMode="decimal" defaultValue={quote != null ? centsToDecimalString(quote) : ""} hint="Changing the quote resets its approval" />
            </div>
            <TextArea label="Outcome" name="outcome" defaultValue={w.outcome ?? ""} hint="Required to complete" />
            <TextInput label="Cost treatment" name="costTreatment" defaultValue={w.costTreatment ?? ""} placeholder="e.g. No cost / Expense EXP-… / Charged under agreement" hint="Required to complete" />
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </Card>
      )}

      <Card title="Linked expenses" className="mt-6">
        <Table head={["Expense", "Payee", "Amount", "Status"]} empty="No expenses linked.">
          {w.expenses.map((e) => (
            <tr key={e.id}>
              <Td><Link href={`/expenses/${e.id}`} className="text-primary-600 hover:underline">{e.number}</Link></Td>
              <Td>{e.payee}</Td>
              <Td><Money cents={cents(e.amount)} /></Td>
              <Td><StatusBadge kind="expense" status={e.status} /></Td>
            </tr>
          ))}
        </Table>
      </Card>

      <DocumentsCard actor={actor} ownerType="WORK_ORDER" ownerId={w.id} title="Photographs and quotes" className="mt-6" slots={[{ category: "PHOTO", label: "Before / after photographs", multiple: true }, { category: "SUPPLIER_INVOICE", label: "Quote or supplier invoice", multiple: true }, { category: "OTHER", multiple: true }]} />
    </>
  );
}

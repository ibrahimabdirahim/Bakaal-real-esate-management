import Link from "next/link";
import { notFound } from "next/navigation";
import { Wallet } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { getSalaryPayment } from "@/server/services/salaries";
import { canDecideExpense, listStaff } from "@/server/services/operations";
import { ButtonLink, Card, DescriptionList, Money, Notice, PageHeader, Table, Td } from "@/components/ui";
import { ActionForm, Select, SubmitButton, TextInput } from "@/components/forms";
import { ApprovedNotice, ApproveForm } from "@/components/approve-form";
import { DocumentUploader } from "@/components/document-uploader";
import { StatusBadge } from "@/components/status";
import { MAX_DOCUMENT_BYTES } from "@/server/storage";
import { centsToDecimalString, formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, formatMonth, monthStart, todayISO } from "@/lib/dates";
import { DocumentsCard } from "../../../documents/documents-card";
import { METHOD_LABELS } from "../../../payments/labels";
import { approveSalaryAction, paySalaryAction, rejectSalaryAction, updateSalaryAction } from "../actions";
import { SalaryForm } from "../salary-form";

export const metadata = { title: "Salary payment" };

export default async function SalaryPaymentPage({ params, searchParams }: PageProps<"/staff/salary-payments/[id]">) {
  const actor = await requirePage("salary.view");
  const { id } = await params;
  const sp = await searchParams;
  const data = await getSalaryPayment(actor, id);
  if (!data) notFound();
  const { expense: e, row: r, users, history } = data;
  const who = (uid: string | null, at: Date | null) => (uid ? `${users.get(uid) ?? "—"}${at ? ` · ${formatDateTime(at)}` : ""}` : "—");
  const editable = e.status === "DRAFT" && can(actor.role, "salary.manage") && can(actor.role, "expenses.submit");
  // A rejected salary payment stays as decided (database-protected); it is corrected by recording a new copy.
  const canCopy = e.status === "REJECTED" && can(actor.role, "salary.manage") && can(actor.role, "expenses.submit");
  const awaitingDecision = e.status === "SUBMITTED" && can(actor.role, "expenses.approve");
  const canDecide = awaitingDecision && canDecideExpense(actor, e);
  const selfDecided = e.decidedById != null && (e.decidedById === e.createdById || e.decidedById === e.submittedById);
  const canPay = e.status === "APPROVED" && can(actor.role, "expenses.pay");
  const staff = editable ? await listStaff(actor) : [];
  const amount = (c: number | null) => (c != null ? centsToDecimalString(c) : "");

  return (
    <>
      <PageHeader
        icon={Wallet}
        title={`Salary payment ${e.number}`}
        back={{ href: "/staff/salary-payments", label: "Staff Payments" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="salary" status={e.status} />
            <span>
              {r.staff?.fullName ?? r.payee} · {r.month ? formatMonth(r.month) : "no month"}
            </span>
          </span>
        }
      />
      {sp.saved === "1" && (
        <div className="mb-6">
          <Notice tone="green">{e.status === "SUBMITTED" ? "Salary payment recorded and submitted for approval. It is not approved or paid yet." : "Draft saved. Submit it for approval when it is ready."}</Notice>
        </div>
      )}
      <ApprovedNotice kind="salary" show={sp.approved === "1" && e.status === "APPROVED"} />
      {sp.paid === "1" && e.status === "PAID" && (
        <div className="mb-6">
          <Notice tone="green">Salary payment marked as paid successfully.</Notice>
        </div>
      )}
      {selfDecided && (
        <div className="mb-6">
          <Notice tone="blue">{`${e.status === "REJECTED" ? "Rejected" : "Approved"} by the person who recorded or submitted it (${who(e.decidedById, e.decidedAt)}).${e.decisionReason ? ` Reason: “${e.decisionReason}”.` : ""}`}</Notice>
        </div>
      )}
      {e.status === "APPROVED" && (
        <div className="mb-6">
          <Notice tone="blue">Approved, but no payment has been recorded yet. It counts as an approved salary expense; it is marked paid only when the actual payment is recorded below.</Notice>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Salary">
          <DescriptionList
            items={[
              ["Staff member", r.staff ? <Link key="s" href={`/staff/${r.staff.id}`} className="text-primary-600 hover:underline">{r.staff.fullName}</Link> : r.payee],
              ["Position", r.staff?.position ?? "—"],
              ["Salary month", r.month ? formatMonth(r.month) : "—"],
              ["Gross salary", <Money key="g" cents={r.gross} />],
              ["Allowances", <Money key="a" cents={r.allowances} />],
              ["Deductions", <Money key="d" cents={r.deductions} />],
              ["Net salary payable", <strong key="n"><Money cents={r.net} /></strong>],
              ["Notes", e.description],
              ["Supporting details", e.evidenceNote],
            ]}
          />
          <p className="mt-3 text-xs text-muted">Net = gross + allowances − deductions. Statutory deductions (PAYE, NSSF, SHIF, housing levy) are not calculated by the system.</p>
        </Card>
        <Card title="Progress">
          <DescriptionList
            items={[
              ["Recorded by", who(e.createdById, e.createdAt)],
              ["Submitted for approval", who(e.submittedById, e.submittedAt)],
              [e.status === "REJECTED" ? "Rejected by" : "Approved by", who(e.decidedById, e.decidedAt)],
              ["Decision reason", e.decisionReason],
              ["Paid on", formatDate(r.paidDate)],
              ["Payment method", e.paymentMethod ? METHOD_LABELS[e.paymentMethod] : "—"],
              ["Payment reference", e.paymentReference],
              ["Payment recorded by", who(e.paidById, e.paidAt)],
            ]}
          />
        </Card>
      </div>

      {canDecide ? (
        <Card title="Approve or reject" className="mt-6 scroll-mt-20" id="decide">
          <p className="mb-4 text-sm text-slate-600">Approving confirms the amount is owed. It does not mark the salary as paid; that happens when the payment is recorded.</p>
          <ApproveForm action={approveSalaryAction.bind(null, e.id)} kind="salary" returnTo={`/staff/salary-payments/${e.id}`} />
          <ActionForm action={rejectSalaryAction.bind(null, e.id)} className="mt-5 space-y-3 border-t border-line pt-5">
            <TextInput label="Reason for rejecting" name="reason" hint="Needed only to reject." />
            <SubmitButton variant="danger">Reject</SubmitButton>
          </ActionForm>
        </Card>
      ) : awaitingDecision ? (
        <Card title="Approve or reject" className="mt-6 scroll-mt-20" id="decide">
          <Notice>You recorded or submitted this salary payment, and your role may not decide its own records; another approver must decide on it.</Notice>
        </Card>
      ) : null}

      {canPay && (
        <Card title="Record the actual payment" className="mt-6 scroll-mt-20" id="pay">
          <ActionForm action={paySalaryAction.bind(null, e.id)}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <TextInput label="Payment date" name="paidDate" type="date" required max={todayISO()} defaultValue={todayISO()} hint="The day the money was actually sent." />
              <Select label="Paid by" name="method" required placeholder="Choose" options={[{ value: "MPESA", label: "M-Pesa" }, { value: "BANK", label: "Bank transfer" }, { value: "CASH", label: "Cash" }]} />
              <TextInput label="Payment reference" name="reference" placeholder="e.g. M-Pesa code" hint="If available." />
            </div>
            <DocumentUploader ownerType="EXPENSE" maxBytes={MAX_DOCUMENT_BYTES} slots={[{ category: "RECEIPT", label: "Payment proof (optional)", hint: "e.g. M-Pesa message, bank slip or signed cash voucher.", multiple: true }]} />
            <SubmitButton confirm={`Mark this salary of ${formatMoney(r.net)} as paid? This cannot be undone.`}>Mark as paid</SubmitButton>
          </ActionForm>
        </Card>
      )}

      {editable && (
        <Card title="Edit draft" className="mt-6 scroll-mt-20" id="edit">
          <SalaryForm
            action={updateSalaryAction.bind(null, e.id)}
            staff={staff.map((s) => ({ value: s.id, label: `${s.fullName} — ${s.position}`, salary: s.salaryAmount != null ? centsToDecimalString(s.salaryAmount) : null }))}
            defaults={{ staffMemberId: e.staffMemberId ?? "", month: r.month ?? "", gross: amount(r.gross), allowances: amount(r.allowances), deductions: amount(r.deductions), notes: e.description, evidenceNote: e.evidenceNote ?? "" }}
            maxMonth={monthStart(todayISO()).slice(0, 7)}
            cancelHref="/staff/salary-payments"
          />
        </Card>
      )}

      {canCopy && (
        <Card title="Correct this salary payment" className="mt-6">
          <p className="mb-3 text-sm text-slate-600">A rejected salary payment is kept exactly as it was decided, and its month is free again. Record a new one starting from a copy of this one.</p>
          <ButtonLink href={`/staff/salary-payments/new?copy=${e.id}`} variant="secondary">Record a corrected copy</ButtonLink>
        </Card>
      )}

      <DocumentsCard
        actor={actor}
        ownerType="EXPENSE"
        ownerId={e.id}
        title="Payslips and payment proof"
        className="mt-6"
        slots={[{ category: "RECEIPT", label: "Payment proof", multiple: true }, { category: "OTHER", label: "Payslip or other document", multiple: true }]}
      />

      <Card title="History" className="mt-6">
        <Table head={["When", "Who", "What", "Reason"]} empty="No history recorded.">
          {history.map((h) => (
            <tr key={String(h.id)}>
              <Td>{formatDateTime(h.occurredAt)}</Td>
              <Td>{h.actorEmail ?? "—"}</Td>
              <Td wrap>{h.summary}</Td>
              <Td wrap>{h.reason ?? "—"}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

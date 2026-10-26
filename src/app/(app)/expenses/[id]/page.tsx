import Link from "next/link";
import { DocumentsCard } from "../../documents/documents-card";
import { notFound, redirect } from "next/navigation";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { canDecideExpense, getExpense } from "@/server/services/operations";
import { cents } from "@/server/services/common";
import { ButtonLink, Card, DescriptionList, Money, Notice, PageHeader } from "@/components/ui";
import { DocumentUploader } from "@/components/document-uploader";
import { MAX_DOCUMENT_BYTES } from "@/server/storage";
import { ActionForm, DeleteButton, Select, SubmitButton, TextInput } from "@/components/forms";
import { ApprovedNotice, ApproveForm } from "@/components/approve-form";
import { formatDate, formatDateTime, optionalFromDbDate, todayISO } from "@/lib/dates";
import { centsToDecimalString } from "@/lib/money";
import { EXPENSE_CATEGORY_LABELS } from "../labels";
import { ExpenseForm } from "../expense-form";
import { expenseFormOptions } from "../options";
import { approveExpenseAction, deleteDraftExpenseAction, payExpenseAction, rejectExpenseAction, updateExpenseAction } from "../actions";
import { StatusBadge } from "@/components/status";
import { Receipt } from "lucide-react";

export default async function ExpensePage({ params, searchParams }: PageProps<"/expenses/[id]">) {
  const actor = await requirePage("expenses.view");
  const { id } = await params;
  const sp = await searchParams;
  const data = await getExpense(actor, id);
  if (!data) notFound();
  const { expense: e, users } = data;
  // Salary payments have their own page (breakdown, approval and payment steps).
  if (e.category === "SALARIES" && e.staffMemberId) redirect(`/staff/salary-payments/${e.id}`);
  const who = (uid: string | null, at: Date | null) => (uid ? `${users.get(uid) ?? "—"}${at ? ` · ${formatDateTime(at)}` : ""}` : "—");
  const editable = e.status === "DRAFT" && can(actor.role, "expenses.submit") && (e.createdById === actor.id || can(actor.role, "expenses.approve"));
  // A rejected expense stays as decided (database-protected); it is corrected by recording a new copy.
  const canCopy = e.status === "REJECTED" && can(actor.role, "expenses.submit");
  const awaitingDecision = e.status === "SUBMITTED" && can(actor.role, "expenses.approve");
  const canDecide = awaitingDecision && canDecideExpense(actor, e);
  const selfDecided = e.decidedById != null && (e.decidedById === e.createdById || e.decidedById === e.submittedById);

  return (
    <>
      <PageHeader icon={Receipt} title={`Expense ${e.number}`} back={{ href: "/expenses", label: "Expenses" }} description={<StatusBadge kind="expense" status={e.status} />} />
      <ApprovedNotice kind="expense" show={sp.approved === "1" && e.status === "APPROVED"} />
      {selfDecided && (
        <div className="mb-6">
          <Notice tone="blue">{`${e.status === "REJECTED" ? "Rejected" : "Approved"} by the person who created or submitted it (${who(e.decidedById, e.decidedAt)}).${e.decisionReason ? ` Reason: “${e.decisionReason}”.` : ""}`}</Notice>
        </div>
      )}
      <Card title="Details">
        <DescriptionList
          items={[
            ["Category", EXPENSE_CATEGORY_LABELS[e.category]],
            ["Payee", e.payee],
            ["Amount", <Money key="a" cents={cents(e.amount)} />],
            ["Description", e.description],
            ["Service period", e.servicePeriodStart ? `${formatDate(optionalFromDbDate(e.servicePeriodStart))} – ${formatDate(optionalFromDbDate(e.servicePeriodEnd))}` : "—"],
            ["Cost centre", e.costCentre],
            ["Evidence", e.evidenceNote],
            ["Work order", e.workOrder ? <Link key="w" href={`/maintenance/${e.workOrder.id}`} className="text-primary-600 hover:underline">{e.workOrder.number}</Link> : "—"],
            ["Staff member", e.staffMember ? e.staffMember.fullName : "—"],
            ["Created by", who(e.createdById, e.createdAt)],
            ["Submitted by", who(e.submittedById, e.submittedAt)],
            ["Decision by", who(e.decidedById, e.decidedAt)],
            ["Decision reason", e.decisionReason],
            ["Paid on", e.paidAt ? `${formatDate(optionalFromDbDate(e.paidDate) ?? todayISO(e.paidAt))} · ${e.paymentMethod} ${e.paymentReference ?? ""}` : "—"],
            ["Payment recorded by", who(e.paidById, e.paidAt)],
          ]}
        />
      </Card>

      {canDecide ? (
        <Card title="Approval" id="approval" className="mt-6 scroll-mt-20">
          <p className="mb-4 text-sm text-slate-600">Approving makes this an approved cost. It is not marked as paid until the payment is recorded.</p>
          <ApproveForm action={approveExpenseAction.bind(null, e.id)} kind="expense" returnTo={`/expenses/${e.id}`} />
          <ActionForm action={rejectExpenseAction.bind(null, e.id)} className="mt-5 space-y-3 border-t border-line pt-5">
            <TextInput label="Reason for rejecting" name="reason" hint="Needed only to reject." />
            <SubmitButton variant="danger">Reject</SubmitButton>
          </ActionForm>
        </Card>
      ) : awaitingDecision ? (
        <Card title="Approval" id="approval" className="mt-6 scroll-mt-20">
          <Notice>You created or submitted this expense, and your role may not decide its own expenses; another approver must decide on it.</Notice>
        </Card>
      ) : null}

      {e.status === "APPROVED" && can(actor.role, "expenses.pay") && (
        <Card title="Record payment of this expense" id="pay" className="mt-6 scroll-mt-20">
          <ActionForm action={payExpenseAction.bind(null, e.id)}>
            <p className="text-sm text-slate-600">Record this only once the money has actually been paid. Approval alone does not mean it was paid.</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <TextInput label="Payment date" name="paidDate" type="date" required max={todayISO()} defaultValue={todayISO()} hint="The day the money was actually paid." />
              <Select label="Paid by" name="method" required options={[{ value: "BANK", label: "Bank transfer" }, { value: "MPESA", label: "M-Pesa" }, { value: "CASH", label: "Cash" }]} />
              <TextInput label="Payment reference" name="reference" required />
            </div>
            <DocumentUploader ownerType="EXPENSE" maxBytes={MAX_DOCUMENT_BYTES} slots={[{ category: "RECEIPT", label: "Payment proof or receipt (optional)", multiple: true }]} />
            <SubmitButton confirm="Mark this expense as paid? This cannot be undone.">Mark as paid</SubmitButton>
          </ActionForm>
        </Card>
      )}

      {editable && (
        <Card title="Edit draft" id="edit" className="mt-6 scroll-mt-20">
          <ExpenseForm
            action={updateExpenseAction.bind(null, e.id)}
            allowSalaries={can(actor.role, "salary.view")}
            {...await expenseFormOptions()}
            defaults={{
              category: e.category,
              payee: e.payee,
              description: e.description,
              amount: centsToDecimalString(cents(e.amount)!),
              servicePeriodStart: optionalFromDbDate(e.servicePeriodStart) ?? undefined,
              servicePeriodEnd: optionalFromDbDate(e.servicePeriodEnd) ?? undefined,
              costCentre: e.costCentre ?? undefined,
              evidenceNote: e.evidenceNote ?? undefined,
              workOrderId: e.workOrderId ?? undefined,
              staffMemberId: e.staffMemberId ?? undefined,
            }}
          />
        </Card>
      )}

      {editable && (
        <Card title="Delete draft" id="delete" className="mt-6 scroll-mt-20">
          <p className="mb-3 text-sm text-slate-600">A draft was never submitted, so nothing was decided or paid. Deleting it is recorded in the audit log. Remove attached documents first.</p>
          <ActionForm action={deleteDraftExpenseAction.bind(null, e.id)}>
            <DeleteButton what={`draft expense ${e.number}`}>Delete draft</DeleteButton>
          </ActionForm>
        </Card>
      )}

      {canCopy && (
        <Card title="Correct this expense" id="correct" className="mt-6 scroll-mt-20">
          <p className="mb-3 text-sm text-slate-600">A rejected expense is kept exactly as it was decided. To correct it, record a new expense starting from a copy of this one.</p>
          <ButtonLink href={`/expenses/new?copy=${e.id}`} variant="secondary">Record a corrected copy</ButtonLink>
        </Card>
      )}

      <DocumentsCard actor={actor} ownerType="EXPENSE" ownerId={e.id} title="Receipts and invoices" className="mt-6" slots={[{ category: "RECEIPT", label: "Receipt", multiple: true }, { category: "SUPPLIER_INVOICE", label: "Supplier invoice or quote", multiple: true }, { category: "OTHER", multiple: true }]} />
    </>
  );
}

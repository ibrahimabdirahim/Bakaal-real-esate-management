import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { findDiscardedInvoice, getInvoice } from "@/server/services/finance";
import { cents } from "@/server/services/common";
import { BrandLogo } from "@/components/brand";
import { Badge, Card, DescriptionList, Money, Notice, PageHeader, Table, Td } from "@/components/ui";
import { ActionForm, DeleteButton, SubmitButton, TextInput } from "@/components/forms";
import { SelfApprovalForm } from "@/components/self-approval-form";
import { canUseSelfException, SELF_EXCEPTION_MIN_REASON } from "@/server/services/self-approval";
import { AutoPrint, PrintButton } from "@/components/print-button";
import { formatDate, formatDateTime, formatMonth } from "@/lib/dates";
import { CHARGE_CATEGORY_LABELS } from "../../agreements/labels";
import { InvoiceStatusBadge } from "../badges";
import { creditNoteAction, discardDraftAction, issueManualInvoiceAction } from "../actions";
import { FileText } from "lucide-react";

export default async function InvoicePage({ params, searchParams }: PageProps<"/invoices/[id]">) {
  const actor = await requirePage("invoices.view");
  const { id } = await params;
  const data = await getInvoice(actor, id);
  if (!data) {
    // Discarded drafts are removed, but the audit log still links to them: explain, don't 404.
    const discarded = await findDiscardedInvoice(actor, id);
    if (!discarded) notFound();
    return (
      <>
        <PageHeader title="Discarded draft invoice" back={{ href: "/invoices", label: "Invoices" }} />
        <Notice tone="blue">
          {`This draft invoice was discarded on ${formatDateTime(discarded.occurredAt)}${discarded.actorEmail ? ` by ${discarded.actorEmail}` : ""}.`}
          {discarded.reason ? ` Reason: “${discarded.reason}”.` : ""} It was never issued, so it never affected any balance. Its history remains in the audit log.
        </Notice>
      </>
    );
  }
  const { invoice: inv, summary: s, users } = data;
  const isDraft = inv.status === "DRAFT";
  const ownDraft = isDraft && inv.createdById === actor.id;
  const selfIssued = !isDraft && inv.issuedById != null && inv.issuedById === inv.createdById;

  return (
    <>
      <PageHeader icon={FileText}
        title={isDraft ? "Draft invoice (not issued)" : `Invoice ${inv.number}`}
        back={{ href: "/invoices", label: "Invoices" }}
        description={<InvoiceStatusBadge s={s} />}
        actions={!isDraft ? <PrintButton /> : null}
      />
      {!isDraft && (await searchParams).print === "1" && <AutoPrint />}

      {isDraft && (
        <div className="no-print mb-6">
          <Notice>
            This draft does not affect any balance. It must be reviewed and issued by an authorised person other than its creator ({users.get(inv.createdById ?? "") ?? "unknown"}), or by a
            System Administrator who drafted it under the audited self-approval exception.
          </Notice>
        </div>
      )}
      {selfIssued && (
        <div className="no-print mb-6">
          <Notice>{`Drafted and issued by the same person (${users.get(inv.issuedById ?? "") ?? "unknown"}) under the administrator self-approval exception. The reason is in the audit log.`}</Notice>
        </div>
      )}

      <Card>
        <div className="mb-4 flex flex-col justify-between gap-4 sm:flex-row">
          <div>
            <BrandLogo width={110} />
            <p className="text-sm text-slate-600">{inv.building.name}</p>
            {inv.building.address && <p className="text-sm text-slate-600">{inv.building.address}</p>}
          </div>
          <div className="text-sm sm:text-right">
            <p className="font-semibold">Billed to</p>
            <p><Link href={`/accounts/${inv.partyId}`} className="text-primary-600 hover:underline">{inv.party.displayName}</Link></p>
            <p>Unit {inv.unit.unitNumber}</p>
          </div>
        </div>
        <DescriptionList
          items={[
            ["Invoice number", inv.number ?? "Assigned when issued"],
            ["Type", inv.kind === "RECURRING" ? "Monthly billing" : "Manual"],
            ["Billing period", s.periodStart ? formatMonth(s.periodStart) : "—"],
            ["Issue date", formatDate(s.issueDate)],
            ["Due date", formatDate(s.dueDate)],
            ["Grace period", inv.agreement?.graceDays != null ? `${inv.agreement.graceDays} day(s) per agreement` : "Not stated in agreement"],
            ...(inv.notes ? ([["Notes", inv.notes]] as [string, string][]) : []),
          ]}
        />
        <div className="mt-6">
          <Table head={["Category", "Description", "Amount"]}>
            {inv.lines.map((l) => (
              <tr key={l.id}>
                <Td>{CHARGE_CATEGORY_LABELS[l.category]}</Td>
                <Td wrap>{l.description}</Td>
                <Td className="text-right"><Money cents={cents(l.amount)} /></Td>
              </tr>
            ))}
          </Table>
        </div>
        <dl className="mt-4 ml-auto max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><dt>Total</dt><dd><Money cents={s.total} /></dd></div>
          <div className="flex justify-between"><dt>Payments allocated</dt><dd>− <Money cents={s.allocated} /></dd></div>
          <div className="flex justify-between"><dt>Credit notes</dt><dd>− <Money cents={s.credited} /></dd></div>
          <div className="flex justify-between border-t border-slate-200 pt-1 font-bold"><dt>Balance due</dt><dd><Money cents={s.balance} /></dd></div>
        </dl>
      </Card>

      {!isDraft && (
        <Card title="Payments allocated to this invoice" id="payments" className="mt-6 scroll-mt-20">
          <Table head={["Receipt", "Payment reference", "Allocated on", "Amount", "Status"]} empty="No payments allocated yet.">
            {inv.allocations.map((a) => (
              <tr key={a.id} className={a.reversedAt ? "text-slate-400 line-through" : ""}>
                <Td><Link href={`/payments/${a.paymentId}`} className="text-primary-600 hover:underline">{a.payment.receiptNumber ?? "—"}</Link></Td>
                <Td>{a.payment.reference}</Td>
                <Td>{formatDateTime(a.createdAt)}</Td>
                <Td><Money cents={cents(a.amount)} /></Td>
                <Td>{a.reversedAt ? <Badge tone="slate">Reversed</Badge> : <Badge tone="green">Active</Badge>}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {!isDraft && (
        <Card title="Credit notes" id="credit" className="mt-6 scroll-mt-20">
          <Table head={["Number", "Date", "Amount", "Reason", "By"]} empty="No credit notes.">
            {inv.creditNotes.map((c) => (
              <tr key={c.id}>
                <Td>{c.number}</Td>
                <Td>{formatDateTime(c.createdAt)}</Td>
                <Td><Money cents={cents(c.amount)} /></Td>
                <Td wrap>{c.reason}</Td>
                <Td>{users.get(c.createdById) ?? "—"}</Td>
              </tr>
            ))}
          </Table>
          {can(actor.role, "credits.create") && s.balance > 0 && (
            <div className="no-print mt-4 border-t border-slate-200 pt-4">
              <h3 className="mb-2 text-sm font-semibold">Record a credit note</h3>
              <ActionForm action={creditNoteAction.bind(null, inv.id)}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <TextInput label="Amount" name="amount" inputMode="decimal" required hint={`At most the balance due`} />
                  <div className="sm:col-span-2"><TextInput label="Reason" name="reason" required placeholder="e.g. Agreed correction of water charge" /></div>
                </div>
                <SubmitButton confirm="Record this credit note? It cannot be edited afterwards.">Record credit note</SubmitButton>
              </ActionForm>
            </div>
          )}
        </Card>
      )}

      {isDraft && (
        <div className="no-print mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
          {can(actor.role, "invoices.issue_manual") && (
            <Card title="Review and issue" id="issue" className="scroll-mt-20">
              <p className="mb-3 text-sm text-slate-600">Issuing assigns an invoice number and adds it to the account balance. It cannot be edited afterwards.</p>
              {ownDraft && canUseSelfException(actor) ? (
                <div className="space-y-4">
                  <Notice>You drafted this invoice. Normally someone else reviews and issues it. As a System Administrator you may issue it yourself under the audited self-approval exception.</Notice>
                  <SelfApprovalForm
                    action={issueManualInvoiceAction.bind(null, inv.id)}
                    minReason={SELF_EXCEPTION_MIN_REASON}
                    confirmText="I drafted this invoice myself, and I have reviewed every line, amount and date against the agreement."
                    placeholder="e.g. Final settlement checked against the move-out inspection and agreement clause 9; no other reviewer available."
                    buttons={[{ label: "Issue invoice (administrator exception)", name: "selfIssue", variant: "primary", confirm: "Issue your own draft invoice under the administrator self-approval exception? This is recorded in the audit log and cannot be undone." }]}
                  />
                </div>
              ) : ownDraft ? (
                <Notice>You drafted this invoice, so another authorised person must review and issue it.</Notice>
              ) : (
                <ActionForm action={issueManualInvoiceAction.bind(null, inv.id)}>
                  <SubmitButton confirm="Issue this invoice?">Issue invoice</SubmitButton>
                </ActionForm>
              )}
            </Card>
          )}
          {can(actor.role, "invoices.create_manual") && (
            <Card title="Delete draft" id="discard" className="scroll-mt-20">
              <ActionForm action={discardDraftAction.bind(null, inv.id)}>
                <p className="text-sm text-slate-600">A draft was never issued, so it owes nothing and has no payments. Deleting it is recorded in the audit log.</p>
                <DeleteButton what="draft invoice">Delete draft</DeleteButton>
              </ActionForm>
            </Card>
          )}
        </div>
      )}
    </>
  );
}

import Link from "next/link";
import { DocumentsCard } from "../../documents/documents-card";
import { notFound } from "next/navigation";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { getPayment, openInvoicesForParty, SELF_VERIFY_MIN_REASON, selfVerificationEligibility, selfVerificationRecord } from "@/server/services/finance";
import { cents } from "@/server/services/common";
import { Badge, ButtonLink, Card, DescriptionList, Money, Notice, PageHeader, Table, Td } from "@/components/ui";
import { ActionForm, SubmitButton, TextInput } from "@/components/forms";
import { formatDate, formatDateTime, fromDbDate } from "@/lib/dates";

import { METHOD_LABELS } from "../labels";
import { allocateAction, rejectPaymentAction, reversePaymentAction, verifyPaymentAction, verifyPaymentSelfAction } from "../actions";
import { SelfApprovalForm } from "@/components/self-approval-form";
import { StatusBadge } from "@/components/status";
import { ReceiptText, Wallet } from "lucide-react";

export default async function PaymentPage({ params }: PageProps<"/payments/[id]">) {
  const actor = await requirePage("payments.view");
  const { id } = await params;
  const data = await getPayment(actor, id);
  if (!data) notFound();
  const { payment: p, amount, allocated, unallocated, users } = data;
  const name = (uid: string | null) => (uid ? users.get(uid) ?? "—" : "—");
  const open = p.status === "VERIFIED" && unallocated > 0 && can(actor.role, "payments.allocate") ? await openInvoicesForParty(p.partyId) : [];
  const recordedByMe = p.recordedById === actor.id;
  const selfCheck = p.status === "PENDING" && recordedByMe && can(actor.role, "payments.verify") ? await selfVerificationEligibility(actor, p) : null;
  // A verified payment whose verifier is also its recorder was verified under the exception.
  const selfVerified = p.status !== "PENDING" && p.verifiedById != null && p.verifiedById === p.recordedById;
  const selfRecord = selfVerified ? await selfVerificationRecord(actor, p.id) : null;

  return (
    <>
      <PageHeader icon={Wallet}
        title={`Payment ${p.reference}`}
        back={{ href: "/payments", label: "Payments" }}
        description={
          <span className="flex flex-wrap gap-2">
            <StatusBadge kind="payment" status={p.status} />
            {selfVerified && <Badge tone="amber">Self-verified · administrator exception</Badge>}
          </span>
        }
        actions={p.status === "VERIFIED" ? <ButtonLink variant="secondary" href={`/payments/${p.id}/receipt`} icon={ReceiptText}>Receipt</ButtonLink> : null}
      />
      {selfVerified && (
        <div className="mb-6">
          <Notice>
            {`Recorded and verified by the same person (${name(p.recordedById)}) under the administrator self-verification exception${p.verifiedAt ? ` on ${formatDateTime(p.verifiedAt)}` : ""}.`}
            {selfRecord?.reason ? ` Reason: “${selfRecord.reason}”.` : ""}
          </Notice>
        </div>
      )}
      <Card title="Details">
        <DescriptionList
          items={[
            ["Account", <Link key="a" href={`/accounts/${p.partyId}`} className="text-primary-600 hover:underline">{p.party.displayName}</Link>],
            ["Method", METHOD_LABELS[p.method]],
            ["Reference", p.reference],
            ["Amount", <Money key="m" cents={amount} />],
            ["Date received", formatDate(fromDbDate(p.receivedDate))],
            ["Evidence notes", p.evidenceNote],
            ["Recorded by", `${name(p.recordedById)} · ${formatDateTime(p.recordedAt)}`],
            ...(p.verifiedAt ? ([["Verified by", `${name(p.verifiedById)} · ${formatDateTime(p.verifiedAt)}`], ["Receipt number", p.receiptNumber]] as [string, string][]) : []),
            ...(p.rejectedAt ? ([["Rejected by", `${name(p.rejectedById)} · ${formatDateTime(p.rejectedAt)}`], ["Rejection reason", p.rejectionReason]] as [string, string | null][]) : []),
            ...(p.reversedAt ? ([["Reversed by", `${name(p.reversedById)} · ${formatDateTime(p.reversedAt)}`], ["Reversal reason", p.reversalReason]] as [string, string | null][]) : []),
            ...(p.status === "VERIFIED" ? ([["Allocated", <Money key="al" cents={allocated} />], ["Unallocated", <Money key="un" cents={unallocated} />]] as [string, React.ReactNode][]) : []),
          ]}
        />
      </Card>

      {p.status === "PENDING" && can(actor.role, "payments.verify") && (
        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card title="Verify" id="verify" className="scroll-mt-20">
            {recordedByMe ? (
              selfCheck?.eligible ? (
                <div className="space-y-4">
                  <Notice>
                    {`You recorded this payment. Normally someone else verifies it. As a System Administrator you may verify it yourself under the audited self-verification exception. ${selfCheck.why} The payment will be marked as self-verified and your reason kept in the audit log.`}
                  </Notice>
                  <SelfApprovalForm
                    action={verifyPaymentSelfAction.bind(null, p.id)}
                    minReason={SELF_VERIFY_MIN_REASON}
                    confirmText="I recorded this payment myself, and I have personally checked it against the M-Pesa or bank statement or the cash book."
                    placeholder="e.g. Matched M-Pesa code QWE123 for KES 25,000 on the 21 Oct statement; no other verifier on duty."
                    buttons={[{ label: "Verify payment (administrator exception)", name: "selfVerify", confirm: "You recorded this payment and are now verifying it yourself. This uses the administrator self-verification exception and is shown on the payment and in the audit log. Continue?" }]}
                  />
                </div>
              ) : (
                <Notice>{`You recorded this payment, so another authorised person must verify it. ${selfCheck?.why ?? ""}`}</Notice>
              )
            ) : (
              <>
                <p className="mb-3 text-sm text-slate-600">Confirm the money appears on the M-Pesa statement, bank statement or in the cash book with this reference and amount.</p>
                <ActionForm action={verifyPaymentAction.bind(null, p.id)}>
                  <SubmitButton confirm="Confirm you have checked the statement and this payment was received?">Verify and issue receipt</SubmitButton>
                </ActionForm>
              </>
            )}
          </Card>
          <Card title="Reject" id="reject" className="scroll-mt-20">
            <ActionForm action={rejectPaymentAction.bind(null, p.id)}>
              <TextInput label="Reason" name="reason" required placeholder="e.g. Not found on statement" />
              <SubmitButton variant="danger" confirm="Reject this payment?">Reject payment</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      )}
      {p.status === "PENDING" && !can(actor.role, "payments.verify") && (
        <div className="mt-6"><Notice tone="blue">Awaiting verification by finance. Until then it does not reduce any balance.</Notice></div>
      )}

      {p.status === "VERIFIED" && (
        <Card title="Allocations" className="mt-6">
          <Table head={["Invoice", "Unit", "Amount", "When", "By", "Status"]} empty="Not allocated to any invoice yet.">
            {p.allocations.map((a) => (
              <tr key={a.id} className={a.reversedAt ? "text-slate-400 line-through" : ""}>
                <Td><Link href={`/invoices/${a.invoiceId}`} className="text-primary-600 hover:underline">{a.invoice.number}</Link></Td>
                <Td>{a.invoice.unit.unitNumber}</Td>
                <Td><Money cents={cents(a.amount)} /></Td>
                <Td>{formatDateTime(a.createdAt)}</Td>
                <Td>{name(a.createdById)}</Td>
                <Td>{a.reversedAt ? <Badge tone="slate">Reversed</Badge> : <Badge tone="green">Active</Badge>}</Td>
              </tr>
            ))}
          </Table>

          {unallocated > 0 && can(actor.role, "payments.allocate") && (
            <div id="allocate" className="mt-4 scroll-mt-20 border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold">Allocate <Money cents={unallocated} /> to open invoices</h3>
              <p className="mb-3 text-xs text-slate-500">
                Choose amounts per invoice. No automatic order (e.g. oldest first) is applied, because no allocation rule is approved; follow the agreement&apos;s terms.
                Anything left unallocated stays on the payment for review — it is not converted into a credit or refund.
              </p>
              {open.length === 0 ? (
                <Notice>This account has no issued invoice with a balance. The money remains unallocated for review.</Notice>
              ) : (
                <ActionForm action={allocateAction.bind(null, p.id)}>
                  <Table head={["Invoice", "Unit", "Period / issued", "Due", "Balance", "Allocate"]}>
                    {open.map((i) => (
                      <tr key={i.id}>
                        <Td><Link href={`/invoices/${i.id}`} className="text-primary-600 hover:underline">{i.number}</Link></Td>
                        <Td>{i.unit.unitNumber}</Td>
                        <Td>{i.periodStart ? i.periodStart.slice(0, 7) : formatDate(i.issueDate)}</Td>
                        <Td>{formatDate(i.dueDate)}</Td>
                        <Td><Money cents={i.balance} /></Td>
                        <Td>
                          <input type="hidden" name="invoiceId" value={i.id} />
                          <input name="allocate" inputMode="decimal" aria-label={`Amount to allocate to ${i.number}`} className="w-32 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none" placeholder="0.00" />
                        </Td>
                      </tr>
                    ))}
                  </Table>
                  <SubmitButton>Save allocation</SubmitButton>
                </ActionForm>
              )}
            </div>
          )}

          {can(actor.role, "payments.reverse") && (
            <div id="reverse" className="mt-6 scroll-mt-20 border-t border-slate-200 pt-4">
              <h3 className="mb-2 text-sm font-semibold">Reverse payment</h3>
              <p className="mb-3 text-xs text-slate-500">For a payment that bounced or was recorded wrongly after verification. All its allocations are reversed; nothing is deleted.</p>
              <ActionForm action={reversePaymentAction.bind(null, p.id)}>
                <TextInput label="Reason" name="reason" required />
                <SubmitButton variant="danger" confirm="Reverse this payment and all its allocations?">Reverse payment</SubmitButton>
              </ActionForm>
            </div>
          )}
        </Card>
      )}

      <DocumentsCard actor={actor} ownerType="PAYMENT" ownerId={p.id} title="Payment evidence" className="mt-6" slots={[{ category: "PROOF_OF_PAYMENT", label: "Proof of payment", hint: "M-Pesa message screenshot, bank slip or deposit receipt.", multiple: true }, { category: "OTHER", multiple: true }]} />
    </>
  );
}

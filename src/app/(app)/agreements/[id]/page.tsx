import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { getAgreement } from "@/server/services/property";
import { DocumentsCard } from "../../documents/documents-card";
import { cents } from "@/server/services/common";
import { Badge, ButtonLink, Card, DescriptionList, Money, Notice, PageHeader, Table, Td } from "@/components/ui";
import { ActionForm, Select, SubmitButton, TextInput } from "@/components/forms";
import { formatDate, fromDbDate, optionalFromDbDate, todayISO } from "@/lib/dates";
import { AGREEMENT_TYPE_LABELS, CHARGE_CATEGORY_LABELS } from "../labels";
import { addChargeAction, cancelAgreementAction, endAgreementAction, endChargeAction } from "../actions";
import { StatusBadge } from "@/components/status";
import { FileSignature } from "lucide-react";

export default async function AgreementPage({ params }: PageProps<"/agreements/[id]">) {
  const actor = await requirePage("agreements.view");
  const { id } = await params;
  const data = await getAgreement(actor, id);
  if (!data) notFound();
  const { agreement: a, invoices } = data;
  const manage = can(actor.role, "agreements.manage") && a.status === "ACTIVE";
  const today = todayISO();

  return (
    <>
      <PageHeader icon={FileSignature}
        title={`${AGREEMENT_TYPE_LABELS[a.type]} — unit ${a.unit.unitNumber}`}
        back={{ href: `/accounts/${a.partyId}?tab=agreement`, label: a.party.displayName }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="agreement" status={a.status} />
            <Link href={`/accounts/${a.partyId}`} className="text-primary-600 hover:underline">{a.party.displayName}</Link>
          </span>
        }
        actions={
          can(actor.role, "invoices.create_manual") && a.status !== "CANCELLED" ? (
            <ButtonLink variant="secondary" href={`/invoices/new?agreementId=${a.id}`}>{a.status === "ENDED" ? "Prepare final settlement invoice" : "Manual invoice"}</ButtonLink>
          ) : null
        }
      />
      {a.type === "MANAGEMENT" && a.status === "ACTIVE" && a.managementFeeAmount == null && (
        <div className="mb-6">
          <Notice>Needs review: no management fee is recorded, so no management fee is billed. Record the agreed fee when it is confirmed; no fee is assumed.</Notice>
        </div>
      )}

      <Card title="Terms">
        <DescriptionList
          items={[
            ["Unit", <Link key="u" href={`/units/${a.unitId}`} className="text-primary-600 hover:underline">{a.unit.unitNumber}</Link>],
            ["Reference", a.reference],
            ["Start date", formatDate(fromDbDate(a.startDate))],
            ["End date", a.endDate ? formatDate(fromDbDate(a.endDate)) : "Open-ended"],
            ...(a.type === "RENTAL"
              ? ([
                  ["Monthly rent", <Money key="r" cents={cents(a.rentAmount)} />],
                  // An agreed term only (F52): not invoiced, not money received, not in any balance.
                  ["Deposit (agreed)", a.depositAmount == null ? "Not recorded" : <span key="d"><Money cents={cents(a.depositAmount)} /> <span className="text-xs text-muted">· agreed, not invoiced or received</span></span>],
                ] as [string, React.ReactNode][])
              : []),
            ...(a.type === "MANAGEMENT" ? ([["Monthly management fee", <Money key="f" cents={cents(a.managementFeeAmount)} />]] as [string, React.ReactNode][]) : []),
            ...(a.type === "OWNERSHIP"
              ? ([["Rent", "Not applicable (purchased unit)"], ["Purchase date", formatDate(optionalFromDbDate(a.purchaseDate))], ["Ownership evidence", a.ownershipEvidence]] as [string, React.ReactNode][])
              : []),
            ["Due day", a.dueDay ? `Day ${a.dueDay} of each month` : "Not in agreement — approved building policy applies if any, otherwise held for review"],
            ["Grace period", a.graceDays != null ? `${a.graceDays} day(s)` : "Not stated in agreement"],
            ["Late-fee terms (recorded only)", a.lateFeeTerms],
            ["Payment allocation terms (recorded only)", a.allocationTerms],
            ["Notes", a.notes],
            ...(a.endReason ? ([["End / cancellation reason", a.endReason]] as [string, React.ReactNode][]) : []),
          ]}
        />
      </Card>

      <Card title="Approved recurring charges" id="charges" className="mt-6 scroll-mt-20">
        <p className="mb-3 text-sm text-slate-600">Shared and service charges authorised for this agreement. They are billed for whole months they cover; part months are flagged for review.</p>
        <Table head={["Category", "Description", "Amount / month", "From", "To", ...(manage ? [""] : [])]} empty="No recurring charges.">
          {a.charges.map((c) => {
            const open = !c.effectiveTo || fromDbDate(c.effectiveTo) >= today;
            return (
              <tr key={c.id}>
                <Td>{CHARGE_CATEGORY_LABELS[c.category]}</Td>
                <Td wrap>{c.description}</Td>
                <Td><Money cents={cents(c.amount)} /></Td>
                <Td>{formatDate(fromDbDate(c.effectiveFrom))}</Td>
                <Td>{formatDate(optionalFromDbDate(c.effectiveTo))}</Td>
                {manage && (
                  <Td>
                    {open && (
                      <ActionForm action={endChargeAction.bind(null, c.id)} className="flex items-end gap-2">
                        <TextInput label="End on" name="effectiveTo" type="date" required />
                        <SubmitButton variant="secondary">Set end</SubmitButton>
                      </ActionForm>
                    )}
                  </Td>
                )}
              </tr>
            );
          })}
        </Table>
        {manage && (
          <div className="mt-4 border-t border-slate-200 pt-4">
            <h3 className="mb-2 text-sm font-semibold">Add an approved recurring charge</h3>
            <ActionForm action={addChargeAction.bind(null, a.id)}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
                <Select label="Category" name="category" required options={[{ value: "SHARED_CHARGE", label: "Shared charge" }, { value: "SERVICE_CHARGE", label: "Service charge" }, { value: "OTHER", label: "Other" }]} />
                <TextInput label="Description" name="description" required placeholder="e.g. Water, Garbage" />
                <TextInput label="Amount / month" name="amount" inputMode="decimal" required />
                <TextInput label="From" name="effectiveFrom" type="date" required />
                <TextInput label="To (optional)" name="effectiveTo" type="date" />
              </div>
              <SubmitButton>Add charge</SubmitButton>
            </ActionForm>
          </div>
        )}
      </Card>

      {invoices.length > 0 && (
        <Card title="Invoices for this agreement" className="mt-6">
          <Table head={["Invoice", "Kind", "Period", "Status", "Total"]}>
            {invoices.map((i) => (
              <tr key={i.id}>
                <Td><Link href={`/invoices/${i.id}`} className="text-primary-600 hover:underline">{i.number ?? "Draft"}</Link></Td>
                <Td>{i.kind === "RECURRING" ? "Monthly" : "Manual"}</Td>
                <Td>{i.periodStart ? fromDbDate(i.periodStart).slice(0, 7) : "—"}</Td>
                <Td>{i.status === "DRAFT" ? <Badge tone="slate">Draft</Badge> : <Badge tone="blue">Issued</Badge>}</Td>
                <Td><Money cents={cents(i.total)} /></Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {manage && a.status === "ACTIVE" && (
        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card title="End agreement" id="end" className="scroll-mt-20">
            <Notice tone="blue">
              Recurring billing stops after the end date. Earlier invoices and unpaid debts are kept. A part-month is not billed automatically; if a final charge is authorised, prepare a final settlement invoice for review.
            </Notice>
            <ActionForm action={endAgreementAction.bind(null, a.id)} className="mt-3 space-y-4">
              <TextInput label="End date" name="endDate" type="date" required />
              <TextInput label="Reason" name="reason" required placeholder="e.g. Tenant moved out" />
              <SubmitButton variant="danger" confirm="End this agreement?">End agreement</SubmitButton>
            </ActionForm>
          </Card>
          {invoices.length === 0 && (
            <Card title="Cancel (entered in error)" id="cancel" className="scroll-mt-20">
              <p className="text-sm text-slate-600">Only possible while no invoice exists for this agreement. The record is kept, marked cancelled.</p>
              <ActionForm action={cancelAgreementAction.bind(null, a.id)} className="mt-3 space-y-4">
                <TextInput label="Reason" name="reason" required />
                <SubmitButton variant="secondary" confirm="Cancel this agreement?">Cancel agreement</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      )}

      <DocumentsCard
        actor={actor}
        ownerType="AGREEMENT"
        ownerId={a.id}
        title="Agreement documents"
        className="mt-6"
        slots={[{ category: "SIGNED_AGREEMENT", label: "Signed agreement", hint: "The signed agreement as a PDF or a photo of each page.", multiple: true }, { category: "OTHER", multiple: true }]}
      />
    </>
  );
}

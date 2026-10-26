import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { ACCOUNT_TYPE_LABELS, accountTypesOf, archiveBlocker, deleteBlocker, findDeletedParty, getParty } from "@/server/services/property";
import { partyFinancialSummary } from "@/server/services/finance";
import { accountActivity } from "@/server/services/admin";
import { workOrdersForUnits } from "@/server/services/operations";
import { RECORD_LINKS } from "@/server/services/common";
import { DocumentsCard } from "../../documents/documents-card";
import { cents } from "@/server/services/common";
import { Badge, ButtonLink, Card, DescriptionList, Money, Notice, PageHeader, Table, Td } from "@/components/ui";
import { formatDate, formatDateTime, fromDbDate, optionalFromDbDate, todayISO } from "@/lib/dates";
import { sumCents } from "@/lib/money";
import { ArchiveAccountForm, DeleteAccountForm, PartyForm } from "../party-form";
import { archivePartyAction, deletePartyAction, updatePartyAction } from "../actions";
import { AGREEMENT_TYPE_LABELS } from "../../agreements/labels";
import { METHOD_LABELS } from "../../payments/labels";
import { InvoiceStatusBadge } from "../../invoices/badges";
import { StatusBadge } from "@/components/status";
import { RowActions } from "@/components/row-actions";
import { invoiceActions, paymentActions } from "../../finance/record-actions";
import { CheckCircle2, FileSignature, Trash2, Users } from "lucide-react";

export default async function AccountPage({ params, searchParams }: PageProps<"/accounts/[id]">) {
  const actor = await requirePage("accounts.view");
  const { id } = await params;
  const sp = await searchParams;
  const data = await getParty(actor, id);
  if (!data) {
    // Links in the audit log and activity feed outlive a deleted account: explain, don't 404.
    const deleted = await findDeletedParty(actor, id);
    if (!deleted) notFound();
    return (
      <>
        <PageHeader icon={Users} title="Deleted account" back={{ href: "/accounts", label: "Accounts" }} />
        <Notice tone="blue">
          {deleted.summary} on {formatDateTime(deleted.occurredAt)}
          {deleted.actorEmail ? ` by ${deleted.actorEmail}` : ""}. {deleted.reason ? <>Reason: “{deleted.reason}”. </> : null}
          The account no longer exists; its earlier history remains in the audit log.
        </Notice>
      </>
    );
  }
  const { party, canSeeSensitive, linked, archive, deletion } = data;
  const finance = can(actor.role, "invoices.view") ? await partyFinancialSummary(id) : null;
  const archived = party.archivedAt != null;
  const canManage = can(actor.role, "accounts.manage");
  const blocker = archiveBlocker(linked);
  const deleteProblem = deletion ? deleteBlocker(deletion, { archived }) : null;
  const canAgreements = can(actor.role, "agreements.view");
  const active = party.agreements.filter((a) => a.status === "ACTIVE");
  const accountTypes = accountTypesOf(active.map((a) => a.type));
  // Missing agreed terms are flagged, never filled in.
  const feeMissing = active.filter((a) => a.type === "MANAGEMENT" && a.managementFeeAmount == null);
  const tabs = [
    { key: "overview", label: "Overview", show: true },
    { key: "agreement", label: "Agreements", show: canAgreements },
    { key: "documents", label: "Documents", show: true },
    { key: "billing", label: "Invoices & billing", show: !!finance },
    { key: "payments", label: "Payments", show: !!finance },
    { key: "maintenance", label: "Maintenance", show: can(actor.role, "workorders.view") },
    { key: "activity", label: "Activity", show: can(actor.role, "audit.view") },
  ].filter((t) => t.show);
  const tab = tabs.find((t) => t.key === sp.tab)?.key ?? "overview";
  const activity = tab === "activity" ? await accountActivity(actor, party.id) : null;
  const workOrders = tab === "maintenance" ? await workOrdersForUnits(actor, [...new Set(party.agreements.filter((a) => a.status !== "CANCELLED").map((a) => a.unitId))]) : null;
  // Approved recurring charges in force today on each agreement (billed with it, besides rent or fee).
  const today = todayISO();
  const chargesInForce = (a: (typeof party.agreements)[number]) =>
    a.charges.filter((c) => fromDbDate(c.effectiveFrom) <= today && (c.effectiveTo == null || fromDbDate(c.effectiveTo) >= today));

  return (
    <>
      <PageHeader icon={Users}
        title={party.displayName}
        back={{ href: "/accounts", label: "Accounts" }}
        description={
          <span className="flex flex-wrap gap-2">
            {accountTypes.map((t) => (
              <Badge key={t} tone="blue">{ACCOUNT_TYPE_LABELS[t]}</Badge>
            ))}
            {archived && <Badge tone="slate">Archived account</Badge>}
          </span>
        }
        actions={
          <>
            {!archived && can(actor.role, "agreements.manage") && <ButtonLink href={`/agreements/new?partyId=${party.id}`}>New agreement</ButtonLink>}
            {!archived && can(actor.role, "payments.record") && <ButtonLink variant="secondary" href={`/payments/new?partyId=${party.id}`}>Record payment</ButtonLink>}
            {finance && <ButtonLink variant="secondary" href={`/accounts/${party.id}/statement`}>Statement</ButtonLink>}
          </>
        }
      />

      {sp.created === "1" && !archived && (
        <div role="status" className="mb-6 rounded-[var(--radius-card)] border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
          <p className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="size-5 shrink-0" aria-hidden /> Account created successfully
          </p>
          <p className="mt-1 text-sm">“{party.displayName}” has been added to the Accounts register. You are now viewing the new account.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ButtonLink variant="secondary" href={`/accounts/${party.id}`}>View account</ButtonLink>
            <ButtonLink variant="secondary" href="/accounts">Back to Accounts register</ButtonLink>
            {canManage && <ButtonLink variant="secondary" href="/accounts/new">Add another account</ButtonLink>}
          </div>
        </div>
      )}
      {sp.archived === "1" && archived && (
        <div className="mb-6">
          <Notice tone="green">Account archived. It no longer appears in the register and cannot be used for new agreements, invoices or payments. Nothing was deleted.</Notice>
        </div>
      )}
      {archived && (
        <div className="mb-6">
          <Notice tone="blue">
            This account was archived on {formatDateTime(party.archivedAt!)}
            {archive?.actorEmail ? ` by ${archive.actorEmail}` : ""}. {archive?.reason ? <>Reason: “{archive.reason}”. </> : null}
            It is kept for history and cannot be edited or used for new agreements, invoices or payments.
          </Notice>
        </div>
      )}

      <nav aria-label="Account sections" className="no-print -mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.key === "overview" ? `/accounts/${party.id}` : `/accounts/${party.id}?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap ${tab === t.key ? "border-primary-600 text-primary-700" : "border-transparent text-muted hover:border-slate-300 hover:text-ink"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" && feeMissing.length > 0 && (
        <div className="mb-6">
          <Notice>
            Review needed: the management agreement for unit {feeMissing.map((a) => a.unit.unitNumber).join(", ")} has no monthly management fee recorded, so no management
            fee is billed. Confirm the agreed fee terms in the agreement.
          </Notice>
        </div>
      )}
      {tab === "overview" && finance && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card><p className="text-sm text-slate-600">Account balance</p><p className="text-2xl font-bold"><Money cents={finance.accountBalance} /></p><p className="text-xs text-slate-500">Issued invoices − credits − verified payments</p></Card>
          <Card><p className="text-sm text-slate-600">Unpaid invoice balances</p><p className="text-2xl font-bold"><Money cents={finance.invoiceBalances} /></p></Card>
          <Card><p className="text-sm text-slate-600">Unallocated payments</p><p className="text-2xl font-bold"><Money cents={finance.unallocated} /></p><p className="text-xs text-slate-500">Received and verified but not yet applied to an invoice</p></Card>
        </div>
      )}
      {tab === "overview" && finance && finance.unallocated > 0 && (
        <div className="mb-6">
          <Notice>This account has verified money not allocated to any invoice. Treatment of overpayments (credit or refund) is not yet an approved policy, so it stays on the payment for review.</Notice>
        </div>
      )}

      {tab === "overview" && (
      <>
      {canAgreements && (
        <Card
          title={<span className="flex items-center gap-2"><FileSignature className="size-4 text-primary-600" aria-hidden /> Agreements in force</span>}
          actions={<Link href={`/accounts/${party.id}?tab=agreement`} className="text-sm font-medium text-primary-600 hover:underline">{party.agreements.length ? `All agreements (${party.agreements.length})` : "Details"}</Link>}
          className="mb-6"
        >
          {active.length ? (
            <ul className="divide-y divide-line">
              {active.map((a) => (
                <li key={a.id} className="grid grid-cols-2 gap-x-6 gap-y-1 py-3 text-sm first:pt-0 last:pb-0 sm:grid-cols-5">
                  <span className="col-span-2 font-medium text-ink sm:col-span-1">
                    <Link href={`/agreements/${a.id}`} className="text-primary-600 hover:underline">{AGREEMENT_TYPE_LABELS[a.type]}</Link>
                  </span>
                  <span>Unit <Link href={`/units/${a.unitId}`} className="text-primary-600 hover:underline">{a.unit.unitNumber}</Link></span>
                  <span>
                    {a.type === "OWNERSHIP" ? (
                      <span className="text-muted">No rent</span>
                    ) : (
                      <>
                        <Money cents={cents(a.rentAmount) ?? cents(a.managementFeeAmount)} />
                        <span className="text-muted">{a.type === "MANAGEMENT" ? " fee / month" : " rent / month"}</span>
                      </>
                    )}
                  </span>
                  <span className="text-muted">{`${formatDate(fromDbDate(a.startDate))} – ${a.endDate ? formatDate(fromDbDate(a.endDate)) : "open-ended"}`}</span>
                  <span className="text-muted">{a.reference ?? "No reference"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">
              No agreement in force.{" "}
              {!archived && can(actor.role, "agreements.manage") && <Link href={`/agreements/new?partyId=${party.id}`} className="text-primary-600 underline">Create one</Link>}
            </p>
          )}
        </Card>
      )}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Contact details">
          <DescriptionList items={[["Phone", party.phone], ["E-mail", party.email], ["ID / registration", party.idNumber], ["Notes", party.notes]]} />
        </Card>
        {canManage && !archived && (
          <Card id="edit" className="scroll-mt-20" title="Edit account details" description="You are editing this existing account. Saving updates it; it does not create a new account.">
            <PartyForm action={updatePartyAction.bind(null, party.id)} party={party} canEditSensitive={canSeeSensitive} cancelHref={`/accounts/${party.id}`} />
          </Card>
        )}
      </div>

      {canManage && !archived && (
        <Card id="archive" title="Archive account" description="For accounts entered by mistake or as duplicates. Archived accounts are hidden from the register but never deleted." className="mt-6 scroll-mt-20">
          {blocker ? <Notice>{blocker}</Notice> : <ArchiveAccountForm action={archivePartyAction.bind(null, party.id)} name={party.displayName} />}
        </Card>
      )}

      {deletion && (
        <section id="delete-account" className="mt-6 scroll-mt-20 rounded-[var(--radius-card)] border-2 border-red-200 bg-white shadow-[var(--shadow-card)]">
          <div className="border-b border-red-100 bg-red-50/60 px-5 py-3.5">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-red-800">
              <Trash2 className="size-4" aria-hidden /> Delete account permanently
            </h2>
            <p className="mt-0.5 text-xs text-red-900/80">
              Administrators only, for accounts created by mistake that were never used. Deletion cannot be undone.
              {!archived && " To keep the record but take it out of use, archive it instead."}
            </p>
          </div>
          <div className="p-5">
            {deleteProblem ? (
              <Notice>{deleteProblem}</Notice>
            ) : (
              <DeleteAccountForm action={deletePartyAction.bind(null, party.id)} name={party.displayName} />
            )}
          </div>
        </section>
      )}

      </>
      )}

      {tab === "agreement" && (
        <Card
          title="Agreements"
          description="Rental, ownership and management agreements of this account. Each opens with its charges, billing history and the actions your role allows."
          actions={!archived && can(actor.role, "agreements.manage") ? <ButtonLink href={`/agreements/new?partyId=${party.id}`}>New agreement</ButtonLink> : null}
        >
          <Table head={["Unit", "Type", "Reference", "From", "To", "Rent / fee per month", "Approved charges per month", "Deposit (agreed)", "Due day", "Status", ""]} empty="No agreements yet.">
            {party.agreements.map((a) => (
              <tr key={a.id}>
                <Td><Link href={`/units/${a.unitId}`} className="hover:underline">{a.unit.unitNumber}</Link></Td>
                <Td>{AGREEMENT_TYPE_LABELS[a.type]}</Td>
                <Td>{a.reference ?? "—"}</Td>
                <Td>{formatDate(fromDbDate(a.startDate))}</Td>
                <Td>{formatDate(optionalFromDbDate(a.endDate))}</Td>
                <Td><Money cents={cents(a.rentAmount) ?? cents(a.managementFeeAmount)} /></Td>
                <Td wrap>
                  {chargesInForce(a).length === 0 ? (
                    "—"
                  ) : (
                    <span title={chargesInForce(a).map((c) => c.description).join(", ")}>
                      <Money cents={sumCents(chargesInForce(a).map((c) => cents(c.amount)!))} />
                      <span className="block text-xs text-muted">{chargesInForce(a).map((c) => c.description).join(", ")}</span>
                    </span>
                  )}
                </Td>
                <Td>{a.type === "RENTAL" && a.depositAmount != null ? <Money cents={cents(a.depositAmount)} /> : "—"}</Td>
                <Td>{a.dueDay ?? "Policy / review"}</Td>
                <Td><StatusBadge kind="agreement" status={a.status} /></Td>
                <Td><Link href={`/agreements/${a.id}`} className="font-medium text-primary-600 hover:underline">Open</Link></Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {tab === "documents" && (
        <div className="space-y-6">
          <DocumentsCard
            actor={actor}
            ownerType="PARTY"
            ownerId={party.id}
            title="Account documents"
            closed={archived}
            slots={[
              { category: "ID_DOCUMENT", label: "Identification documents", multiple: true },
              { category: "PHOTO", label: "Photographs", multiple: true },
              { category: "OTHER", label: "Other supporting documents", multiple: true },
            ]}
          />
          {canAgreements &&
            party.agreements.map((a) => (
              <DocumentsCard
                key={a.id}
                actor={actor}
                ownerType="AGREEMENT"
                ownerId={a.id}
                title={`${AGREEMENT_TYPE_LABELS[a.type]} — unit ${a.unit.unitNumber}${a.reference ? ` (${a.reference})` : ""}`}
                closed={archived}
                slots={[{ category: "SIGNED_AGREEMENT", label: "Signed agreement", multiple: true }, { category: "OTHER", multiple: true }]}
              />
            ))}
        </div>
      )}

      {tab === "activity" && activity && (
        <Card title="Activity" description="Audit history of this account and its agreements, invoices and payments (newest first).">
          <Table head={["When", "Who", "What", "Record"]} empty="No activity yet.">
            {activity.events.map((e) => (
              <tr key={String(e.id)}>
                <Td className="whitespace-nowrap">{formatDateTime(e.occurredAt)}</Td>
                <Td>{e.actorEmail ?? "system"}</Td>
                <Td wrap>
                  {e.summary}
                  {e.reason && <span className="block text-xs text-slate-500">Reason: {e.reason}</span>}
                </Td>
                <Td>
                  {e.entityId && RECORD_LINKS[e.entityType] && activity.linkable.has(`${e.entityType}:${e.entityId}`) ? (
                    <Link href={activity.linkable.get(`${e.entityType}:${e.entityId}`)!} className="text-primary-600 hover:underline">{e.entityType}</Link>
                  ) : (
                    e.entityType
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {finance && tab === "billing" && (
        <>
          <Card title="Invoices" actions={<ButtonLink variant="secondary" href={`/accounts/${party.id}/statement`}>Statement</ButtonLink>}>
            <Table head={["Invoice", "Unit", "Period / issued", "Due", "Total", "Paid", "Credited", "Balance", "Status", <span key="a" className="sr-only">Actions</span>]} empty="No issued invoices.">
              {finance.invoices.map((i) => (
                <tr key={i.id}>
                  <Td><Link href={`/invoices/${i.id}`} className="text-primary-600 hover:underline">{i.number}</Link></Td>
                  <Td>{i.unit.unitNumber}</Td>
                  <Td>{i.periodStart ? i.periodStart.slice(0, 7) : formatDate(i.issueDate)}</Td>
                  <Td>{formatDate(i.dueDate)}</Td>
                  <Td><Money cents={i.total} /></Td>
                  <Td><Money cents={i.allocated} /></Td>
                  <Td>{i.credited > 0 ? <Money cents={i.credited} /> : "—"}</Td>
                  <Td><Money cents={i.balance} /></Td>
                  <Td><InvoiceStatusBadge s={i} /></Td>
                  <Td className="w-px text-right"><RowActions label={`Actions for ${i.number}`} items={invoiceActions(actor, i)} /></Td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}
      {finance && tab === "payments" && (
        <>
          <Card title="Payments" actions={!archived && can(actor.role, "payments.record") ? <ButtonLink variant="secondary" href={`/payments/new?partyId=${party.id}`}>Record payment</ButtonLink> : null}>
            <Table head={["Received", "Method", "Reference", "Amount", "Allocated", "Unallocated", "Status", <span key="a" className="sr-only">Actions</span>]} empty="No payments recorded.">
              {finance.payments.map((p) => (
                <tr key={p.id}>
                  <Td>{formatDate(fromDbDate(p.receivedDate))}</Td>
                  <Td>{METHOD_LABELS[p.method]}</Td>
                  <Td><Link href={`/payments/${p.id}`} className="text-primary-600 hover:underline">{p.reference}</Link></Td>
                  <Td><Money cents={cents(p.amount)} /></Td>
                  {/* Only verified money is allocated; pending, rejected and reversed payments count for nothing. */}
                  <Td>{p.status === "VERIFIED" ? <Money cents={sumCents(p.allocations.map((x) => cents(x.amount)!))} /> : "—"}</Td>
                  <Td>{p.status === "VERIFIED" ? <Money cents={cents(p.amount)! - sumCents(p.allocations.map((x) => cents(x.amount)!))} /> : "—"}</Td>
                  <Td><StatusBadge kind="payment" status={p.status} /></Td>
                  <Td className="w-px text-right">
                    <RowActions
                      label={`Actions for ${p.reference}`}
                      items={paymentActions(actor, { ...p, unallocated: p.status === "VERIFIED" ? cents(p.amount)! - sumCents(p.allocations.map((x) => cents(x.amount)!)) : 0, invoices: [] })}
                    />
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}
      {workOrders && tab === "maintenance" && (
        <Card title="Maintenance" description="Work orders on the units of this account's agreements, newest first.">
          <Table head={["Work order", "Title", "Unit", "Priority", "Assigned to", "Reported", "Status"]} empty="No work orders on these units.">
            {workOrders.map((w) => (
              <tr key={w.id}>
                <Td><Link href={`/maintenance/${w.id}`} className="font-medium text-primary-600 hover:underline">{w.number}</Link></Td>
                <Td wrap>{w.title}</Td>
                <Td>{w.unit ? `Unit ${w.unit.unitNumber}` : w.location}</Td>
                <Td><StatusBadge kind="priority" status={w.priority} /></Td>
                <Td>{w.assignee ?? "—"}</Td>
                <Td>{formatDateTime(w.createdAt)}</Td>
                <Td><StatusBadge kind="workorder" status={w.status} /></Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}

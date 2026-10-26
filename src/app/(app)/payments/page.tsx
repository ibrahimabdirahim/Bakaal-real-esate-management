import Link from "next/link";
import { FinanceTabs } from "../finance/finance-tabs";
import { Plus, Wallet } from "lucide-react";
import { AccountBanner } from "../finance/account-banner";
import { RowActions } from "@/components/row-actions";
import { paymentActions } from "../finance/record-actions";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { listPayments } from "@/server/services/finance";
import { ButtonLink, Card, FilterBar, FilterInput, FilterPills, FilterSubmit, Money, Notice, PageHeader, Pagination, Table, Td } from "@/components/ui";
import { StatusBadge } from "@/components/status";
import { formatDate, fromDbDate, isISODate } from "@/lib/dates";
import { formatMoney, sumCents } from "@/lib/money";
import { paginate, queryWithoutPage } from "@/lib/paginate";
import { METHOD_LABELS } from "./labels";

export const metadata = { title: "Payments" };


export default async function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  const actor = await requirePage("payments.view");
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "";
  const q = typeof sp.q === "string" ? sp.q : "";
  const from = typeof sp.from === "string" && isISODate(sp.from) ? sp.from : "";
  const to = typeof sp.to === "string" && isISODate(sp.to) ? sp.to : "";
  const partyId = typeof sp.partyId === "string" && sp.partyId ? sp.partyId : undefined;
  const all = await listPayments(actor, { status, partyId, q: q || undefined, from: from || undefined, to: to || undefined });
  const { items: payments, ...pg } = paginate(all, sp.page);
  const verified = all.filter((p) => p.status === "VERIFIED");
  // Status shortcuts with counts (other filters kept), using the payment statuses as they are.
  const everyStatus = await listPayments(actor, { partyId, q: q || undefined, from: from || undefined, to: to || undefined });
  const withStatus = (st: string) => {
    const qs = new URLSearchParams(Object.entries({ partyId: partyId ?? "", status: st, q, from, to }).filter(([, v]) => v));
    return `/payments${qs.size ? `?${qs}` : ""}`;
  };
  const pills = [
    { status: "", label: "All payments" },
    { status: "PENDING", label: "Pending verification" },
    { status: "VERIFIED", label: "Verified" },
    { status: "REJECTED", label: "Rejected" },
    { status: "REVERSED", label: "Reversed" },
  ].map((x) => ({ href: withStatus(x.status), label: x.label, count: x.status ? everyStatus.filter((p) => p.status === x.status).length : everyStatus.length, current: status === x.status }));
  const recorded = typeof sp.recorded === "string" ? everyStatus.find((p) => p.id === sp.recorded) : undefined;
  const canUnits = can(actor.role, "units.view");

  return (
    <>
      <PageHeader
        title="Payments"
        icon={Wallet}
        description="Every payment, one per row, in every status. A payment reduces an invoice's balance by the amount allocated to it; money not yet allocated is shown as unallocated."
        actions={
          <>
            {can(actor.role, "invoices.create_manual") && <ButtonLink variant="secondary" href={partyId ? `/invoices/new?partyId=${partyId}` : "/invoices/new"} icon={Plus}>Create Invoice</ButtonLink>}
            {can(actor.role, "payments.record") && <ButtonLink href={partyId ? `/payments/new?partyId=${partyId}` : "/payments/new"} icon={Plus}>Record Payment</ButtonLink>}
          </>
        }
      />
      <FinanceTabs actor={actor} current="payments" partyId={partyId} />
      {partyId && <AccountBanner actor={actor} partyId={partyId} clearHref="/payments" />}
      {recorded && (
        <div className="mb-4">
          <Notice tone="green">
            {recorded.status === "VERIFIED"
              ? `Payment ${recorded.reference} of ${formatMoney(recorded.amountCents)} from ${recorded.party.displayName} was recorded (receipt ${recorded.receiptNumber}). ${recorded.allocated > 0 ? `${formatMoney(recorded.allocated)} was allocated to invoices` : "Nothing was allocated yet"}${recorded.unallocated > 0 ? `; ${formatMoney(recorded.unallocated)} is unallocated.` : "."}`
              : `Payment ${recorded.reference} of ${formatMoney(recorded.amountCents)} from ${recorded.party.displayName} was recorded. It is pending verification and does not change any balance until it is verified; it can then be allocated to invoices.`}{" "}
            <Link href={`/payments/${recorded.id}`} className="font-medium underline">Open payment</Link>
          </Notice>
        </div>
      )}
      <FilterPills label="Payment status" items={pills} />
      <Card>
        <FilterBar>
          {/* The status is chosen with the buttons above; searching keeps it. */}
          {status && <input type="hidden" name="status" value={status} />}
          {partyId && <input type="hidden" name="partyId" value={partyId} />}
          <FilterInput label="Search" name="q" defaultValue={q} placeholder="Reference, receipt or account" />
          <FilterInput label="Received from" name="from" type="date" defaultValue={from} />
          <FilterInput label="Received to" name="to" type="date" defaultValue={to} />
          <FilterSubmit />
        </FilterBar>
        {verified.length > 0 && (
          <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-3">
            <p>Verified in this list <span className="block font-semibold text-navy-900"><Money cents={sumCents(verified.map((p) => p.amountCents))} /></span></p>
            <p>Allocated to invoices <span className="block font-semibold text-navy-900"><Money cents={sumCents(verified.map((p) => p.allocated))} /></span></p>
            <p>Unallocated (for review) <span className="block font-semibold text-navy-900"><Money cents={sumCents(verified.map((p) => p.unallocated))} /></span></p>
          </div>
        )}
        <Table head={["Date", "Account / unit", "Reference / method / notes", "Amount", "Allocated / unallocated", "Status", "Invoice(s)", <span key="a" className="sr-only">Actions</span>]} empty="No payments match these filters.">
          {payments.map((p) => (
            <tr key={p.id}>
              <Td>{formatDate(fromDbDate(p.receivedDate))}</Td>
              <Td>
                <Link href={`/payments?partyId=${p.partyId}`} className="hover:underline">{p.party.displayName}</Link>
                <span className="block text-xs text-muted">
                  {p.units.length === 0
                    ? "No unit"
                    : p.units.map((u, i) => (
                        <span key={u.id}>
                          {i > 0 ? ", " : "Unit "}
                          {canUnits ? <Link href={`/units/${u.id}`} className="hover:underline">{u.unitNumber}</Link> : u.unitNumber}
                        </span>
                      ))}
                </span>
              </Td>
              <Td>
                <Link href={`/payments/${p.id}`} className="font-medium text-primary-600 hover:underline">{p.reference}</Link>
                <span className="block text-xs text-muted">{[METHOD_LABELS[p.method], p.receiptNumber].filter(Boolean).join(" · ")}</span>
                {p.evidenceNote && <span className="block max-w-56 truncate text-xs text-slate-500 italic" title={p.evidenceNote}>{p.evidenceNote}</span>}
              </Td>
              <Td><Money cents={p.amountCents} /></Td>
              {/* Only verified money is allocated or unallocated; pending, rejected and reversed payments count for nothing. */}
              <Td>
                {p.status === "VERIFIED" ? (
                  <>
                    <Money cents={p.allocated} />
                    <span className={`block text-xs ${p.unallocated > 0 ? "font-medium text-amber-700" : "text-muted"}`}>{`${formatMoney(p.unallocated)} unallocated`}</span>
                  </>
                ) : (
                  "—"
                )}
              </Td>
              <Td>
                <StatusBadge kind="payment" status={p.status} />
                {p.verifiedById != null && p.verifiedById === p.recordedById && <span className="mt-1 block text-[11px] text-slate-500" title="Recorded and verified in one step by the same person">One step</span>}
              </Td>
              <Td>{p.invoices.length ? p.invoices.map((inv) => <span key={inv.id} className="block"><Link href={`/invoices/${inv.id}`} className="hover:underline">{inv.number}</Link></span>) : "—"}</Td>
              <Td className="w-px text-right"><RowActions label={`Actions for ${p.reference}`} items={paymentActions(actor, p)} /></Td>
            </tr>
          ))}
        </Table>
        <Pagination {...pg} path="/payments" query={queryWithoutPage(sp)} />
      </Card>
    </>
  );
}

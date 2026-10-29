import Link from "next/link";
import { BillingSections, FinanceTabs } from "../finance/finance-tabs";
import { Bell, FileText, Plus, Receipt, Scale, Users, Wallet } from "lucide-react";
import { AccountBanner } from "../finance/account-banner";
import { RowActions, type RowAction } from "@/components/row-actions";
import { invoiceActions } from "../finance/record-actions";
import { Suspense } from "react";
import { requirePage } from "@/server/auth/session";
import { PageSkeleton } from "@/components/page-skeleton";
import { can } from "@/server/auth/permissions";
import type { Actor } from "@/server/auth/actor";
import { billingSummary, INVOICE_SORTS, listCreditNotes, listInvoices, type InvoiceFilter, type InvoiceListFilter, type InvoiceSort } from "@/server/services/finance";
import { ButtonLink, Card, Notice, FilterBar, FilterInput, FilterSelect, FilterSubmit, Money, PageHeader, Pagination, Stat, Table, Td } from "@/components/ui";
import { addMonths, formatDate, formatMonth, isISODate, monthEnd, monthStart, todayISO } from "@/lib/dates";
import { formatMoney, sumCents, tryCents } from "@/lib/money";
import { paginate, queryWithoutPage } from "@/lib/paginate";
import { CHARGE_CATEGORY_LABELS } from "../agreements/labels";
import { InvoiceStatusBadge } from "./badges";

export const metadata = { title: "Billing & Payments" };

const FILTERS = [
  { value: "", label: "All" },
  { value: "OPEN", label: "Open balance" },
  { value: "UNPAID", label: "Unpaid" },
  { value: "PART_PAID", label: "Part-paid" },
  { value: "PAST_DUE", label: "Past due date" },
  { value: "PAID", label: "Paid" },
  { value: "DRAFT", label: "Drafts (not issued)" },
];

/** Account types as the Add Account form names them (from the invoice's agreement). */
const ACCOUNT_TYPE = { RENTAL: "Rent-paying tenant", OWNERSHIP: "Purchased unit owner", MANAGEMENT: "Managed by BAKAAL" } as const;
const ACCOUNT_TYPE_FILTER = [{ value: "", label: "All account types" }, ...Object.entries(ACCOUNT_TYPE).map(([value, label]) => ({ value, label })), { value: "NONE", label: "No agreement (manual)" }];
const CHARGE_FILTER = [{ value: "", label: "All charge types" }, ...Object.entries(CHARGE_CATEGORY_LABELS).map(([value, label]) => ({ value, label }))];
const FILTER_KEYS = ["status", "q", "unitId", "type", "charge", "dueFrom", "dueTo", "minOwed", "from", "to", "partyId", "sort"];

/**
 * The More actions menu (F65). Generating opens the billing page with that charge type chosen: a
 * preview comes first and nothing is issued until it is confirmed there.
 */
function moreActions(actor: Actor, month: string, periodQuery: string): RowAction[] {
  const items: RowAction[] = [];
  if (can(actor.role, "billing.preview")) {
    const gen = (label: string, type: string) => items.push({ label, href: `/billing?month=${month}&types=${type}` });
    gen("Generate Rent Invoices", "RENT");
    gen("Generate Service Charge Invoices", "SERVICE_CHARGE");
    gen("Generate Shared Charge Invoices", "SHARED_CHARGE");
    gen("Generate Management Fee Invoices", "MANAGEMENT_FEE");
    items.push({ label: "Generate Recurring Bills (all charge types)", href: `/billing?month=${month}` });
    items.push({ label: "Bulk Create Invoices (choose accounts)", href: `/billing?month=${month}&choose=1` });
  }
  if (can(actor.role, "notices.view")) items.push({ label: "Prepare Invoice Reminders", href: "/notices" });
  items.push({ label: "Export Billing Report (CSV)", href: `/api/billing-report?download=1${periodQuery ? `&${periodQuery}` : ""}` });
  return items;
}

/** The permission check runs first (a refused visitor is still redirected); the lists then stream in. */
export default async function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  const actor = await requirePage("invoices.view");
  const sp = await searchParams;
  return (
    <Suspense fallback={<PageSkeleton title="Billing & Payments" />}>
      <Invoices actor={actor} sp={sp} />
    </Suspense>
  );
}

async function Invoices({ actor, sp }: { actor: Actor; sp: Record<string, string | string[] | undefined> }) {
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const today = todayISO();
  const current = monthStart(today);
  const months = Array.from({ length: 24 }, (_, i) => addMonths(current, -i));
  // Billing period: the chosen month, or "all". Opened with no filters it is the current month; a link with
  // its own filters (e.g. "Outstanding" → status=OPEN) keeps showing every period unless one is chosen.
  const filtered = FILTER_KEYS.some((k) => str(k));
  const periodParam = str("period");
  const period = /^\d{4}-\d{2}-01$/.test(periodParam) && months.includes(periodParam) ? periodParam : periodParam === "all" || filtered ? "" : current;
  const explicitFrom = isISODate(str("from")) ? str("from") : "";
  const explicitTo = isISODate(str("to")) ? str("to") : "";
  const from = explicitFrom || (period ? period : "");
  const to = explicitTo || (period ? monthEnd(period) : "");
  const periodLabel = explicitFrom || explicitTo ? `${formatDate(from || null)} – ${formatDate(to || null)}` : period ? formatMonth(period) : "All periods";

  const status = str("status") as InvoiceFilter;
  const q = str("q");
  const sort = (str("sort") in INVOICE_SORTS ? str("sort") : "newest") as InvoiceSort;
  const minOwedCents = str("minOwed") ? tryCents(str("minOwed")) : null;
  const filter: InvoiceListFilter = {
    status,
    q: q || undefined,
    partyId: str("partyId") || undefined,
    from: from || undefined,
    to: to || undefined,
    unitId: str("unitId") || undefined,
    agreementType: (["RENTAL", "OWNERSHIP", "MANAGEMENT", "NONE"] as const).find((t) => t === str("type")),
    category: (Object.keys(CHARGE_CATEGORY_LABELS) as (keyof typeof CHARGE_CATEGORY_LABELS)[]).find((c) => c === str("charge")),
    dueFrom: isISODate(str("dueFrom")) ? str("dueFrom") : undefined,
    dueTo: isISODate(str("dueTo")) ? str("dueTo") : undefined,
    minBalance: minOwedCents ?? undefined,
    sort,
  };
  // "Credit notes" view: the existing credit notes, each linked to its invoice (no separate records).
  const creditView = sp.view === "credit-notes";
  // Opened for one account (e.g. from its outstanding balance in the account register).
  const partyId = filter.partyId;
  const [all, notes, summary] = await Promise.all([
    creditView ? Promise.resolve([]) : listInvoices(actor, filter),
    creditView ? listCreditNotes(actor, { q: q || undefined, from: from || undefined, to: to || undefined }) : Promise.resolve([]),
    billingSummary(actor, from && to ? { from, to } : null),
  ]);
  const { items: invoices, ...pg } = paginate(all, sp.page);
  const canUnits = can(actor.role, "units.view");
  const periodQuery = from && to ? `from=${from}&to=${to}` : "";
  const billMonth = period || current;
  const keep = (extra: Record<string, string>) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries({ ...queryWithoutPage(sp), ...extra }).filter(([, v]) => v)));
    return `/invoices${qs.size ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Billing & Payments"
        icon={FileText}
        description="Invoices for every account, what has been paid or credited, and what is still owed. Issued invoices are never edited: corrections use credit notes."
        actions={
          <>
            {can(actor.role, "notices.view") && <ButtonLink variant="secondary" href="/notices" icon={Bell}>Reminders</ButtonLink>}
            {can(actor.role, "payments.record") && <ButtonLink variant="secondary" href={partyId ? `/payments/new?partyId=${partyId}` : "/payments/new"} icon={Wallet}>Record Payment</ButtonLink>}
            {can(actor.role, "invoices.create_manual") && <ButtonLink href={partyId ? `/invoices/new?partyId=${partyId}` : "/invoices/new"} icon={Plus}>Create Invoice</ButtonLink>}
            <RowActions label="More billing actions" buttonLabel="More actions" prominent items={moreActions(actor, billMonth, periodQuery)} />
          </>
        }
      />
      <FinanceTabs actor={actor} current="billing" partyId={partyId} />
      {partyId && <AccountBanner actor={actor} partyId={partyId} clearHref="/invoices" />}
      {sp.discarded === "1" && <div className="mb-4"><Notice tone="green">The draft invoice was deleted. The deletion is recorded in the audit log.</Notice></div>}

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <form method="get" action="/invoices" className="flex flex-wrap items-end gap-2" aria-label="Billing period">
          {creditView && <input type="hidden" name="view" value="credit-notes" />}
          {partyId && <input type="hidden" name="partyId" value={partyId} />}
          <FilterSelect
            label="Billing period"
            name="period"
            defaultValue={explicitFrom || explicitTo ? "" : period || "all"}
            options={[...(explicitFrom || explicitTo ? [{ value: "", label: periodLabel }] : []), { value: "all", label: "All periods" }, ...months.map((m) => ({ value: m, label: formatMonth(m) }))]}
          />
          <FilterSubmit />
        </form>
        <p className="text-xs text-muted">{`Showing ${periodLabel}${period === current && !explicitFrom ? " (the current billing month)" : ""}. Months follow Nairobi time.`}</p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-billing-summary>
        <Stat label="Total tenants" value={String(summary.tenants)} icon={Users} tone="blue" href="/accounts" hint={summary.otherAccounts ? `+ ${summary.otherAccounts} owner account(s)` : "With an agreement in force today"} />
        <Stat label={`Total billed · ${periodLabel}`} value={formatMoney(summary.billed)} icon={Receipt} tone="amber" href={keep({ status: "" })} hint={`${summary.invoiceCount} issued invoice(s)`} />
        <Stat
          label={`Paid / credited · ${periodLabel}`}
          value={formatMoney(summary.paid + summary.credited)}
          icon={Wallet}
          tone="green"
          hint={`Paid ${formatMoney(summary.paid)} · credited ${formatMoney(summary.credited)}`}
        />
        <Stat
          label="Outstanding balance · all periods"
          value={formatMoney(summary.outstanding)}
          icon={Scale}
          tone="red"
          href="/invoices?status=OPEN&period=all"
          hint={`${formatMoney(summary.pastDue)} past due · ${summary.openInvoices} invoice(s)`}
        />
      </div>
      <p className="-mt-3 mb-6 text-xs text-muted">
        {`Tenants: rent-paying accounts with an agreement in force today, each counted once. Billed and paid / credited: the issued invoices of ${periodLabel} (drafts excluded); paid means payments allocated to those invoices${summary.unallocated ? `, so ${formatMoney(summary.unallocated)} received but not yet allocated is not counted` : ""}. Outstanding: every issued invoice still owed today, whatever its period${period || explicitFrom ? `; ${formatMoney(summary.periodOutstanding)} of it is from ${periodLabel}` : ""}.`}
      </p>

      <BillingSections actor={actor} current={creditView ? "credit-notes" : "invoices"} />
      {creditView ? (
        <Card>
          <FilterBar>
            <input type="hidden" name="view" value="credit-notes" />
            <FilterInput label="Search" name="q" defaultValue={q} placeholder="Credit note, invoice, account, unit or reason" />
            <FilterInput label="Issued from" name="from" type="date" defaultValue={from} />
            <FilterInput label="Issued to" name="to" type="date" defaultValue={to} />
            <FilterSubmit />
          </FilterBar>
          {notes.length > 0 && (
            <p className="mb-4 rounded-lg bg-slate-50 p-3 text-sm">
              Total credited <span className="block font-semibold text-navy-900"><Money cents={sumCents(notes.map((n) => n.amount))} /></span>
              <span className="text-xs text-muted">Credit notes reduce what is owed on their invoice. No money is paid out.</span>
            </p>
          )}
          <Table head={["Credit note", "Issued", "Invoice", "Account", "Unit", "Reason", "By", "Amount", <span key="a" className="sr-only">Actions</span>]} empty="No credit notes match these filters.">
            {notes.map((n) => (
              <tr key={n.id}>
                <Td>{n.number}</Td>
                <Td>{formatDate(n.date)}</Td>
                <Td><Link href={`/invoices/${n.invoice.id}`} className="font-medium text-primary-600 hover:underline">{n.invoice.number}</Link></Td>
                <Td><Link href={`/accounts/${n.party.id}`} className="hover:underline">{n.party.displayName}</Link></Td>
                <Td>{n.unitNumber}</Td>
                <Td wrap>{n.reason}</Td>
                <Td>{n.createdBy}</Td>
                <Td><Money cents={n.amount} /></Td>
                <Td className="w-px text-right">
                  <RowActions
                    label={`Actions for ${n.number}`}
                    items={[
                      { label: `View invoice ${n.invoice.number}`, href: `/invoices/${n.invoice.id}` },
                      { label: "View account", href: `/invoices?partyId=${n.party.id}` },
                      { label: "Edit or delete", unavailable: "Credit notes are fixed once recorded (database rule). Correct a mistake with a further invoice or credit note." },
                    ]}
                  />
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : (
      <Card>
        <FilterBar>
          {partyId && <input type="hidden" name="partyId" value={partyId} />}
          <input type="hidden" name="period" value={explicitFrom || explicitTo ? "" : period || "all"} />
          {explicitFrom && <input type="hidden" name="from" value={explicitFrom} />}
          {explicitTo && <input type="hidden" name="to" value={explicitTo} />}
          <FilterInput label="Invoice no., account or unit" name="q" defaultValue={q} placeholder="e.g. INV-2026-000012" />
          <FilterSelect label="Status" name="status" defaultValue={status} options={FILTERS} />
          <FilterSelect label="Unit" name="unitId" defaultValue={str("unitId")} options={[{ value: "", label: "All units" }, ...summary.units.map((u) => ({ value: u.id, label: `Unit ${u.unitNumber}` }))]} />
          <FilterSelect label="Account type" name="type" defaultValue={str("type")} options={ACCOUNT_TYPE_FILTER} />
          <FilterSelect label="Charge type" name="charge" defaultValue={str("charge")} options={CHARGE_FILTER} />
          <FilterInput label="Due from" name="dueFrom" type="date" defaultValue={str("dueFrom")} />
          <FilterInput label="Due to" name="dueTo" type="date" defaultValue={str("dueTo")} />
          <FilterInput label="Outstanding at least (KES)" name="minOwed" inputMode="decimal" defaultValue={str("minOwed")} placeholder="e.g. 1,000" />
          <FilterSelect label="Sort by" name="sort" defaultValue={sort} options={Object.entries(INVOICE_SORTS).map(([value, label]) => ({ value, label }))} />
          <FilterSubmit />
          <Link href={partyId ? `/invoices?partyId=${partyId}&period=all` : "/invoices?period=all"} className="self-end pb-2 text-sm text-primary-600 hover:underline">Clear filters</Link>
        </FilterBar>
        {str("minOwed") && minOwedCents == null && <div className="mb-4"><Notice tone="red">“Outstanding at least” must be an amount in KES, e.g. 1,000 or 1000.50. That filter was not applied.</Notice></div>}
        <Table head={["Invoice", "Account", "Unit", "Charges", "Billing period", "Invoice date", "Due date", "Amount", "Paid", "Credits", "Outstanding", "Status", <span key="a" className="sr-only">Actions</span>]} empty={all.length === 0 && !filtered && period ? `No invoices for ${periodLabel} yet. Use More actions → Generate Recurring Bills to preview this month's billing.` : "No invoices match these filters."}>
          {invoices.map((i) => (
            <tr key={i.id}>
              <Td><Link href={`/invoices/${i.id}`} className="font-medium whitespace-nowrap text-primary-600 hover:underline">{i.number ?? "Draft"}</Link></Td>
              <Td>
                <Link href={`/invoices?partyId=${i.party.id}&period=all`} className="hover:underline">{i.party.displayName}</Link>
                <span className="block text-xs text-muted">{i.agreementId ? <Link href={`/agreements/${i.agreementId}`} className="hover:underline">{ACCOUNT_TYPE[i.agreementType!]}</Link> : "No agreement"}</span>
              </Td>
              <Td>{canUnits ? <Link href={`/units/${i.unit.id}`} className="hover:underline">{i.unit.unitNumber}</Link> : i.unit.unitNumber}</Td>
              <Td wrap>{i.chargeTypes.length ? i.chargeTypes.map((c) => CHARGE_CATEGORY_LABELS[c]).join(", ") : "—"}</Td>
              <Td>{i.periodStart ? formatMonth(i.periodStart) : "Manual"}</Td>
              <Td>{i.issueDate ? formatDate(i.issueDate) : <span className="text-slate-500">Not issued</span>}</Td>
              <Td>{formatDate(i.dueDate)}</Td>
              <Td><Money cents={i.total} /></Td>
              <Td>{i.status === "ISSUED" ? <Money cents={i.allocated} /> : "—"}</Td>
              <Td>{i.credited > 0 ? <Money cents={i.credited} /> : "—"}</Td>
              <Td className="font-medium text-navy-900"><Money cents={i.balance} /></Td>
              <Td><InvoiceStatusBadge s={i} /></Td>
              <Td className="w-px text-right"><RowActions label={`Actions for ${i.number ?? "draft invoice"}`} items={invoiceActions(actor, i)} /></Td>
            </tr>
          ))}
        </Table>
        {all.length > 0 && (
          <p className="mt-3 text-xs text-muted">{`${all.length} invoice(s) listed · amount ${formatMoney(sumCents(all.map((i) => i.total)))} · still owed ${formatMoney(sumCents(all.filter((i) => i.status === "ISSUED").map((i) => i.balance)))}`}</p>
        )}
        <Pagination {...pg} path="/invoices" query={queryWithoutPage(sp)} />
      </Card>
      )}
    </>
  );
}

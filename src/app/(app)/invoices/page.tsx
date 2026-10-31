import Link from "next/link";
import { BillingSections, FinanceTabs } from "../finance/finance-tabs";
import { CalendarDays, ChevronDown, Plus, Receipt, Scale, Search, Users, Wallet } from "lucide-react";
import { AccountBanner } from "../finance/account-banner";
import { RowActions, type RowAction } from "@/components/row-actions";
import { invoiceActions } from "../finance/record-actions";
import { Suspense } from "react";
import { requirePage } from "@/server/auth/session";
import { PageSkeleton } from "@/components/page-skeleton";
import { can } from "@/server/auth/permissions";
import type { Actor } from "@/server/auth/actor";
import { billingSummary, INVOICE_SORTS, listCreditNotes, listInvoices, type InvoiceFilter, type InvoiceListFilter, type InvoiceSort } from "@/server/services/finance";
import { ButtonLink, Card, Notice, FilterBar, FilterInput, FilterSubmit, Money, PageHeader, Table, Td } from "@/components/ui";
import { addMonths, formatDate, formatMonth, isISODate, monthEnd, monthStart, todayISO } from "@/lib/dates";
import { formatMoney, sumCents, tryCents } from "@/lib/money";
import { paginate, queryWithoutPage } from "@/lib/paginate";
import { CHARGE_CATEGORY_LABELS } from "../agreements/labels";
import { InvoiceListStatus } from "./badges";
import { Amount, ClearLink, control, Field, InvoicePager, NoInvoices, SummaryCard } from "./billing-ui";

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
  if (can(actor.role, "billing.preview")) items.push({ label: "View Billing Runs", href: "/billing" });
  items.push({ label: "View Credit Notes", href: "/invoices?view=credit-notes" });
  if (can(actor.role, "notices.view")) items.push({ label: "Notices & Arrears / Prepare Reminders", href: "/notices" });
  items.push({ label: "Export Billing Report (CSV)", href: `/api/billing-report?download=1${periodQuery ? `&${periodQuery}` : ""}` });
  return items;
}

const PAGE_SIZE = 25;
const INVOICE_COLUMNS = ["Invoice", "Account / Unit", "Billing Period", "Due Date", "Amount (KES)", "Paid (KES)", "Outstanding (KES)", "Status", "Actions"];
/** Compact cells, centred vertically (the account cell has two lines). */
const cell = "align-middle! px-2!";
/** "Oct 2026": the billing month, short enough for the list. */
const shortMonth = (m: string) => `${formatMonth(m).slice(0, 3)} ${m.slice(0, 4)}`;

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
  const { items: invoices, ...pg } = paginate(all, sp.page, PAGE_SIZE);
  // How many secondary (Advanced) filters differ from their defaults.
  const advanced = [str("charge"), str("minOwed"), sort !== "newest", periodParam || explicitFrom || explicitTo].filter(Boolean).length;
  const canUnits = can(actor.role, "units.view");
  const periodQuery = from && to ? `from=${from}&to=${to}` : "";
  const billMonth = period || current;
  const createHref = can(actor.role, "invoices.create_manual") ? (partyId ? `/invoices/new?partyId=${partyId}` : "/invoices/new") : null;
  const keep = (extra: Record<string, string>) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries({ ...queryWithoutPage(sp), ...extra }).filter(([, v]) => v)));
    return `/invoices${qs.size ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Billing & Payments"
        description="Manage invoices, payments, outstanding balances and billing activities."
        actions={
          <>
            {createHref && <ButtonLink href={createHref} icon={Plus}>Create Invoice</ButtonLink>}
            {can(actor.role, "payments.record") && <ButtonLink variant="secondary" href={partyId ? `/payments/new?partyId=${partyId}` : "/payments/new"} icon={Wallet}>Record Payment</ButtonLink>}
            <RowActions label="More billing actions" buttonLabel="More actions" prominent items={moreActions(actor, billMonth, periodQuery)} />
          </>
        }
      />
      {partyId && <AccountBanner actor={actor} partyId={partyId} clearHref="/invoices" />}
      {sp.discarded === "1" && <div className="mb-4"><Notice tone="green">The draft invoice was deleted. The deletion is recorded in the audit log.</Notice></div>}

      {/* Four across when the content area is wide enough (≥ 64rem), two otherwise: sized by the content, not the window. */}
      <div className="@container">
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 @5xl:grid-cols-4" data-billing-summary>
          <SummaryCard label="Total tenants" value={String(summary.tenants)} icon={Users} tone="blue" href="/accounts" hint={summary.otherAccounts ? `With an agreement in force today · + ${summary.otherAccounts} owner account(s)` : "With an agreement in force today"} />
          <SummaryCard label={`Total billed · ${periodLabel}`} value={formatMoney(summary.billed)} icon={Receipt} tone="amber" href={keep({ status: "" })} hint={`${summary.invoiceCount} issued invoice(s)`} />
          <SummaryCard label={`Paid / credited · ${periodLabel}`} value={formatMoney(summary.paid + summary.credited)} icon={Wallet} tone="green" hint={`Paid ${formatMoney(summary.paid)} · Credited ${formatMoney(summary.credited)}`} />
          <SummaryCard label="Outstanding balance" value={formatMoney(summary.outstanding)} icon={Scale} tone="red" href="/invoices?status=OPEN&period=all" hint={`${formatMoney(summary.pastDue)} past due · ${summary.openInvoices} invoice(s)`} />
        </div>
      </div>

      <FinanceTabs actor={actor} current="billing" partyId={partyId} />
      {creditView && <BillingSections actor={actor} current="credit-notes" />}
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
        <form method="get" action="/invoices" className="no-print mb-5" aria-label="Filter invoices">
          {partyId && <input type="hidden" name="partyId" value={partyId} />}
          {explicitFrom && <input type="hidden" name="from" value={explicitFrom} />}
          {explicitTo && <input type="hidden" name="to" value={explicitTo} />}
          <div className="flex flex-wrap items-end gap-3">
            <label className="relative block w-full sm:w-auto sm:min-w-48 sm:flex-[2]">
              <span className="sr-only">Search invoice, tenant or unit</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input name="q" defaultValue={q} placeholder="Search invoice, tenant or unit…" className={`${control} pl-9`} />
            </label>
            <Field label="Status" className="min-w-32 flex-1"><select name="status" defaultValue={status} className={control}>{FILTERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
            <Field label="Unit" className="min-w-32 flex-1"><select name="unitId" defaultValue={str("unitId")} className={control}><option value="">All units</option>{summary.units.map((u) => <option key={u.id} value={u.id}>{`Unit ${u.unitNumber}`}</option>)}</select></Field>
            <Field label="Account type" className="min-w-36 flex-1"><select name="type" defaultValue={str("type")} className={control}>{ACCOUNT_TYPE_FILTER.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
            <fieldset className="w-full min-w-0 sm:w-auto sm:min-w-72 sm:flex-[1.6]">
              <legend className="mb-1 block text-xs font-medium text-slate-600">Due date</legend>
              <div className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 shadow-sm focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500">
                <CalendarDays className="size-4 shrink-0 text-slate-400" aria-hidden />
                <label className="min-w-0 flex-1"><span className="sr-only">Due from</span><input type="date" name="dueFrom" defaultValue={str("dueFrom")} className="w-full min-w-0 border-0 bg-transparent px-1 py-2 text-sm focus:ring-0 focus:outline-none" /></label>
                <span className="text-slate-400" aria-hidden>–</span>
                <label className="min-w-0 flex-1"><span className="sr-only">Due to</span><input type="date" name="dueTo" defaultValue={str("dueTo")} className="w-full min-w-0 border-0 bg-transparent px-1 py-2 text-sm focus:ring-0 focus:outline-none" /></label>
              </div>
            </fieldset>
          </div>
          {/* Secondary filters. Their controls stay in the form while closed, so what is chosen is kept. */}
          <div className="relative mt-3">
            <details className="group">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-lg py-2 pr-2 text-sm font-medium text-ink hover:text-primary-700 [&::-webkit-details-marker]:hidden">
                <ChevronDown className="size-4 transition group-open:rotate-180" aria-hidden /> Advanced filters
                {advanced > 0 && <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-700">{`${advanced} active`}</span>}
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-3 rounded-lg border border-line bg-surface/60 p-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Charge type"><select name="charge" defaultValue={str("charge")} className={control}>{CHARGE_FILTER.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
                <Field label="Billing period">
                  <select name="period" defaultValue={explicitFrom || explicitTo ? "" : period || "all"} className={control}>
                    {(explicitFrom || explicitTo) && <option value="">{periodLabel}</option>}
                    <option value="all">All periods</option>
                    {months.map((m) => <option key={m} value={m}>{formatMonth(m)}</option>)}
                  </select>
                </Field>
                <Field label="Outstanding at least (KES)"><input name="minOwed" inputMode="decimal" defaultValue={str("minOwed")} placeholder="e.g. 1,000" className={control} /></Field>
                <Field label="Sort by"><select name="sort" defaultValue={sort} className={control}>{Object.entries(INVOICE_SORTS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
              </div>
            </details>
            <div className="mt-3 flex items-center gap-3 sm:absolute sm:top-0 sm:right-0 sm:mt-0">
              <button type="submit" className="rounded-lg bg-primary-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700">Apply</button>
              <ClearLink href={partyId ? `/invoices?partyId=${partyId}&period=all` : "/invoices?period=all"} />
            </div>
          </div>
        </form>
        {str("minOwed") && minOwedCents == null && <div className="mb-4"><Notice tone="red">“Outstanding at least” must be an amount in KES, e.g. 1,000 or 1000.50. That filter was not applied.</Notice></div>}
        <Table dense head={INVOICE_COLUMNS} alignRight={[4, 5, 6]} emptyContent={<NoInvoices createHref={createHref} filtered={filtered} />}>
          {invoices.map((i) => (
            <tr key={i.id}>
              <Td className={cell}><Link href={`/invoices/${i.id}`} className="font-medium whitespace-nowrap text-primary-600 hover:underline">{i.number ?? "Draft"}</Link></Td>
              <Td className={`${cell} sm:min-w-32 sm:whitespace-normal!`}>
                <Link href={`/invoices?partyId=${i.party.id}&period=all`} className="font-medium text-ink hover:underline">{i.party.displayName}</Link>
                <span className="block text-xs text-muted">{canUnits ? <Link href={`/units/${i.unit.id}`} className="hover:underline">{`Unit ${i.unit.unitNumber}`}</Link> : `Unit ${i.unit.unitNumber}`}</span>
              </Td>
              <Td className={cell}>{i.periodStart ? shortMonth(i.periodStart) : "Manual"}</Td>
              <Td className={cell}>{formatDate(i.dueDate)}</Td>
              <Td className={`${cell} text-right`}><Amount cents={i.total} /></Td>
              <Td className={`${cell} text-right`}>{i.status === "ISSUED" ? <Amount cents={i.allocated} /> : "—"}</Td>
              <Td className={`${cell} text-right font-medium text-navy-900`}><Amount cents={i.balance} /></Td>
              <Td className={cell}><InvoiceListStatus s={i} /></Td>
              <Td className={`${cell} w-px text-right`}><RowActions dots label={`Actions for ${i.number ?? "draft invoice"}`} items={invoiceActions(actor, i)} /></Td>
            </tr>
          ))}
        </Table>
        <InvoicePager
          {...pg}
          size={PAGE_SIZE}
          shown={invoices.length}
          query={queryWithoutPage(sp)}
          note={`amount ${formatMoney(sumCents(all.map((i) => i.total)))} · still owed ${formatMoney(sumCents(all.filter((i) => i.status === "ISSUED").map((i) => i.balance)))}`}
        />
      </Card>
      )}
    </>
  );
}

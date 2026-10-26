import Link from "next/link";
import { BookOpen, CalendarClock, Coins, FilePlus2, FileText, Hourglass, Wallet } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { findBuilding } from "@/server/services/common";
import { listPayments } from "@/server/services/finance";
import { dashboard, DASHBOARD_PERIODS, upcomingBilling } from "@/server/services/reports";
import { EARLIEST_DATE, monthLabel, resolveDashboardPeriod } from "@/lib/dashboard-period";
import { DateRangePicker } from "../date-range-picker";
import { Badge, ButtonLink, Card, EmptyState, Money, Notice, PageHeader, Stat, Table, Td } from "@/components/ui";
import { CHART_COLORS, GroupedBarChart, Legend } from "@/components/charts";
import { StatusBadge } from "@/components/status";
import { formatMoney } from "@/lib/money";
import { formatDate, formatMonth, fromDbDate, todayISO } from "@/lib/dates";
import { NoBuilding } from "@/components/no-building";
import { FinanceTabs } from "./finance-tabs";

export const metadata = { title: "Billing & Payments" };

/** Billing & Payments overview: the period's billing and payments, from the same figures as the dashboard and reports. */
export default async function FinanceOverviewPage({ searchParams }: PageProps<"/finance">) {
  const actor = await requirePage("invoices.view");
  if (!(await findBuilding())) return <NoBuilding actor={actor} title="Billing & Payments" />;
  const sp = await searchParams;
  const today = todayISO();
  const p = resolveDashboardPeriod(sp, today);
  const period = p.period;
  const canPayments = can(actor.role, "payments.view");
  const [d, upcoming, recent] = await Promise.all([dashboard(actor, p.period, p.range), upcomingBilling(actor), canPayments ? listPayments(actor).then((p) => p.slice(0, 6)) : Promise.resolve(null)]);
  const m = d.money!;
  const range = `from=${d.from}&to=${d.to}`;
  const canUnits = can(actor.role, "units.view");

  return (
    <>
      <PageHeader
        title="Billing & Payments"
        description={period === "custom" ? `Custom range · ${p.label}` : `${p.label} · ${formatDate(d.from)} – ${formatDate(d.to)}`}
        actions={
          <>
            {can(actor.role, "payments.view") && <ButtonLink variant="secondary" href={`/finance/ledger?${range}`} icon={BookOpen}>Amounts owed ledger</ButtonLink>}
            {can(actor.role, "invoices.create_manual") && <ButtonLink variant="secondary" href="/invoices/new" icon={FilePlus2}>Create invoice</ButtonLink>}
            {can(actor.role, "payments.record") && <ButtonLink href="/payments/new" icon={Wallet}>Record payment</ButtonLink>}
          </>
        }
      />
      <FinanceTabs actor={actor} current="overview" />
      {p.error && (
        <div className="mb-4">
          <Notice tone="red">{`That date range was not used: ${p.error} Showing this month instead.`}</Notice>
        </div>
      )}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <nav aria-label="Period" className="flex flex-wrap gap-1">
          {Object.entries(DASHBOARD_PERIODS).map(([key, label]) => (
            <Link
              key={key}
              href={key === "month" ? "/finance" : `/finance?period=${key}`}
              aria-current={key === period ? "true" : undefined}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${key === period ? "bg-primary-600 text-white" : "bg-white text-muted ring-1 ring-line hover:text-ink"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <DateRangePicker from={d.from} to={d.to} min={EARLIEST_DATE} max={today} action="/finance" error={p.error} entered={p.entered} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Billed" value={formatMoney(m.billed)} icon={CalendarClock} tone="blue" href={`/invoices?${range}`} hint={`Invoices for the period · rent ${formatMoney(m.rentBilled)}`} />
        <Stat
          label="Verified payments"
          value={formatMoney(m.collected)}
          icon={Coins}
          tone="green"
          href={can(actor.role, "reports.financial") ? `/reports/collections?${range}` : `/payments?status=VERIFIED&${range}`}
          hint={m.reversed > 0 ? `Received ${formatMoney(m.received)} less ${formatMoney(m.reversed)} reversed` : "Verified receipts · not a bank balance"}
        />
        <Stat
          label="Pending verification"
          value={formatMoney(d.pendingPaymentsAmount ?? 0)}
          icon={Hourglass}
          tone="amber"
          href="/payments?status=PENDING"
          hint={`${d.pendingPayments ?? 0} payment(s) · not yet counted`}
        />
        <Stat label="Outstanding" value={formatMoney(m.outstanding)} icon={FileText} tone="red" href="/invoices?status=OPEN" hint={`Owed by tenants and owners · ${formatMoney(m.pastDue)} past due`} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card
          className="flex h-full flex-col xl:col-span-2"
          title="Monthly billing vs verified collections (KES)"
          description={`${formatMonth(m.monthly[0].month)} – ${formatMonth(m.monthly.at(-1)!.month)} · billed by billing month; collections by date received, less reversals on their own date`}
          actions={
            <Legend
              items={[
                { label: "Billed", color: CHART_COLORS.billed },
                { label: "Collected", color: CHART_COLORS.collections },
              ]}
            />
          }
        >
          <GroupedBarChart
            title="Monthly amounts billed and verified collections"
            categories={m.monthly.map((x) => monthLabel(x.month, m.monthly.length))}
            series={[
              { name: "Billed", color: CHART_COLORS.billed, values: m.monthly.map((x) => x.billed) },
              { name: "Collected", color: CHART_COLORS.collections, values: m.monthly.map((x) => Math.max(0, x.collected)) },
            ]}
            emptyMessage="No billing or verified payments in these months."
          />
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-primary-600">Show figures by month</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted uppercase">
                    <th className="py-1">Month</th>
                    <th className="py-1 text-right">Billed</th>
                    <th className="py-1 text-right">Collected (net of reversals)</th>
                  </tr>
                </thead>
                <tbody>
                  {m.monthly.map((x) => (
                    <tr key={x.month} className="border-t border-line">
                      <td className="py-1">{formatMonth(x.month)}</td>
                      <td className="py-1 text-right tabular-nums">{formatMoney(x.billed)}</td>
                      <td className="py-1 text-right tabular-nums">{formatMoney(x.collected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-muted">A month where reversals exceed receipts shows a negative figure here and an empty bar in the chart.</p>
            </div>
          </details>
          <p className="mt-4 border-t border-line pt-3 text-sm">
            <span className="text-muted">Collection rate for the period: </span>
            <strong className="text-ink">{m.collectionRate == null ? "—" : `${Math.floor(m.collectionRate * 1000) / 10}%`}</strong>
            <span className="text-muted">{m.collectionRate == null ? " (nothing billed in the period)" : ` · ${formatMoney(m.collectionRatePaid)} paid towards ${formatMoney(m.collectionRateBilled)} billed`}</span>
          </p>
        </Card>

        <Card
          className="h-full"
          title="Upcoming billing"
          description="Invoices due from today, and this month's billing not yet issued (approved rules only)"
          actions={can(actor.role, "billing.preview") ? <Link href="/billing" className="text-sm font-medium text-primary-600 hover:underline">Billing runs</Link> : null}
        >
          {upcoming.length === 0 ? (
            <EmptyState icon={CalendarClock}>Nothing due or waiting to be billed.</EmptyState>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {upcoming.map((u) => (
                <li key={u.key} className="flex items-start justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <Link href={u.href} className="font-medium text-ink hover:underline">{u.party.name}</Link>
                    <span className="block text-xs text-muted">{`Unit ${u.unit.unitNumber} · due ${formatDate(u.dueDate)}`}</span>
                  </span>
                  <span className="text-right whitespace-nowrap">
                    <Money cents={u.amount} className="font-semibold text-ink" />
                    <span className="block"><Badge tone={u.status === "Not yet billed" ? "slate" : u.status === "Part-paid" ? "blue" : "amber"}>{u.status}</Badge></span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {recent && (
        <Card className="mt-6" title="Recent payment activity" actions={<Link href="/payments" className="text-sm font-medium text-primary-600 hover:underline">View all</Link>}>
          <Table head={["Date", "Payer / account", "Unit", "Amount", "Status", "Reference"]} empty="No payments recorded yet.">
            {recent.map((p) => (
              <tr key={p.id}>
                <Td>{formatDate(fromDbDate(p.receivedDate))}</Td>
                <Td><Link href={`/accounts/${p.party.id}`} className="hover:underline">{p.party.displayName}</Link></Td>
                <Td>
                  {p.units.length === 0
                    ? "—"
                    : p.units.map((u, i) => (
                        <span key={u.id}>
                          {i > 0 && ", "}
                          {canUnits ? <Link href={`/units/${u.id}`} className="hover:underline">{u.unitNumber}</Link> : u.unitNumber}
                        </span>
                      ))}
                </Td>
                <Td><Money cents={p.amountCents} /></Td>
                <Td><StatusBadge kind="payment" status={p.status} /></Td>
                <Td><Link href={`/payments/${p.id}`} className="font-medium text-primary-600 hover:underline">{p.reference}</Link></Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}

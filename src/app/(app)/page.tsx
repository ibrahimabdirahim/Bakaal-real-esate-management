import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FilePlus2,
  FileSignature,
  FileText,
  History,
  Home,
  Receipt,
  Settings,
  UserCog,
  UserPlus,
  UserRound,
  Users,
  Wallet,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { dashboard, DASHBOARD_PERIODS, EXPIRING_SOON_DAYS, type ActivityItem } from "@/server/services/reports";
import { EARLIEST_DATE, monthLabel, periodQuery, resolveDashboardPeriod, type ResolvedPeriod } from "@/lib/dashboard-period";
import { DateRangePicker } from "./date-range-picker";
import { OCCUPANCY_LABELS, type Occupancy } from "@/server/services/occupancy";
import { findBuilding, listBuildings } from "@/server/services/common";
import { NoBuilding } from "@/components/no-building";
import { ButtonLink, Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { CHART_COLORS, GroupedBarChart, Legend, RingChart } from "@/components/charts";
import { AGEING_BUCKETS } from "@/server/ledger";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, formatMonth, monthStart, todayISO } from "@/lib/dates";

export const metadata = { title: "Dashboard" };

const AGEING_COLORS = ["#1565d9", "#0c9c5d", "#e19404", "#ea580c", "#dc3e3b"];

const ACTIVITY_ICONS: Record<string, { icon: LucideIcon; tone: string }> = {
  Payment: { icon: Banknote, tone: "bg-emerald-50 text-emerald-600" },
  Expense: { icon: Receipt, tone: "bg-primary-50 text-primary-600" },
  Invoice: { icon: FileText, tone: "bg-amber-50 text-amber-600" },
  BillingRun: { icon: CalendarClock, tone: "bg-amber-50 text-amber-600" },
  Unit: { icon: Home, tone: "bg-emerald-50 text-emerald-600" },
  Agreement: { icon: FileSignature, tone: "bg-emerald-50 text-emerald-600" },
  Party: { icon: UserRound, tone: "bg-emerald-50 text-emerald-600" },
  WorkOrder: { icon: Wrench, tone: "bg-amber-50 text-amber-600" },
  StaffMember: { icon: UserCog, tone: "bg-slate-100 text-slate-600" },
  StaffTask: { icon: ClipboardCheck, tone: "bg-slate-100 text-slate-600" },
  User: { icon: Users, tone: "bg-slate-100 text-slate-600" },
  BuildingPolicy: { icon: Settings, tone: "bg-slate-100 text-slate-600" },
  Building: { icon: Settings, tone: "bg-slate-100 text-slate-600" },
};

/** Additional queue items from the dashboard service that have no fixed row of their own. */
const EXTRA_ATTENTION: Record<string, LucideIcon> = { billing: CalendarClock, drafts: FileText, unallocated: Banknote, tasks: ClipboardCheck };

const OCCUPIED_KINDS: Occupancy[] = ["RENTED", "RENTED_OWNER_UNIT", "OWNER_HELD", "OWNER_MANAGED"];

/**
 * Period choice as plain links (works without JavaScript; the current one is marked), and the date range,
 * which opens a start/end date form for a custom range.
 */
function PeriodMenu({ p, from, to, today }: { p: ResolvedPeriod; from: string; to: string; today: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <details className="relative">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink shadow-sm hover:bg-surface [&::-webkit-details-marker]:hidden">
          {p.period === "custom" ? "Custom range" : DASHBOARD_PERIODS[p.period]} <ChevronDown className="size-4 text-muted" aria-hidden />
        </summary>
        <nav aria-label="Period" className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-line bg-white p-1 shadow-lg max-sm:left-0 max-sm:right-auto">
          {Object.entries(DASHBOARD_PERIODS).map(([key, label]) => (
            <Link
              key={key}
              href={key === "month" ? "/" : `/?period=${key}`}
              aria-current={key === p.period ? "true" : undefined}
              className={`block rounded-md px-3 py-1.5 text-sm ${key === p.period ? "bg-primary-50 font-semibold text-primary-700" : "text-ink hover:bg-surface"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </details>
      <DateRangePicker from={from} to={to} min={EARLIEST_DATE} max={today} error={p.error} entered={p.entered} />
    </div>
  );
}

/**
 * Building selector. The services report on the whole installation (getBuilding = the first building), so
 * there is no per-building filtering: with one building it is shown as selected; with several, the list is
 * shown but not switchable rather than pretending the figures change.
 */
function BuildingSelector({ buildings, current, summary }: { buildings: { id: string; name: string; address: string | null }[]; current: { id: string; name: string; address: string | null }; summary: string | null }) {
  const several = buildings.length > 1;
  return (
    <section aria-label="Building" className="mb-6 rounded-[var(--radius-card)] border border-line bg-white px-5 py-3.5 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <label htmlFor="building" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
          <Building2 className="size-[18px]" aria-hidden />
          <span className="sr-only">Building</span>
        </label>
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <span className="block text-xs text-muted" aria-hidden>Building</span>
          <select
            id="building"
            defaultValue={current.id}
            disabled
            aria-describedby="building-note"
            className="w-full appearance-none truncate rounded-md bg-transparent py-0.5 pr-7 font-semibold text-ink disabled:opacity-100"
          >
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>{b.address ? `${b.name} — ${b.address}` : b.name}</option>
            ))}
          </select>
          {several && <ChevronDown className="pointer-events-none absolute right-1 bottom-1.5 size-4 text-muted" aria-hidden />}
        </div>
        {summary && <span className="text-sm text-muted sm:ml-auto">{summary}</span>}
      </div>
      <p id="building-note" className={several ? "mt-2 text-xs text-amber-800" : "sr-only"}>
        {several
          ? `${buildings.length} buildings are registered, but figures are not yet split by building: they cover the whole installation.`
          : "The only building registered; all figures are for this building."}
      </p>
    </section>
  );
}

function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-sm font-medium text-primary-600 hover:underline">
      {children}
    </Link>
  );
}

function AttentionRow({ icon: Icon, label, count, href, tone, note }: { icon: LucideIcon; label: string; count: number; href: string; tone: "red" | "amber" | "blue"; note?: string }) {
  const badge = count === 0 ? "bg-slate-100 text-slate-500" : { red: "bg-red-500 text-white", amber: "bg-amber-500 text-white", blue: "bg-primary-600 text-white" }[tone];
  const iconTone = { red: "text-red-500", amber: "text-amber-500", blue: "text-primary-600" }[tone];
  return (
    <li>
      <Link href={href} className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-surface">
        <Icon className={`size-[18px] shrink-0 ${iconTone}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] text-ink">{label}</span>
          {note && <span className="block truncate text-xs text-muted">{note}</span>}
        </span>
        <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums ${badge}`}>{count}</span>
        <ChevronRight className="size-4 shrink-0 text-slate-400 group-hover:text-primary-600" aria-hidden />
      </Link>
    </li>
  );
}

function ActivityTable({ items, showUser }: { items: ActivityItem[]; showUser: boolean }) {
  return (
    <div className="relative -mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
      <table className="responsive-table w-full text-sm sm:table-fixed">
        <colgroup>
          <col className="sm:w-[38%]" />
          <col className="sm:w-[20%]" />
          <col className="sm:w-[10.5rem]" />
          {showUser && <col />}
        </colgroup>
        <thead>
          <tr className="text-left text-xs font-semibold text-muted">
            <th scope="col" className="rounded-l-md bg-surface px-3 py-2">Action</th>
            <th scope="col" className="bg-surface px-3 py-2">Details</th>
            <th scope="col" className={`bg-surface px-3 py-2 ${showUser ? "" : "rounded-r-md"}`}>Date &amp; time</th>
            {showUser && <th scope="col" className="rounded-r-md bg-surface px-3 py-2">User</th>}
          </tr>
        </thead>
        <tbody className="sm:divide-y sm:divide-line">
          {items.map((item) => {
            const { icon: Icon, tone } = ACTIVITY_ICONS[item.entityType] ?? { icon: History, tone: "bg-slate-100 text-slate-600" };
            return (
              <tr key={item.id}>
                <td data-label="Action" className="px-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${tone}`}>
                      <Icon className="size-4" aria-hidden />
                    </span>
                    {item.href ? (
                      <Link href={item.href} title={item.summary} className="truncate font-medium text-ink hover:text-primary-600 hover:underline">{item.summary}</Link>
                    ) : (
                      <span title={item.summary} className="truncate font-medium text-ink">{item.summary}</span>
                    )}
                  </span>
                </td>
                <td data-label="Details" className="truncate px-3 py-2.5 text-muted">
                  {[item.context, item.amount != null ? formatMoney(item.amount) : null].filter(Boolean).join(" · ") || "—"}
                </td>
                <td data-label="Date & time" className="px-3 py-2.5 whitespace-nowrap text-muted tabular-nums">{formatDateTime(item.at)}</td>
                {showUser && <td data-label="User" className="truncate px-3 py-2.5 text-muted">{item.actor ?? "—"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const QUICK_TONES = {
  green: "border-emerald-100 bg-emerald-50/60 [&_.qa-icon]:bg-emerald-500",
  blue: "border-primary-100 bg-primary-50/60 [&_.qa-icon]:bg-primary-600",
  violet: "border-violet-100 bg-violet-50/60 [&_.qa-icon]:bg-violet-600",
  amber: "border-amber-100 bg-amber-50/60 [&_.qa-icon]:bg-amber-500",
  navy: "border-slate-200 bg-slate-50 [&_.qa-icon]:bg-navy-700",
  red: "border-red-100 bg-red-50/60 [&_.qa-icon]:bg-red-500",
} as const;

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const actor = await requirePage("dashboard.view");
  const [building, buildings] = await Promise.all([findBuilding(), listBuildings()]);
  if (!building) return <NoBuilding actor={actor} title="Building dashboard" />;

  const sp = await searchParams;
  const today = todayISO();
  const p = resolveDashboardPeriod(sp, today);
  const period = p.period;
  const canUnits = can(actor.role, "units.view");
  const d = await dashboard(actor, p.period, p.range);
  const m = d.money;
  const range = `from=${d.from}&to=${d.to}`;
  const periodName = period === "custom" ? "in the selected range" : DASHBOARD_PERIODS[period].toLowerCase();
  const financeQuery = periodQuery(p);
  // The balances card is "as of today": its current month is today's, whatever period is chosen.
  const thisMonth = formatMonth(monthStart(today));
  // Occupancy counts only units that can be let or held (retired units are "unavailable").
  const occupancyPct = d.totalUnits > 0 ? Math.round((d.occupied / d.totalUnits) * 1000) / 10 : null;
  const occupiedBreakdown = OCCUPIED_KINDS.filter((k) => d.occupancyCounts[k] > 0).map((k) => `${d.occupancyCounts[k]} ${OCCUPANCY_LABELS[k].toLowerCase()}`);
  const ratePct = m?.collectionRate == null ? null : Math.floor(m.collectionRate * 1000) / 10;
  const balancesHref = can(actor.role, "reports.financial") ? "/reports/arrears" : "/invoices?status=OPEN";

  const actions = [
    can(actor.role, "invoices.create_manual") && { label: "Create invoice", href: "/invoices/new", icon: FilePlus2, tone: "amber" as const },
    can(actor.role, "payments.record") && { label: "Record payment", href: "/payments/new", icon: Wallet, tone: "navy" as const },
    can(actor.role, "workorders.manage") && { label: "New maintenance request", href: "/maintenance/new", icon: Wrench, tone: "red" as const },
    (can(actor.role, "reports.operational") || can(actor.role, "reports.financial")) && { label: "View reports", href: "/reports", icon: BarChart3, tone: "blue" as const },
    can(actor.role, "accounts.manage") && { label: "Add account", href: "/accounts/new", icon: UserPlus, tone: "green" as const },
    can(actor.role, "expenses.submit") && { label: "Record expense", href: "/expenses/new", icon: Receipt, tone: "violet" as const },
  ].filter((x) => !!x);

  const extraAttention = d.pending.filter((p) => p.key in EXTRA_ATTENTION);
  const hasAttention = m != null || d.pendingPayments != null || d.submittedExpenses != null || d.openWorkOrders != null || d.expiringAgreements != null || extraAttention.length > 0;
  const showExpenses = m?.showExpenses ?? false;

  return (
    <>
      <PageHeader title="Dashboard" description="Property operations and financial overview" actions={m ? <PeriodMenu p={p} from={d.from} to={d.to} today={today} /> : null} />
      {m && p.error && (
        <div className="mb-4">
          <Notice tone="red">{`That date range was not used: ${p.error} Showing this month instead.`}</Notice>
        </div>
      )}

      <BuildingSelector buildings={buildings} current={building} summary={canUnits ? `${d.totalUnits + d.unavailableUnits} units registered · ${d.totalUnits} available to let or hold` : null} />

      {/* Unpaid tenant and owner balances: amounts owed (receivables), not cash. */}
      {m && (
        <Card
          title="Unpaid Tenant Balance (KES)"
          description="What tenants and owners still owe on issued invoices, today. Amounts owed, not cash; split by the month each invoice bills."
          actions={
            <span className="flex flex-wrap gap-2">
              {can(actor.role, "notices.view") && (
                <ButtonLink variant="secondary" href="/notices" icon={Bell}>
                  Reminders
                </ButtonLink>
              )}
              <ButtonLink href={balancesHref} icon={FileText}>View balances</ButtonLink>
            </span>
          }
        >
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Billed before this month", value: m.outstandingBroughtForward, note: "still owed", tone: "text-red-600" },
              { label: `Billed in ${thisMonth}`, value: m.outstandingThisMonth, note: "still owed", tone: "text-ink" },
              { label: "Total outstanding", value: m.outstanding, note: `${formatMoney(m.pastDue)} past due`, tone: "text-ink" },
              ...(d.unallocatedAmount != null ? [{ label: "Unallocated verified payments", value: d.unallocatedAmount, note: "received, not yet applied to invoices", tone: "text-emerald-700" }] : []),
            ].map((x) => (
              <div key={x.label} className="rounded-lg bg-surface px-4 py-3">
                <dt className="text-xs text-muted">{x.label}</dt>
                <dd className={`mt-0.5 text-xl font-bold tabular-nums ${x.tone}`}>{formatMoney(x.value)}</dd>
                <dd className="text-xs text-muted">{x.note}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      {/* Monthly payments and occupancy */}
      <div className={`mt-6 grid grid-cols-1 gap-6 ${m && canUnits ? "lg:grid-cols-2" : ""}`}>
        {m && (
          <Card
            className="h-full"
            title={period === "month" ? "Monthly Payments (KES)" : period === "custom" ? "Payments — selected range (KES)" : `Payments — ${periodName} (KES)`}
            description={`${formatDate(d.from)} – ${formatDate(d.to)} · verified payments less reversals`}
            actions={<CardLink href={`/finance${financeQuery ? `?${financeQuery}` : ""}`}>View</CardLink>}
          >
            <div className="flex flex-col items-center gap-6 sm:flex-row">
              <RingChart
                title={ratePct == null ? "Collection rate: nothing billed in the period" : `Collection rate ${ratePct}%: ${formatMoney(m.collectionRatePaid)} paid towards ${formatMoney(m.collectionRateBilled)} billed`}
                center={ratePct == null ? "—" : `${ratePct}%`}
                sub="Collected"
                segments={[
                  { label: "Paid towards the period's invoices", value: m.collectionRatePaid, color: CHART_COLORS.green },
                  { label: "Still owed on them", value: Math.max(0, m.collectionRateBilled - m.collectionRatePaid), color: "#e8edf3" },
                ]}
              />
              <dl className="w-full space-y-2 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-muted">Billed</dt><dd className="font-semibold text-ink tabular-nums">{formatMoney(m.billed)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Verified payments</dt><dd className="font-semibold text-emerald-700 tabular-nums">{formatMoney(m.collected)}</dd></div>
                {m.reversed > 0 && <div className="flex justify-between gap-3 text-xs"><dt className="text-muted">of which reversed in the period</dt><dd className="text-red-600 tabular-nums">−{formatMoney(m.reversed)}</dd></div>}
                <div className="flex justify-between gap-3"><dt className="text-muted">Pending verification</dt><dd className="font-semibold text-amber-700 tabular-nums">{formatMoney(d.pendingPaymentsAmount ?? 0)}</dd></div>
                <div className="flex justify-between gap-3 border-t border-line pt-2"><dt className="text-muted">Collection rate</dt><dd className="font-semibold text-ink tabular-nums">{ratePct == null ? "—" : `${ratePct}%`}</dd></div>
                <p className="text-xs text-muted">{ratePct == null ? "Nothing billed in the period" : "Paid towards the period's invoices ÷ billed"}</p>
                {can(actor.role, "payments.record") && (
                  <div className="pt-2"><ButtonLink href="/payments/new" icon={Wallet}>Record payment</ButtonLink></div>
                )}
              </dl>
            </div>
          </Card>
        )}

        {canUnits && (
          <Card
            className="h-full"
            title="Occupancy"
            description="Today, from agreements in force; retired units are not counted"
            actions={<CardLink href="/units">View units</CardLink>}
          >
            {d.totalUnits === 0 ? (
              <EmptyState icon={Building2}>No units are registered yet, so there is no occupancy to show.</EmptyState>
            ) : (
              <div className="flex flex-col items-center gap-6 sm:flex-row">
                <RingChart
                  title={`Occupancy ${occupancyPct}%: ${d.occupied} occupied, ${d.vacant} vacant of ${d.totalUnits} units`}
                  center={`${occupancyPct}%`}
                  sub="Occupied"
                  segments={[
                    { label: "Occupied", value: d.occupied, color: CHART_COLORS.primary },
                    { label: "Vacant", value: d.vacant, color: "#e8edf3" },
                  ]}
                />
                <dl className="w-full space-y-2 text-sm">
                  <div className="flex justify-between gap-3"><dt><Link href="/units" className="text-muted hover:underline">Occupied</Link></dt><dd className="font-semibold text-ink tabular-nums">{d.occupied}</dd></div>
                  <div className="flex justify-between gap-3"><dt><Link href="/units?occupancy=VACANT" className="text-muted hover:underline">Vacant</Link></dt><dd className="font-semibold text-ink tabular-nums">{d.vacant}</dd></div>
                  <div className="flex justify-between gap-3 border-t border-line pt-2"><dt className="text-muted">Units available to let or hold</dt><dd className="font-semibold text-ink tabular-nums">{d.totalUnits}</dd></div>
                  {d.unavailableUnits > 0 && <div className="flex justify-between gap-3 text-xs"><dt className="text-muted">Retired (not counted)</dt><dd className="text-muted tabular-nums">{d.unavailableUnits}</dd></div>}
                  {occupiedBreakdown.length > 0 && <p className="text-xs text-muted">{`Occupied: ${occupiedBreakdown.join(" · ")}`}</p>}
                  {can(actor.role, "accounts.manage") && (
                    <div className="pt-2"><ButtonLink href="/accounts/new" icon={UserPlus}>Add account</ButtonLink></div>
                  )}
                </dl>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* Arrears and more actions */}
      {(m || actions.length > 0) && (
        <div className={`mt-6 grid grid-cols-1 gap-6 ${m && actions.length ? "lg:grid-cols-3" : ""}`}>
          {m && (
            <Card className="h-full lg:col-span-2" title="Arrears overview (KES)" description="Unpaid balances by days past the due date, today (the arrears report's ageing bands)" actions={<CardLink href={balancesHref}>View</CardLink>}>
              {m.outstanding === 0 ? (
                <EmptyState icon={FileText}>No unpaid balances. Nothing is in arrears.</EmptyState>
              ) : (
                <>
                  <p className="mb-3 text-sm text-muted">
                    <strong className="text-ink">{m.accountsInArrears}</strong> account{m.accountsInArrears === 1 ? "" : "s"} past due · <strong className="text-red-600">{formatMoney(m.pastDue)}</strong> past due of {formatMoney(m.outstanding)} outstanding
                  </p>
                  {/* One row per existing ageing band; the bar is the band's share of the total outstanding. */}
                  <ul className="divide-y divide-line">
                    {AGEING_BUCKETS.map((b, i) => (
                      <li key={b} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)_9rem]">
                        <span className="flex items-center gap-2 text-sm text-ink"><span className="size-2.5 shrink-0 rounded-sm" style={{ background: AGEING_COLORS[i] }} aria-hidden />{b}</span>
                        <span className="col-span-2 row-start-2 h-2 overflow-hidden rounded-full bg-slate-100 sm:col-span-1 sm:row-start-auto" aria-hidden>
                          <span className="block h-full rounded-full" style={{ width: `${(m.ageing[b] / m.outstanding) * 100}%`, background: AGEING_COLORS[i] }} />
                        </span>
                        <span className="text-right">
                          <span className="block font-semibold text-ink tabular-nums">{formatMoney(m.ageing[b])}</span>
                          <span className="block text-xs text-muted">{`${m.ageingCounts[b]} invoice${m.ageingCounts[b] === 1 ? "" : "s"}`}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          )}
          {actions.length > 0 && (
            <Card className="h-full" title={<span className="flex items-center gap-2"><Zap className="size-4 text-primary-600" aria-hidden /> More actions</span>}>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
                {actions.map((a) => (
                  <Link key={a.href} href={a.href} className={`group flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] font-medium text-ink transition hover:shadow-md ${QUICK_TONES[a.tone]}`}>
                    <span className="qa-icon flex size-8 shrink-0 items-center justify-center rounded-lg text-white"><a.icon className="size-4" aria-hidden /></span>
                    <span className="min-w-0 flex-1 leading-tight">{a.label}</span>
                    <ChevronRight className="size-4 shrink-0 text-slate-400 group-hover:text-ink" aria-hidden />
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Existing lower content: what needs attention, recent activity, monthly expenses */}
      <div className={`mt-6 grid grid-cols-1 gap-6 ${hasAttention ? "xl:grid-cols-3" : ""}`}>
        <Card
          className={hasAttention ? "xl:col-span-2" : ""}
          title={<span className="flex items-center gap-2"><History className="size-4 text-primary-600" aria-hidden /> Recent activity</span>}
          actions={can(actor.role, "audit.view") ? <CardLink href="/audit">View all</CardLink> : null}
        >
          {d.recent.length === 0 ? <EmptyState icon={History}>No recent activity you have access to.</EmptyState> : <ActivityTable items={d.recent} showUser={can(actor.role, "audit.view")} />}
        </Card>
        {hasAttention && (
          <Card className="h-full" title={<span className="flex items-center gap-2"><AlertTriangle className="size-4 text-red-500" aria-hidden /> Needs attention</span>}>
            <ul className="divide-y divide-line">
              {m && <AttentionRow icon={AlertTriangle} label="Overdue accounts" count={m.accountsInArrears} href={d.arrearsHref} tone="red" note={m.accountsInArrears ? `${formatMoney(m.pastDue)} past due` : undefined} />}
              {d.pendingPayments != null && <AttentionRow icon={Wallet} label="Payments awaiting verification" count={d.pendingPayments} href="/payments?status=PENDING" tone="amber" />}
              {d.submittedExpenses != null && <AttentionRow icon={Receipt} label="Expenses awaiting approval" count={d.submittedExpenses} href="/expenses?status=SUBMITTED" tone="blue" />}
              {d.openWorkOrders != null && (
                <AttentionRow icon={Wrench} label="Open work orders" count={d.openWorkOrders} href="/maintenance" tone={d.urgentWorkOrders ? "red" : "blue"} note={d.urgentWorkOrders ? `${d.urgentWorkOrders} high or urgent` : undefined} />
              )}
              {d.expiringAgreements != null && <AttentionRow icon={FileSignature} label={`Agreements ending within ${EXPIRING_SOON_DAYS} days`} count={d.expiringAgreements} href="/agreements" tone="amber" />}
              {extraAttention.map((p) => (
                <AttentionRow key={p.key} icon={EXTRA_ATTENTION[p.key]} label={p.text.charAt(0).toUpperCase() + p.text.slice(1)} count={p.count} href={p.href} tone={p.tone} note={p.detail ?? undefined} />
              ))}
            </ul>
          </Card>
        )}
      </div>

      {m && showExpenses && (
        <Card
          className="mt-6"
          title="Monthly expenses (KES)"
          description={`${formatMonth(m.monthly[0].month)} – ${formatMonth(m.monthly.at(-1)!.month)} · costs approved by service month, paid out by payment date`}
          actions={
            <Legend
              items={[
                { label: "Costs approved", color: CHART_COLORS.billed },
                { label: "Paid out", color: CHART_COLORS.expenses },
              ]}
            />
          }
        >
          <GroupedBarChart
            title="Monthly expenses: costs approved and amounts actually paid out"
            categories={m.monthly.map((x) => monthLabel(x.month, m.monthly.length))}
            series={[
              { name: "Costs approved", color: CHART_COLORS.billed, values: m.monthly.map((x) => x.expenses) },
              { name: "Paid out", color: CHART_COLORS.expenses, values: m.monthly.map((x) => x.paidOut) },
            ]}
            emptyMessage="No approved or paid expenses in these months."
          />
          <p className="mt-3 text-sm text-muted">
            <Link href={`/expenses?status=APPROVED&basis=service&${range}`} className="hover:underline">{`Approved, not yet paid: ${formatMoney(m.expensesApprovedUnpaid)}`}</Link>
            {" · "}
            <Link href={`/expenses?status=PAID&basis=paid&${range}`} className="hover:underline">{`Paid out ${periodName}: ${formatMoney(m.expensesPaid)}`}</Link>
          </p>
        </Card>
      )}

      {!m && <p className="mt-6 text-xs text-muted">Financial figures are shown only to roles with access to invoices or financial reports.</p>}
      {m && (
        <p className="mt-6 text-xs text-muted">
          Unpaid balances and arrears are amounts owed by tenants and owners, not cash. Verified payments = money received in the period less payments reversed in it (each on its own date); not a bank balance. Occupancy = occupied units ÷ units
          available to let or hold.
        </p>
      )}
    </>
  );
}

import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  Bell,
  Plus,
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
import { Suspense } from "react";
import { requirePage } from "@/server/auth/session";
import type { Actor } from "@/server/auth/actor";
import { PageSkeleton } from "@/components/page-skeleton";
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
import { addDays, formatDate, formatDateTime, formatMonth, monthEnd, monthStart, todayISO } from "@/lib/dates";

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
 * The building and its units (F66). The services report on the whole installation (getBuilding = the first
 * building), so there is no per-building switching; with several buildings a note says so. The whole card
 * opens the unit register; with no units it offers Add unit instead.
 */
function BuildingCard({ building, buildings, stats, canAddUnit }: { building: { name: string; address: string | null }; buildings: number; stats: { registered: number; inUse: number; occupied: number; vacant: number; retired: number } | null; canAddUnit: boolean }) {
  const body = (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600"><Building2 className="size-[18px]" aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted">Building</span>
        <span className="block truncate font-semibold text-ink">{building.address ? `${building.name} — ${building.address}` : building.name}</span>
      </span>
      {stats && stats.registered > 0 && (
        <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted sm:ml-auto" data-building-units>
          <span><strong className="text-ink tabular-nums">{stats.registered}</strong> registered</span>
          <span><strong className="text-ink tabular-nums">{stats.inUse}</strong> to let or hold</span>
          <span><strong className="text-ink tabular-nums">{stats.occupied}</strong> occupied</span>
          <span><strong className="text-ink tabular-nums">{stats.vacant}</strong> vacant</span>
          {stats.retired > 0 && <span><strong className="text-ink tabular-nums">{stats.retired}</strong> retired</span>}
        </span>
      )}
      {stats && stats.registered > 0 && <ChevronRight className="size-4 shrink-0 text-slate-400 group-hover:text-primary-600" aria-hidden />}
    </div>
  );
  const note = buildings > 1 && <p className="mt-2 text-xs text-amber-800">{`${buildings} buildings are registered, but figures are not yet split by building: they cover the whole installation.`}</p>;
  const box = "mb-6 block rounded-[var(--radius-card)] border border-line bg-white px-5 py-3.5 shadow-[var(--shadow-card)]";
  if (stats && stats.registered > 0) {
    return (
      <Link href="/units" data-building aria-label={`${building.name}: ${stats.registered} units registered, ${stats.occupied} occupied, ${stats.vacant} vacant. Open the unit register`} className={`group ${box} transition hover:border-primary-200 hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:outline-none`}>
        {body}
        {note}
      </Link>
    );
  }
  return (
    <section aria-label="Building" data-building className={box}>
      {body}
      {stats && (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3 text-sm text-muted">
          <span>No units are registered yet.</span>
          {canAddUnit ? <ButtonLink href="/units/new" icon={Plus}>Add unit</ButtonLink> : <span>Ask an administrator or building manager to register them.</span>}
        </div>
      )}
      {note}
    </section>
  );
}

/** A figure that opens the list behind it (the whole tile is the link). */
function FigureLink({ href, label, value, note, tone }: { href: string; label: string; value: string; note: string; tone: string }) {
  return (
    <Link href={href} className="group block rounded-lg bg-surface px-4 py-3 transition hover:bg-primary-50 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:outline-none">
      <span className="flex items-center justify-between gap-2 text-xs text-muted">{label}<ChevronRight className="size-3.5 text-slate-400 group-hover:text-primary-600" aria-hidden /></span>
      <span className={`mt-0.5 block text-xl font-bold tabular-nums ${tone}`}>{value}</span>
      <span className="block text-xs text-muted">{note}</span>
    </Link>
  );
}

/** A figure row in a panel; a link when there is a list behind it. */
function Row({ label, value, href, tone = "text-ink", small = false }: { label: string; value: string; href?: string; tone?: string; small?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${small ? "text-xs" : ""}`}>
      <dt>{href ? <Link href={href} className="text-muted hover:text-primary-700 hover:underline">{label}</Link> : <span className="text-muted">{label}</span>}</dt>
      <dd className={`${small ? "" : "font-semibold"} text-right whitespace-nowrap tabular-nums ${tone}`}>{value}</dd>
    </div>
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

/**
 * The sign-in and permission check runs first, so a refused visitor is still redirected before anything
 * is sent; the figures then stream in, with a placeholder while they load.
 */
export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const actor = await requirePage("dashboard.view");
  const sp = await searchParams;
  return (
    <Suspense fallback={<PageSkeleton title="Dashboard" />}>
      <Dashboard actor={actor} sp={sp} />
    </Suspense>
  );
}

async function Dashboard({ actor, sp }: { actor: Actor; sp: Record<string, string | string[] | undefined> }) {
  const [building, buildings] = await Promise.all([findBuilding(), listBuildings()]);
  if (!building) return <NoBuilding actor={actor} title="Building dashboard" />;

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
  const balancesHref = can(actor.role, "reports.financial") ? "/reports/arrears" : "/invoices?status=OPEN&period=all";
  const canPayments = can(actor.role, "payments.view");
  // One arrears band's invoices: the arrears report filtered to the band, or the past-due invoice list.
  const bandHref = (b: string) => (can(actor.role, "reports.financial") ? `/reports?report=arrears&bucket=${encodeURIComponent(b)}&run=1` : b === "Not yet due" ? "/invoices?status=OPEN&period=all" : "/invoices?status=PAST_DUE&period=all");

  const actions = [
    can(actor.role, "invoices.create_manual") && { label: "Create invoice", href: "/invoices/new", icon: FilePlus2, tone: "amber" as const },
    can(actor.role, "payments.record") && { label: "Record payment", href: "/payments/new", icon: Wallet, tone: "navy" as const },
    can(actor.role, "workorders.manage") && { label: "New maintenance request", href: "/maintenance/new", icon: Wrench, tone: "red" as const },
    (can(actor.role, "reports.operational") || can(actor.role, "reports.financial")) && { label: "View reports", href: "/reports", icon: BarChart3, tone: "blue" as const },
    can(actor.role, "accounts.manage") && { label: "Add tenant or owner (account)", href: "/accounts/new", icon: UserPlus, tone: "green" as const },
    can(actor.role, "expenses.submit") && { label: "Record expense", href: "/expenses/new", icon: Receipt, tone: "violet" as const },
    can(actor.role, "units.manage") && { label: "Add unit", href: "/units/new", icon: Building2, tone: "navy" as const },
    can(actor.role, "billing.preview") && { label: "Run monthly billing", href: "/billing", icon: CalendarClock, tone: "amber" as const },
    can(actor.role, "notices.view") && { label: "Prepare reminders", href: "/notices", icon: Bell, tone: "blue" as const },
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

      <BuildingCard
        building={building}
        buildings={buildings.length}
        stats={canUnits ? { registered: d.totalUnits + d.unavailableUnits, inUse: d.totalUnits, occupied: d.occupied, vacant: d.vacant, retired: d.unavailableUnits } : null}
        canAddUnit={can(actor.role, "units.manage")}
      />

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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-balance-figures>
            {[
              { label: "Billed before this month", value: m.outstandingBroughtForward, note: "still owed", tone: "text-red-600", href: `/invoices?status=OPEN&to=${addDays(monthStart(today), -1)}` },
              { label: `Billed in ${thisMonth}`, value: m.outstandingThisMonth, note: "still owed", tone: "text-ink", href: `/invoices?status=OPEN&from=${monthStart(today)}&to=${monthEnd(monthStart(today))}` },
              { label: "Total outstanding", value: m.outstanding, note: `${formatMoney(m.pastDue)} past due`, tone: "text-ink", href: "/invoices?status=OPEN&period=all" },
              ...(d.unallocatedAmount != null ? [{ label: "Unallocated verified payments", value: d.unallocatedAmount, note: "received, not yet applied to invoices", tone: "text-emerald-700", href: "/payments?unallocated=1" }] : []),
            ].map((x) => <FigureLink key={x.label} href={x.href} label={x.label} value={formatMoney(x.value)} note={x.note} tone={x.tone} />)}
          </div>
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
                <Row label="Billed" value={formatMoney(m.billed)} href={`/invoices?${range}`} />
                <Row label="Verified payments (net)" value={formatMoney(m.collected)} tone="text-emerald-700" href={canPayments ? `/payments?status=VERIFIED&${range}` : undefined} />
                {m.reversed > 0 && <Row small label="of which reversed in the period" value={`−${formatMoney(m.reversed)}`} tone="text-red-600" href={canPayments ? "/payments?status=REVERSED" : undefined} />}
                <Row label="Pending verification (not counted)" value={formatMoney(d.pendingPaymentsAmount ?? 0)} tone="text-amber-700" href={canPayments ? "/payments?status=PENDING" : undefined} />
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
              <EmptyState icon={Building2}>
                {d.unavailableUnits > 0 ? "Every registered unit is retired, so there is no occupancy to show." : "No units are registered yet, so there is no occupancy to show."}
                {can(actor.role, "units.manage") && <span className="mt-3 block"><ButtonLink href="/units/new" icon={Plus}>Add unit</ButtonLink></span>}
              </EmptyState>
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
                  <Row label="Occupied" value={String(d.occupied)} href="/units?occupancy=OCCUPIED" />
                  <Row label="Vacant" value={String(d.vacant)} href="/units?occupancy=VACANT" />
                  <div className="border-t border-line pt-2"><Row label="Units available to let or hold" value={String(d.totalUnits)} href="/units" /></div>
                  {d.unavailableUnits > 0 && <Row small label="Retired (not counted)" value={String(d.unavailableUnits)} tone="text-muted" href="/units?occupancy=RETIRED" />}
                  {occupiedBreakdown.length > 0 && (
                    <p className="text-xs text-muted">
                      {"Occupied: "}
                      {OCCUPIED_KINDS.filter((k) => d.occupancyCounts[k] > 0).map((k, i) => (
                        <span key={k}>{i > 0 && " · "}<Link href={`/units?occupancy=${k}`} className="hover:underline">{`${d.occupancyCounts[k]} ${OCCUPANCY_LABELS[k].toLowerCase()}`}</Link></span>
                      ))}
                    </p>
                  )}
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
                    <strong className="text-ink">{m.accountsInArrears}</strong> account{m.accountsInArrears === 1 ? "" : "s"} past due ·{" "}
                    <Link href="/invoices?status=PAST_DUE&period=all" className="hover:underline"><strong className="text-ink">{m.overdueInvoices}</strong> invoice{m.overdueInvoices === 1 ? "" : "s"}</Link> ·{" "}
                    <strong className="text-red-600">{formatMoney(m.pastDue)}</strong> past due of {formatMoney(m.outstanding)} outstanding
                    {m.oldestDue && ` · oldest due ${formatDate(m.oldestDue)}`}
                  </p>
                  {/* One row per existing ageing band; the bar is the band's share of the total outstanding. */}
                  <ul className="divide-y divide-line">
                    {AGEING_BUCKETS.map((b, i) => (
                      <li key={b} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)_9rem]">
                        <Link href={bandHref(b)} className="flex items-center gap-2 text-sm text-ink hover:text-primary-700 hover:underline"><span className="size-2.5 shrink-0 rounded-sm" style={{ background: AGEING_COLORS[i] }} aria-hidden />{b}</Link>
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
                  {m.topArrears.length > 0 && (
                    <div className="mt-4 border-t border-line pt-3" data-top-arrears>
                      <p className="mb-2 text-xs font-semibold text-muted">Most past due</p>
                      <ul className="space-y-1.5 text-sm">
                        {m.topArrears.map((a) => (
                          <li key={a.partyId} className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <Link href={`/invoices?partyId=${a.partyId}&status=PAST_DUE&period=all`} className="font-medium text-primary-600 hover:underline">{a.name}</Link>
                            <span className="text-muted tabular-nums">{`${a.invoices} invoice${a.invoices === 1 ? "" : "s"} · since ${formatDate(a.oldestDue)} · `}<strong className="text-red-600">{formatMoney(a.pastDue)}</strong></span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
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
    </>
  );
}

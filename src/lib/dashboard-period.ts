// The dashboard's reporting period (pure; shared by the dashboard and the Billing & Payments
// overview). Dates are calendar dates in the building's time zone (todayISO), both ends included.
import { addDays, addMonths, formatDate, formatMonth, monthEnd, monthStart, todayISO, type ISODate } from "@/lib/dates";
import { checkRange, type Range } from "@/lib/report-dates";

export const DASHBOARD_PERIODS = {
  today: "Today",
  week: "This week",
  month: "This month",
  "last-month": "Last month",
  "3m": "Last 3 months",
  "6m": "Last 6 months",
  "12m": "Last 12 months",
  ytd: "Year to date",
} as const;
export type DashboardPeriod = keyof typeof DASHBOARD_PERIODS;

/** The earliest start date accepted for a custom range (no records exist before it). */
export const EARLIEST_DATE = "2000-01-01";

/** Monday of the week containing `day` (weeks run Monday to Sunday, ISO 8601). */
export function weekStart(day: ISODate): ISODate {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((weekday + 6) % 7));
}

export function periodRange(period: DashboardPeriod, today = todayISO()): Range {
  const m0 = monthStart(today);
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "week":
      return { from: weekStart(today), to: today };
    case "last-month":
      return { from: addMonths(m0, -1), to: monthEnd(addMonths(m0, -1)) };
    case "3m":
      return { from: addMonths(m0, -2), to: today };
    case "6m":
      return { from: addMonths(m0, -5), to: today };
    case "12m":
      return { from: addMonths(m0, -11), to: today };
    case "ytd":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    default:
      return { from: m0, to: today };
  }
}

export type ResolvedPeriod = {
  /** A named period, or "custom" for a chosen start and end date. */
  period: DashboardPeriod | "custom";
  range: Range;
  /** "This month", or "01 Oct 2026 – 24 Oct 2026" for a custom range. */
  label: string;
  /** Why the chosen range was not used (the default period is shown instead), with the dates as entered. */
  error?: string;
  entered?: { from: string; to: string };
};

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim() : "");

/**
 * The period asked for in the address (?period=3m, or ?period=custom&from=…&to=…). A custom range is
 * checked: valid dates, the start not after the end, not before 2000 and not after today. A refused
 * range falls back to this month, with the reason.
 */
export function resolveDashboardPeriod(sp: Record<string, string | string[] | undefined>, today = todayISO()): ResolvedPeriod {
  const named = str(sp.period);
  if (named === "custom") {
    const entered = { from: str(sp.from), to: str(sp.to) };
    const checked = !entered.from || !entered.to ? { error: "Choose both a start date and an end date." } : checkRange(entered.from, entered.to, periodRange("month", today));
    const error =
      "error" in checked
        ? checked.error
        : checked.range.from < EARLIEST_DATE
          ? `The start date cannot be before ${formatDate(EARLIEST_DATE)}.`
          : checked.range.to > today
            ? `The end date cannot be after today (${formatDate(today)}).`
            : null;
    if (!error && "range" in checked) return { period: "custom", range: checked.range, label: `${formatDate(checked.range.from)} – ${formatDate(checked.range.to)}` };
    return { period: "month", range: periodRange("month", today), label: DASHBOARD_PERIODS.month, error: error ?? undefined, entered };
  }
  const period = (named in DASHBOARD_PERIODS ? named : "month") as DashboardPeriod;
  return { period, range: periodRange(period, today), label: DASHBOARD_PERIODS[period] };
}

/** The address part that reproduces a period on another page (empty for the default, this month). */
export function periodQuery(p: Pick<ResolvedPeriod, "period" | "range">): string {
  if (p.period === "custom") return `period=custom&from=${p.range.from}&to=${p.range.to}`;
  return p.period === "month" ? "" : `period=${p.period}`;
}

/** The chart months for a range: the range's months, at least the last six, at most the last 24. */
export function chartMonths(range: Range): ISODate[] {
  const end = monthStart(range.to);
  const start = [monthStart(range.from), addMonths(end, -5)].sort()[0];
  const months: ISODate[] = [];
  for (let m = start; m <= end; m = addMonths(m, 1)) months.push(m);
  return months.slice(-24);
}

/** A chart month: "Oct", or "Oct 25" when the chart is longer than a year (so a month name never repeats unlabelled). */
export const monthLabel = (month: ISODate, count: number) => (count > 12 ? `${formatMonth(month).slice(0, 3)} ${month.slice(2, 4)}` : formatMonth(month).slice(0, 3));

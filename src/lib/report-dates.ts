// Reporting periods (F55): calendar dates in the building's time zone (stored dates are calendar
// dates, so no conversion happens). Both ends of a range are included.
import { addDays, addMonths, isISODate, monthEnd, monthStart, type ISODate } from "@/lib/dates";

export type Range = { from: ISODate; to: ISODate };

/** A user-chosen range, checked: both dates valid and the start not after the end. */
export function checkRange(from: string | undefined, to: string | undefined, fallback: Range): { range: Range } | { error: string } {
  const f = from || fallback.from;
  const t = to || fallback.to;
  if (!isISODate(f) || !isISODate(t)) return { error: "Enter valid start and end dates." };
  if (f > t) return { error: "The start date is after the end date. Choose a start date on or before the end date." };
  return { range: { from: f, to: t } };
}

/** The twelve calendar months of a year: 1st to last day (28/29 February handled). */
export function monthsOf(year: number): Range[] {
  return Array.from({ length: 12 }, (_, i) => {
    const from = `${year}-${String(i + 1).padStart(2, "0")}-01`;
    return { from, to: monthEnd(from) };
  });
}

/** A calendar year, cut at `today` when it is the current year (a partial year is labelled as such by the caller). */
export function yearRange(year: number, today: ISODate): Range & { partial: boolean } {
  const from = `${year}-01-01`;
  const end = `${year}-12-31`;
  return end > today && from <= today ? { from, to: today, partial: true } : { from, to: end, partial: false };
}

/** The same span one year earlier (29 February becomes 28 February). */
export function sameSpanLastYear(r: Range): Range {
  const back = (d: ISODate) => {
    const [y, m, day] = d.split("-").map(Number);
    const last = Number(monthEnd(`${y - 1}-${String(m).padStart(2, "0")}-01`).slice(8));
    return `${y - 1}-${String(m).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
  };
  return { from: back(r.from), to: back(r.to) };
}

/** The day before a date (for an opening balance "as at the end of the previous day"). */
export const dayBefore = (d: ISODate) => addDays(d, -1);

/** Whether a date falls in a range (both ends included). */
export const within = (d: ISODate | null | undefined, r: Range) => d != null && d >= r.from && d <= r.to;

/** The first day of the month `n` months before the given month. */
export const monthsBack = (d: ISODate, n: number) => addMonths(monthStart(d), -n);

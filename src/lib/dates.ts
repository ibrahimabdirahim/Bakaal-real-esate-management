// Business dates are calendar dates (no time). They are represented as "YYYY-MM-DD"
// strings in logic and as UTC-midnight Date objects at the database boundary, which is
// how Prisma maps PostgreSQL DATE columns. "Today" is taken in the building time zone.

export const BUILDING_TIME_ZONE = "Africa/Nairobi";

export type ISODate = string; // YYYY-MM-DD

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(value: string): boolean {
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function toDbDate(iso: ISODate): Date {
  if (!isISODate(iso)) throw new Error(`Invalid date: "${iso}"`);
  return new Date(`${iso}T00:00:00.000Z`);
}

export function fromDbDate(date: Date): ISODate {
  return date.toISOString().slice(0, 10);
}

export function optionalFromDbDate(date: Date | null | undefined): ISODate | null {
  return date ? fromDbDate(date) : null;
}

export function todayISO(now: Date = new Date(), timeZone = BUILDING_TIME_ZONE): ISODate {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** First day of the month containing `iso`. */
export function monthStart(iso: ISODate): ISODate {
  return `${iso.slice(0, 7)}-01`;
}

/** Last day of the month that starts at `start` (YYYY-MM-01). */
export function monthEnd(start: ISODate): ISODate {
  const [y, m] = start.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${start.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

export function addMonths(start: ISODate, months: number): ISODate {
  const [y, m] = start.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return fromDbDate(d);
}

export function addDays(iso: ISODate, days: number): ISODate {
  const d = toDbDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fromDbDate(d);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((toDbDate(b).getTime() - toDbDate(a).getTime()) / 86_400_000);
}

/** Date in the month of `periodStart` with the given day number (1–28). */
export function dayOfMonth(periodStart: ISODate, day: number): ISODate {
  if (!Number.isInteger(day) || day < 1 || day > 28) throw new Error(`Invalid due day: ${day}`);
  return `${periodStart.slice(0, 7)}-${String(day).padStart(2, "0")}`;
}

export function formatDate(iso: ISODate | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatMonth(periodStart: ISODate): string {
  const [y, m] = periodStart.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function formatDateTime(date: Date): string {
  return date.toLocaleString("en-GB", { timeZone: BUILDING_TIME_ZONE, dateStyle: "medium", timeStyle: "short" });
}

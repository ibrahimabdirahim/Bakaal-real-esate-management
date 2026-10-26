// The dates financial figures are grouped by (pure). One definition for the dashboard, the
// financial overview, the expense list filters and the reports, so they always agree:
//   * an expense's cost belongs to its service month (servicePeriodStart), or to the day it was
//     recorded when it has no service period;
//   * money paid out belongs to the day it was actually paid (paidDate; records marked paid before
//     payment dates were captured fall back to the day they were marked paid);
//   * money received belongs to the day it was received; a reversal belongs to the day it was
//     reversed, so the original receipt stays in its own period (as in the ledger).

import { fromDbDate, todayISO, type ISODate } from "@/lib/dates";

export function expenseServiceDate(e: { servicePeriodStart: Date | null; createdAt: Date }): ISODate {
  return e.servicePeriodStart ? fromDbDate(e.servicePeriodStart) : todayISO(e.createdAt);
}

export function expensePaidDate(e: { status: string; paidDate: Date | null; paidAt: Date | null }): ISODate | null {
  if (e.status !== "PAID") return null;
  if (e.paidDate) return fromDbDate(e.paidDate);
  return e.paidAt ? todayISO(e.paidAt) : null;
}

/** Received payments count where they were received, whatever happened later (verified or later reversed). */
export function isReceipt(p: { status: string }) {
  return p.status === "VERIFIED" || p.status === "REVERSED";
}

export function reversalDate(p: { status: string; reversedAt: Date | null }): ISODate | null {
  return p.status === "REVERSED" && p.reversedAt ? todayISO(p.reversedAt) : null;
}

export const inRange = (d: ISODate | null, from: ISODate, to: ISODate) => d != null && d >= from && d <= to;

// Balance, status and statement calculations (pure).
//
// Invoice balance = total − active allocations − credit notes.
// Account balance = issued invoices − credit notes − verified payments
//                   (a reversed payment no longer counts).
// Reconciliation:   account balance = sum of invoice balances − unallocated payments.

import type { Cents } from "@/lib/money";
import { addDays, daysBetween, type ISODate } from "@/lib/dates";

export interface InvoiceAmounts {
  total: Cents;
  allocated: Cents; // active (non-reversed) allocations
  credited: Cents;
}

export function invoiceBalance(i: InvoiceAmounts): Cents {
  return i.total - i.allocated - i.credited;
}

/**
 * Order for listing a party's open invoices when staff allocate a payment: oldest billing
 * period first (the billing month for monthly invoices, the issue date for manual ones),
 * then issue date, then invoice number and id, so the order never depends on how the
 * database happens to return rows. This only orders the list; staff still choose amounts.
 */
export function compareByBillingPeriod(
  a: { periodStart: ISODate | null; issueDate: ISODate | null; number: string | null; id: string },
  b: { periodStart: ISODate | null; issueDate: ISODate | null; number: string | null; id: string },
): number {
  const keys = (i: typeof a) => [i.periodStart ?? i.issueDate ?? "", i.issueDate ?? "", i.number ?? "", i.id];
  const [x, y] = [keys(a), keys(b)];
  for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  return 0;
}

export type InvoicePaymentStatus = "PAID" | "PART_PAID" | "UNPAID";

export function invoicePaymentStatus(i: InvoiceAmounts): InvoicePaymentStatus {
  const balance = invoiceBalance(i);
  if (balance <= 0) return "PAID";
  if (i.allocated + i.credited > 0) return "PART_PAID";
  return "UNPAID";
}

/**
 * Overdue only when a grace period is known. Grace comes from the agreement only
 * (DECISIONS.md N2, proposed); without one the invoice is "past due" with grace unknown.
 */
export function dueState(
  balance: Cents,
  dueDate: ISODate | null,
  graceDays: number | null,
  today: ISODate,
): "NOT_DUE" | "PAST_DUE_GRACE_UNKNOWN" | "WITHIN_GRACE" | "OVERDUE" | "SETTLED" {
  if (balance <= 0) return "SETTLED";
  if (!dueDate || today <= dueDate) return "NOT_DUE";
  if (graceDays == null) return "PAST_DUE_GRACE_UNKNOWN";
  return today <= addDays(dueDate, graceDays) ? "WITHIN_GRACE" : "OVERDUE";
}

export const AGEING_BUCKETS = ["Not yet due", "1–30 days", "31–60 days", "61–90 days", "Over 90 days"] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

/** Ageing by days past the due date (a factual measure; no fee or penalty implied). */
export function ageingBucket(dueDate: ISODate | null, today: ISODate): AgeingBucket {
  if (!dueDate) return "Not yet due";
  const days = daysBetween(dueDate, today);
  if (days <= 0) return "Not yet due";
  if (days <= 30) return "1–30 days";
  if (days <= 60) return "31–60 days";
  if (days <= 90) return "61–90 days";
  return "Over 90 days";
}

export type StatementEntryKind = "INVOICE" | "CREDIT_NOTE" | "PAYMENT" | "PAYMENT_REVERSAL";

export interface StatementEntry {
  date: ISODate;
  kind: StatementEntryKind;
  reference: string;
  description: string;
  debit: Cents;
  credit: Cents;
  /** Set for building-wide ledgers (not needed on a single account's statement). */
  party?: { id: string; name: string };
  href?: string;
  /** Invoices and their credit notes: the billing month (null for a manual invoice). Shown next to the issue date. */
  billingPeriod?: ISODate | null;
}

export interface Statement {
  opening: Cents;
  entries: (StatementEntry & { balance: Cents })[];
  charges: Cents;
  payments: Cents;
  credits: Cents;
  reversals: Cents;
  closing: Cents;
}

/**
 * Builds an account statement for [from, to]. Entries before `from` form the opening
 * balance. closing = opening + charges − payments − credits + reversals.
 */
export function buildStatement(all: StatementEntry[], from: ISODate, to: ISODate): Statement {
  const order: Record<StatementEntryKind, number> = { INVOICE: 0, CREDIT_NOTE: 1, PAYMENT: 2, PAYMENT_REVERSAL: 3 };
  const sorted = [...all].sort((a, b) => (a.date === b.date ? order[a.kind] - order[b.kind] : a.date < b.date ? -1 : 1));
  let opening = 0;
  for (const e of sorted) if (e.date < from) opening += e.debit - e.credit;

  let running = opening;
  const entries: Statement["entries"] = [];
  let charges = 0, payments = 0, credits = 0, reversals = 0;
  for (const e of sorted) {
    if (e.date < from || e.date > to) continue;
    running += e.debit - e.credit;
    entries.push({ ...e, balance: running });
    if (e.kind === "INVOICE") charges += e.debit;
    if (e.kind === "PAYMENT") payments += e.credit;
    if (e.kind === "CREDIT_NOTE") credits += e.credit;
    if (e.kind === "PAYMENT_REVERSAL") reversals += e.debit;
  }
  return { opening, entries, charges, payments, credits, reversals, closing: opening + charges - payments - credits + reversals };
}

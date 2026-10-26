// The records the reports read, and the balance of each invoice and payment as at any date (F55).
// Dates follow the existing rules: an invoice counts from its issue date; a payment from the date it
// was received until the day it was reversed (F35); an allocation from the day it was made until it
// was reversed; a credit note from the day it was recorded. Timestamps become building-time dates.
import { db } from "@/server/db";
import { cents } from "@/server/services/common";
import { expenseServiceDate } from "@/server/money-dates";
import { fromDbDate, optionalFromDbDate, todayISO, type ISODate } from "@/lib/dates";
import { sumCents, type Cents } from "@/lib/money";

const day = (d: Date) => todayISO(d);

export async function loadReportData() {
  const [invoices, payments, expenses, units, agreements] = await Promise.all([
    db.invoice.findMany({
      where: { status: "ISSUED" },
      include: {
        party: { select: { id: true, displayName: true } },
        unit: { select: { id: true, unitNumber: true } },
        agreement: { select: { id: true, type: true, reference: true } },
        lines: { select: { category: true, description: true, amount: true } },
        allocations: { select: { amount: true, createdAt: true, reversedAt: true, paymentId: true } },
        creditNotes: { select: { number: true, amount: true, reason: true, createdAt: true } },
      },
      orderBy: [{ issueDate: "asc" }, { number: "asc" }],
    }),
    db.payment.findMany({
      where: { status: { in: ["VERIFIED", "REVERSED"] } },
      include: { party: { select: { id: true, displayName: true } }, allocations: { select: { amount: true, createdAt: true, reversedAt: true, invoiceId: true } } },
      orderBy: [{ receivedDate: "asc" }, { recordedAt: "asc" }],
    }),
    db.expense.findMany({ include: { workOrder: { select: { number: true, unit: { select: { id: true, unitNumber: true } } } } }, orderBy: { createdAt: "asc" } }),
    db.unit.findMany({ orderBy: { unitNumber: "asc" } }),
    db.agreement.findMany({ where: { status: { not: "CANCELLED" } }, include: { party: { select: { id: true, displayName: true } }, charges: true } }),
  ]);
  units.sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));
  return {
    invoices: invoices.map((i) => ({
      id: i.id,
      number: i.number!,
      party: i.party,
      unit: i.unit,
      agreement: i.agreement,
      kind: i.kind,
      issueDate: fromDbDate(i.issueDate!),
      dueDate: optionalFromDbDate(i.dueDate),
      periodStart: optionalFromDbDate(i.periodStart),
      /** The billing month (F32): the period for monthly invoices, the issue date for manual ones. */
      billingDate: optionalFromDbDate(i.periodStart) ?? fromDbDate(i.issueDate!),
      total: cents(i.total)!,
      lines: i.lines.map((l) => ({ category: l.category, description: l.description, amount: cents(l.amount)! })),
      allocations: i.allocations.map((a) => ({ amount: cents(a.amount)!, made: day(a.createdAt), reversed: a.reversedAt ? day(a.reversedAt) : null, paymentId: a.paymentId })),
      credits: i.creditNotes.map((c) => ({ number: c.number, amount: cents(c.amount)!, reason: c.reason, date: day(c.createdAt) })),
    })),
    payments: payments.map((p) => ({
      id: p.id,
      party: p.party,
      method: p.method,
      reference: p.reference,
      receiptNumber: p.receiptNumber,
      amount: cents(p.amount)!,
      received: fromDbDate(p.receivedDate),
      reversed: p.status === "REVERSED" && p.reversedAt ? day(p.reversedAt) : null,
      allocations: p.allocations.map((a) => ({ amount: cents(a.amount)!, made: day(a.createdAt), reversed: a.reversedAt ? day(a.reversedAt) : null, invoiceId: a.invoiceId })),
    })),
    expenses: expenses.map((e) => ({
      id: e.id,
      number: e.number,
      category: e.category,
      payee: e.payee,
      description: e.description,
      status: e.status,
      amount: cents(e.amount)!,
      date: expenseServiceDate(e),
      paidDate: optionalFromDbDate(e.paidDate) ?? (e.paidAt ? day(e.paidAt) : null),
      unit: e.workOrder?.unit ?? null,
      workOrder: e.workOrder?.number ?? null,
      paymentReference: e.paymentReference,
    })),
    units: units.map((u) => ({ id: u.id, unitNumber: u.unitNumber, isActive: u.isActive, floor: u.floor, unitType: u.unitType })),
    agreements: agreements.map((a) => ({
      id: a.id,
      unitId: a.unitId,
      party: a.party,
      type: a.type,
      reference: a.reference,
      start: fromDbDate(a.startDate),
      end: optionalFromDbDate(a.endDate),
      rent: cents(a.rentAmount),
      fee: cents(a.managementFeeAmount),
      deposit: cents(a.depositAmount),
      charges: a.charges.map((c) => ({ description: c.description, amount: cents(c.amount)!, from: fromDbDate(c.effectiveFrom), to: optionalFromDbDate(c.effectiveTo) })),
    })),
  };
}
export type ReportData = Awaited<ReturnType<typeof loadReportData>>;
export type ReportInvoice = ReportData["invoices"][number];
export type ReportPayment = ReportData["payments"][number];

const inForce = (a: { made: ISODate; reversed: ISODate | null }, asOf: ISODate) => a.made <= asOf && (a.reversed == null || a.reversed > asOf);

/** An invoice as at the end of `asOf`: paid (allocations in force), credited, and still owed. */
export function invoiceAsOf(inv: ReportInvoice, asOf: ISODate) {
  const paid = sumCents(inv.allocations.filter((a) => inForce(a, asOf)).map((a) => a.amount));
  const credited = sumCents(inv.credits.filter((c) => c.date <= asOf).map((c) => c.amount));
  return { issued: inv.issueDate <= asOf, paid, credited, balance: inv.total - paid - credited };
}

/** A payment as at the end of `asOf`: whether it counts (received, not yet reversed) and how much of it is not allocated. */
export function paymentAsOf(p: ReportPayment, asOf: ISODate) {
  const counts = p.received <= asOf && (p.reversed == null || p.reversed > asOf);
  const allocated = sumCents(p.allocations.filter((a) => inForce(a, asOf)).map((a) => a.amount));
  return { counts, allocated, unallocated: counts ? p.amount - allocated : 0 };
}

/** Outstanding on issued invoices and unallocated payments, as at a date, optionally for one account or unit. */
export function balancesAsOf(data: ReportData, asOf: ISODate, scope: { partyId?: string; unitId?: string } = {}) {
  const invoices = data.invoices.filter((i) => (!scope.partyId || i.party.id === scope.partyId) && (!scope.unitId || i.unit.id === scope.unitId) && i.issueDate <= asOf);
  const outstanding = sumCents(invoices.map((i) => invoiceAsOf(i, asOf).balance));
  const pastDue = sumCents(invoices.filter((i) => i.dueDate != null && i.dueDate < asOf).map((i) => Math.max(0, invoiceAsOf(i, asOf).balance)));
  const unallocated = scope.unitId ? null : sumCents(data.payments.filter((p) => !scope.partyId || p.party.id === scope.partyId).map((p) => paymentAsOf(p, asOf).unallocated));
  return { outstanding, pastDue, unallocated };
}

/** Money received in a range (F35): verified receipts by date received, less reversals on the day they were made. */
export function receivedIn(data: ReportData, from: ISODate, to: ISODate, partyId?: string): { received: Cents; reversed: Cents; net: Cents } {
  const ps = data.payments.filter((p) => !partyId || p.party.id === partyId);
  const received = sumCents(ps.filter((p) => p.received >= from && p.received <= to).map((p) => p.amount));
  const reversed = sumCents(ps.filter((p) => p.reversed != null && p.reversed >= from && p.reversed <= to).map((p) => p.amount));
  return { received, reversed, net: received - reversed };
}

/** Units occupied on a date (an agreement in force, as the occupancy rules say) and units available (in use). */
export function occupancyOn(data: ReportData, on: ISODate) {
  const live = data.agreements.filter((a) => a.start <= on && (a.end == null || a.end >= on));
  const available = data.units.filter((u) => u.isActive);
  const occupied = available.filter((u) => live.some((a) => a.unitId === u.id)).length;
  return { occupied, available: available.length, rate: available.length ? occupied / available.length : null, live };
}

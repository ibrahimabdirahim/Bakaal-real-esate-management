// The Reports module (F55): each report reads the records once and returns one ReportDoc, which the
// screen, the PDF and the Excel file all lay out, so their rows and totals are the same. Permissions
// are checked here, so a hand-made URL to the page or the download gets nothing it should not.
import { requirePermission, type Actor } from "@/server/auth/actor";
import { can, type Permission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { findBuilding } from "@/server/services/common";
import { accountStatement } from "@/server/services/reports";
import { AGEING_BUCKETS, ageingBucket } from "@/server/ledger";
import { formatDate, formatDateTime, isISODate, monthStart, todayISO, type ISODate } from "@/lib/dates";
import { sumCents } from "@/lib/money";
import { checkRange, dayBefore, monthsOf, sameSpanLastYear, within, yearRange, type Range } from "@/lib/report-dates";
import type { ReportColumn, ReportDoc, ReportRow, ReportSection } from "@/lib/report-doc";
import { balancesAsOf, invoiceAsOf, loadReportData, occupancyOn, paymentAsOf, receivedIn, type ReportData } from "./data";

export type ReportKey = "tenant" | "property" | "arrears" | "expenses" | "month" | "year" | "grouping";
export type FilterKey = "partyId" | "unitId" | "from" | "to" | "asOf" | "year" | "years" | "category" | "status" | "bucket";

export const REPORT_DEFS: { key: ReportKey; label: string; description: string; permission: Permission; filters: FilterKey[] }[] = [
  { key: "tenant", label: "Tenant Statement", description: "An account's invoices, payments, credits and reversals with the running balance.", permission: "reports.financial", filters: ["partyId", "from", "to"] },
  { key: "property", label: "Property Statement", description: "A unit's billing, payments allocated to it, credits, expenses and balance.", permission: "reports.financial", filters: ["unitId", "from", "to"] },
  { key: "arrears", label: "Arrears Report", description: "Unpaid invoices as at a date, by days overdue.", permission: "reports.financial", filters: ["asOf", "unitId", "partyId", "bucket"] },
  { key: "expenses", label: "Expenses Report", description: "Expenses in a period by category and unit; costs approved versus paid.", permission: "reports.financial", filters: ["from", "to", "unitId", "category", "status"] },
  { key: "month", label: "Month on Month Report", description: "Each month of a year: billed, received, credits, expenses, arrears and occupancy.", permission: "reports.financial", filters: ["year"] },
  { key: "year", label: "Year on Year Report", description: "Calendar years compared, with the same span of the previous year for a year in progress.", permission: "reports.financial", filters: ["year", "years"] },
  { key: "grouping", label: "Property Grouping Report", description: "The building and each unit: occupancy, agreements, billed, received, outstanding and expenses.", permission: "reports.financial", filters: ["from", "to"] },
];

export const EXPENSE_STATUS_FILTERS = { COSTS: "Approved and paid (costs)", APPROVED: "Approved, not yet paid", PAID: "Paid", SUBMITTED: "Awaiting approval", DRAFT: "Drafts", REJECTED: "Rejected", ALL: "Every status" } as const;
const CATEGORY_LABELS: Record<string, string> = { WATER: "Water", ELECTRICITY: "Electricity", SECURITY: "Security", CLEANING: "Cleaning", GARBAGE: "Garbage", SALARIES: "Salaries", REPAIRS: "Repairs", MAINTENANCE: "Maintenance", ADMINISTRATION: "Administration", OTHER: "Other" };

export type ReportParams = Partial<Record<FilterKey, string>>;
export type ReportResult = { doc: ReportDoc } | { error: string } | { needs: string };

const col = (key: string, label: string, type: ReportColumn["type"] = "text"): ReportColumn => ({ key, label, type });
const range = (r: Range) => `${formatDate(r.from)} – ${formatDate(r.to)}`;
const pct = (now: number, before: number) => (before === 0 ? null : (now - before) / before);

/** Runs a report for the actor; a missing required choice or an invalid range is returned, not guessed. */
export async function runReport(actor: Actor, key: ReportKey, p: ReportParams, today = todayISO()): Promise<ReportResult> {
  const def = REPORT_DEFS.find((d) => d.key === key);
  if (!def) return { error: "Unknown report." };
  requirePermission(actor, def.permission);
  const showSalaries = can(actor.role, "salary.view");
  const fallback = { from: monthStart(today), to: today };
  const data = await loadReportData();
  if (!showSalaries) data.expenses = data.expenses.filter((e) => e.category !== "SALARIES");
  const generatedAt = formatDateTime(new Date());
  const base = { key, title: def.label, generatedAt };

  switch (key) {
    case "tenant": {
      if (!p.partyId) return { needs: "Choose a tenant or account, then Submit." };
      const r = checkRange(p.from, p.to, fallback);
      if ("error" in r) return r;
      return { doc: await tenantStatement(actor, data, p.partyId, r.range, base) };
    }
    case "property": {
      if (!p.unitId) return { needs: "Choose a unit, then Submit." };
      const r = checkRange(p.from, p.to, fallback);
      if ("error" in r) return r;
      return { doc: propertyStatement(data, p.unitId, r.range, base) };
    }
    case "arrears": {
      const asOf = p.asOf || today;
      if (!isISODate(asOf)) return { error: "Enter a valid as-at date." };
      return { doc: arrears(data, asOf, p, base) };
    }
    case "expenses": {
      const r = checkRange(p.from, p.to, fallback);
      if ("error" in r) return r;
      return { doc: expenses(data, r.range, p, base, showSalaries) };
    }
    case "month": {
      const year = Number(p.year || today.slice(0, 4));
      if (!Number.isInteger(year) || year < 2000 || year > 2100) return { error: "Enter a year between 2000 and 2100." };
      return { doc: monthOnMonth(data, year, today, base) };
    }
    case "year": {
      const year = Number(p.year || today.slice(0, 4));
      const count = Math.min(Math.max(Number(p.years || 3), 2), 10);
      if (!Number.isInteger(year) || year < 2000 || year > 2100) return { error: "Enter a year between 2000 and 2100." };
      return { doc: yearOnYear(data, year, count, today, base) };
    }
    case "grouping": {
      const r = checkRange(p.from, p.to, fallback);
      if ("error" in r) return r;
      return { doc: await grouping(data, r.range, base) };
    }
  }
}

type Base = { key: string; title: string; generatedAt: string };

// ---------------------------------------------------------------- Tenant Statement

async function tenantStatement(actor: Actor, data: ReportData, partyId: string, r: Range, base: Base): Promise<ReportDoc> {
  const party = await db.party.findUnique({ where: { id: partyId }, select: { id: true, displayName: true, phone: true } });
  const st = await accountStatement(actor, partyId, r.from, r.to); // the same entries as the account page statement
  const end = balancesAsOf(data, r.to, { partyId });
  const live = data.agreements.filter((a) => a.party.id === partyId && a.start <= r.to && (a.end == null || a.end >= r.from));
  const units = [...new Set(live.map((a) => data.units.find((u) => u.id === a.unitId)?.unitNumber).filter(Boolean))];
  const invoices = data.invoices.filter((i) => i.party.id === partyId && within(i.issueDate, r));
  const payments = data.payments.filter((pm) => pm.party.id === partyId && within(pm.received, r));
  return {
    ...base,
    period: range(r),
    filters: [["Account", party?.displayName ?? "—"], ["Units", units.join(", ") || "—"], ["Agreements", live.map((a) => `${a.type.toLowerCase()}${a.reference ? ` ${a.reference}` : ""} (${formatDate(a.start)} – ${a.end ? formatDate(a.end) : "open"})`).join("; ") || "—"]],
    summary: [
      { label: `Opening balance (end of ${formatDate(dayBefore(r.from))})`, value: st.opening, type: "money" },
      { label: "Invoiced", value: st.charges, type: "money" },
      { label: "Payments received", value: st.payments, type: "money" },
      { label: "Credits", value: st.credits, type: "money" },
      { label: "Reversals", value: st.reversals, type: "money" },
      { label: `Closing balance (end of ${formatDate(r.to)})`, value: st.closing, type: "money", note: "Owed on invoices less unallocated payments" },
      { label: "Outstanding on invoices at the end", value: end.outstanding, type: "money" },
      { label: "Unallocated payments at the end", value: end.unallocated, type: "money", note: "Not applied to any invoice" },
    ],
    sections: [
      {
        title: "Statement",
        columns: [col("date", "Date", "date"), col("type", "Entry"), col("reference", "Reference"), col("description", "Description"), col("debit", "Charge (KES)", "money"), col("credit", "Payment / credit (KES)", "money"), col("balance", "Balance (KES)", "money")],
        rows: [
          { date: r.from, type: "Opening balance", reference: "", description: `As at the end of ${formatDate(dayBefore(r.from))}`, debit: null, credit: null, balance: st.opening },
          ...st.entries.map((e) => ({ date: e.date, type: { INVOICE: "Invoice", CREDIT_NOTE: "Credit note", PAYMENT: "Payment", PAYMENT_REVERSAL: "Reversal" }[e.kind], reference: e.reference, description: e.description, debit: e.debit || null, credit: e.credit || null, balance: e.balance, _href: e.href ?? null })),
        ],
        totals: { date: null, type: "Closing balance", reference: "", description: "", debit: st.charges + st.reversals, credit: st.payments + st.credits, balance: st.closing },
        empty: "No entries in this period.",
        note: "Invoices are dated by issue date, payments by the date received, reversals and credit notes by the day they were made.",
      },
      {
        title: "Invoices issued in the period",
        columns: [col("number", "Invoice"), col("issued", "Invoice date", "date"), col("due", "Due date", "date"), col("unit", "Unit"), col("lines", "Lines"), col("total", "Amount (KES)", "money"), col("paid", "Paid (KES)", "money"), col("credited", "Credited (KES)", "money"), col("balance", "Remaining (KES)", "money")],
        rows: invoices.map((i) => {
          const a = invoiceAsOf(i, r.to);
          return { number: i.number, issued: i.issueDate, due: i.dueDate, unit: i.unit.unitNumber, lines: i.lines.map((l) => `${l.description} ${(l.amount / 100).toFixed(2)}`).join("; "), total: i.total, paid: a.paid, credited: a.credited, balance: a.balance, _href: `/invoices/${i.id}` };
        }),
        empty: "No invoices were issued to this account in the period.",
        note: `Paid, credited and remaining as at ${formatDate(r.to)}.`,
      },
      {
        title: "Payments received in the period",
        columns: [col("received", "Date received", "date"), col("reference", "Reference"), col("method", "Method"), col("amount", "Amount (KES)", "money"), col("allocated", "Allocated (KES)", "money"), col("unallocated", "Unallocated (KES)", "money"), col("status", "Status")],
        rows: payments.map((pm) => {
          const a = paymentAsOf(pm, r.to);
          return { received: pm.received, reference: pm.receiptNumber ? `${pm.reference} · ${pm.receiptNumber}` : pm.reference, method: pm.method, amount: pm.amount, allocated: a.counts ? a.allocated : null, unallocated: a.counts ? a.unallocated : null, status: pm.reversed && pm.reversed <= r.to ? `Reversed ${formatDate(pm.reversed)}` : "Verified", _href: `/payments/${pm.id}` };
        }),
        empty: "No payments were received from this account in the period.",
        note: "Unallocated money is not applied to any invoice until it is allocated.",
      },
    ],
    notes: ["Pending and rejected payments are not included. Amounts owed are not cash."],
  };
}

// ---------------------------------------------------------------- Property Statement

function propertyStatement(data: ReportData, unitId: string, r: Range, base: Base): ReportDoc {
  const unit = data.units.find((u) => u.id === unitId);
  const agreements = data.agreements.filter((a) => a.unitId === unitId && a.start <= r.to && (a.end == null || a.end >= r.from));
  const invoices = data.invoices.filter((i) => i.unit.id === unitId);
  const inPeriod = invoices.filter((i) => within(i.issueDate, r));
  // Payments applied to this unit's invoices in the period, and allocations reversed in it.
  const allocs = invoices.flatMap((i) => i.allocations.map((a) => ({ ...a, invoice: i })));
  const applied = allocs.filter((a) => within(a.made, r));
  const unapplied = allocs.filter((a) => a.reversed != null && within(a.reversed, r));
  const credits = invoices.flatMap((i) => i.credits.filter((c) => within(c.date, r)).map((c) => ({ ...c, invoice: i })));
  const opening = balancesAsOf(data, dayBefore(r.from), { unitId }).outstanding;
  const closing = balancesAsOf(data, r.to, { unitId });
  const costs = data.expenses.filter((e) => e.unit?.id === unitId && (e.status === "APPROVED" || e.status === "PAID") && within(e.date, r));
  const billed = sumCents(inPeriod.map((i) => i.total));
  const paidIn = sumCents(applied.map((a) => a.amount)) - sumCents(unapplied.map((a) => a.amount));
  const credited = sumCents(credits.map((c) => c.amount));
  const occ = occupancyOn(data, r.to).live.filter((a) => a.unitId === unitId);
  return {
    ...base,
    period: range(r),
    filters: [["Unit", unit ? `${unit.unitNumber}${unit.unitType ? ` · ${unit.unitType}` : ""}${unit.isActive ? "" : " (retired)"}` : "—"], ["Occupancy at the end", occ.length ? occ.map((a) => `${a.type.toLowerCase()} — ${a.party.displayName}`).join("; ") : "Vacant"]],
    summary: [
      { label: `Outstanding at the start (end of ${formatDate(dayBefore(r.from))})`, value: opening, type: "money" },
      { label: "Billed (invoices issued)", value: billed, type: "money" },
      { label: "Payments applied to its invoices", value: paidIn, type: "money", note: "Allocations made, less allocations reversed" },
      { label: "Credits", value: credited, type: "money" },
      { label: `Outstanding at the end (${formatDate(r.to)})`, value: closing.outstanding, type: "money" },
      { label: "Expenses recorded for the unit", value: sumCents(costs.map((e) => e.amount)), type: "money", note: "Approved or paid, by service date; via its work orders" },
    ],
    sections: [
      {
        title: "Agreements in the period",
        columns: [col("type", "Agreement"), col("party", "Account"), col("from", "From", "date"), col("to", "To", "date"), col("rent", "Rent (KES)", "money"), col("fee", "Management fee (KES)", "money"), col("charges", "Approved charges")],
        rows: agreements.map((a) => ({ type: a.type[0] + a.type.slice(1).toLowerCase() + (a.reference ? ` ${a.reference}` : ""), party: a.party.displayName, from: a.start, to: a.end, rent: a.rent, fee: a.fee, charges: a.charges.filter((c) => c.from <= r.to && (c.to == null || c.to >= r.from)).map((c) => `${c.description} ${(c.amount / 100).toFixed(2)}`).join("; ") || "—", _href: `/agreements/${a.id}` })),
        empty: "No agreement on this unit in the period (vacant).",
      },
      {
        title: "Invoices issued",
        columns: [col("number", "Invoice"), col("issued", "Invoice date", "date"), col("due", "Due date", "date"), col("party", "Account"), col("total", "Amount (KES)", "money"), col("paid", "Paid (KES)", "money"), col("credited", "Credited (KES)", "money"), col("balance", "Remaining (KES)", "money")],
        rows: inPeriod.map((i) => {
          const a = invoiceAsOf(i, r.to);
          return { number: i.number, issued: i.issueDate, due: i.dueDate, party: i.party.displayName, total: i.total, paid: a.paid, credited: a.credited, balance: a.balance, _href: `/invoices/${i.id}` };
        }),
        totals: { number: "Total", issued: null, due: null, party: "", total: billed, paid: null, credited: null, balance: null },
        empty: "No invoices were issued for this unit in the period.",
      },
      {
        title: "Payments applied and credits",
        columns: [col("date", "Date", "date"), col("entry", "Entry"), col("invoice", "Invoice"), col("amount", "Amount (KES)", "money")],
        rows: [
          ...applied.map((a) => ({ date: a.made, entry: "Payment allocated", invoice: a.invoice.number, amount: a.amount })),
          ...unapplied.map((a) => ({ date: a.reversed, entry: "Allocation reversed", invoice: a.invoice.number, amount: -a.amount })),
          ...credits.map((c) => ({ date: c.date, entry: `Credit note ${c.number}`, invoice: c.invoice.number, amount: c.amount })),
        ].sort((x, y) => String(x.date).localeCompare(String(y.date))),
        empty: "No payments were applied to this unit's invoices and no credits were recorded in the period.",
        note: "A payment belongs to the account; here it counts when it is allocated to this unit's invoices.",
      },
      {
        title: "Expenses",
        columns: [col("date", "Service date", "date"), col("number", "Expense"), col("category", "Category"), col("description", "Description"), col("status", "Status"), col("amount", "Amount (KES)", "money")],
        rows: costs.map((e) => ({ date: e.date, number: e.number, category: CATEGORY_LABELS[e.category] ?? e.category, description: `${e.payee} — ${e.description}`, status: e.status === "PAID" ? "Paid" : "Approved", amount: e.amount, _href: `/expenses/${e.id}` })),
        empty: "No expenses were recorded for this unit in the period.",
      },
    ],
    notes: ["Amounts received are verified payments allocated to invoices, not a bank balance."],
  };
}

// ---------------------------------------------------------------- Arrears

function arrears(data: ReportData, asOf: ISODate, p: ReportParams, base: Base): ReportDoc {
  const rows = data.invoices
    .filter((i) => i.issueDate <= asOf && (!p.unitId || i.unit.id === p.unitId) && (!p.partyId || i.party.id === p.partyId))
    .map((i) => ({ i, a: invoiceAsOf(i, asOf), bucket: ageingBucket(i.dueDate, asOf) }))
    .filter((x) => x.a.balance > 0 && (!p.bucket || x.bucket === p.bucket))
    .sort((x, y) => (x.i.dueDate ?? "").localeCompare(y.i.dueDate ?? "") || x.i.number.localeCompare(y.i.number));
  const total = sumCents(rows.map((x) => x.a.balance));
  const byBucket = AGEING_BUCKETS.map((b) => ({ b, amount: sumCents(rows.filter((x) => x.bucket === b).map((x) => x.a.balance)), count: rows.filter((x) => x.bucket === b).length }));
  const days = (due: ISODate | null) => (due && due < asOf ? Math.round((Date.parse(asOf) - Date.parse(due)) / 86_400_000) : 0);
  const unitName = p.unitId ? data.units.find((u) => u.id === p.unitId)?.unitNumber : null;
  const partyName = p.partyId ? data.invoices.find((i) => i.party.id === p.partyId)?.party.displayName ?? data.payments.find((x) => x.party.id === p.partyId)?.party.displayName : null;
  return {
    ...base,
    period: `As at ${formatDate(asOf)}`,
    filters: [["As at", formatDate(asOf)], ["Unit", unitName ?? "All"], ["Account", partyName ?? "All"], ["Days overdue", p.bucket || "All"]],
    summary: [
      { label: "Outstanding", value: total, type: "money", note: `${rows.length} invoice(s), ${new Set(rows.map((x) => x.i.party.id)).size} account(s)` },
      ...byBucket.map((b) => ({ label: b.b, value: b.amount, type: "money" as const, note: `${b.count} invoice(s)` })),
    ],
    sections: [
      {
        title: "Unpaid invoices",
        columns: [col("party", "Tenant / account"), col("unit", "Unit"), col("number", "Invoice"), col("issued", "Invoice date", "date"), col("due", "Due date", "date"), col("days", "Days overdue", "number"), col("total", "Original (KES)", "money"), col("paid", "Paid (KES)", "money"), col("credited", "Credited (KES)", "money"), col("balance", "Remaining (KES)", "money"), col("status", "Status")],
        rows: rows.map(({ i, a, bucket }) => ({ party: i.party.displayName, unit: i.unit.unitNumber, number: i.number, issued: i.issueDate, due: i.dueDate, days: days(i.dueDate), total: i.total, paid: a.paid, credited: a.credited, balance: a.balance, status: bucket === "Not yet due" ? "Not yet due" : a.paid + a.credited > 0 ? "Part-paid, overdue" : "Overdue", _href: `/invoices/${i.id}` })),
        totals: { party: "Total", unit: "", number: "", issued: null, due: null, days: null, total: sumCents(rows.map((x) => x.i.total)), paid: sumCents(rows.map((x) => x.a.paid)), credited: sumCents(rows.map((x) => x.a.credited)), balance: total },
        empty: `No unpaid invoices as at ${formatDate(asOf)}.`,
        note: `Days overdue are counted from the due date to ${formatDate(asOf)}. Paid = verified payments allocated to the invoice by that date; settled invoices are left out.`,
      },
    ],
    notes: ["Ageing is a factual measure; no penalty or late fee is implied."],
  };
}

// ---------------------------------------------------------------- Expenses

function expenses(data: ReportData, r: Range, p: ReportParams, base: Base, showSalaries: boolean): ReportDoc {
  const status = (p.status && p.status in EXPENSE_STATUS_FILTERS ? p.status : "COSTS") as keyof typeof EXPENSE_STATUS_FILTERS;
  const keep = (s: string) => (status === "ALL" ? true : status === "COSTS" ? s === "APPROVED" || s === "PAID" : s === status);
  const rows = data.expenses
    .filter((e) => within(e.date, r) && keep(e.status) && (!p.category || e.category === p.category) && (!p.unitId || (p.unitId === "BUILDING" ? e.unit == null : e.unit?.id === p.unitId)))
    .sort((a, b) => a.date.localeCompare(b.date));
  const costs = rows.filter((e) => e.status === "APPROVED" || e.status === "PAID");
  const group = <K extends string>(of: (e: (typeof rows)[number]) => K) =>
    [...new Set(rows.map(of))].sort().map((k) => ({ k, total: sumCents(rows.filter((e) => of(e) === k).map((e) => e.amount)), count: rows.filter((e) => of(e) === k).length }));
  const unitLabel = p.unitId === "BUILDING" ? "Building-wide (no unit)" : p.unitId ? (data.units.find((u) => u.id === p.unitId)?.unitNumber ?? "—") : "All";
  return {
    ...base,
    period: range(r),
    filters: [["Status", EXPENSE_STATUS_FILTERS[status]], ["Category", p.category ? (CATEGORY_LABELS[p.category] ?? p.category) : "All"], ["Unit", unitLabel], ...(showSalaries ? [] : ([["Salaries", "Not shown for your role"]] as [string, string][]))],
    summary: [
      { label: "Total listed", value: sumCents(rows.map((e) => e.amount)), type: "money", note: `${rows.length} expense(s)` },
      { label: "Costs (approved or paid)", value: sumCents(costs.map((e) => e.amount)), type: "money" },
      { label: "Paid", value: sumCents(rows.filter((e) => e.status === "PAID").map((e) => e.amount)), type: "money" },
      { label: "Approved, not yet paid", value: sumCents(rows.filter((e) => e.status === "APPROVED").map((e) => e.amount)), type: "money" },
    ],
    sections: [
      {
        title: "Expenses",
        columns: [col("date", "Expense date", "date"), col("unit", "Property (Unit)"), col("category", "Category"), col("description", "Description"), col("status", "Status"), col("amount", "Amount (KES)", "money"), col("reference", "Reference")],
        rows: rows.map((e) => ({ date: e.date, unit: e.unit?.unitNumber ?? "Building", category: CATEGORY_LABELS[e.category] ?? e.category, description: `${e.payee} — ${e.description}`, status: e.status[0] + e.status.slice(1).toLowerCase() + (e.status === "PAID" && e.paidDate ? ` ${formatDate(e.paidDate)}` : ""), amount: e.amount, reference: [e.number, e.workOrder, e.paymentReference].filter(Boolean).join(" · "), _href: `/expenses/${e.id}` })),
        totals: { date: null, unit: "Total", category: "", description: "", status: "", amount: sumCents(rows.map((e) => e.amount)), reference: "" },
        empty: "No expenses match these filters in the period.",
        note: "Expense date = the service month (or the day recorded when there is no service period). Paid shows the payment date; it is not a bank movement.",
      },
      { title: "By category", columns: [col("k", "Category"), col("count", "Expenses", "number"), col("total", "Amount (KES)", "money")], rows: group((e) => CATEGORY_LABELS[e.category] ?? e.category).map((g) => ({ k: g.k, count: g.count, total: g.total })), empty: "—" },
      { title: "By property (unit)", columns: [col("k", "Unit"), col("count", "Expenses", "number"), col("total", "Amount (KES)", "money")], rows: group((e) => e.unit?.unitNumber ?? "Building").map((g) => ({ k: g.k, count: g.count, total: g.total })), empty: "—" },
    ],
    notes: ["Only approved and paid expenses are costs; drafts, those awaiting approval and rejected ones are listed only when chosen."],
  };
}

// ---------------------------------------------------------------- Month on Month / Year on Year

function periodFigures(data: ReportData, r: Range) {
  const billed = sumCents(data.invoices.filter((i) => within(i.billingDate, r)).map((i) => i.total));
  const received = receivedIn(data, r.from, r.to);
  const credits = sumCents(data.invoices.flatMap((i) => i.credits).filter((c) => within(c.date, r)).map((c) => c.amount));
  const costs = sumCents(data.expenses.filter((e) => (e.status === "APPROVED" || e.status === "PAID") && within(e.date, r)).map((e) => e.amount));
  const end = balancesAsOf(data, r.to);
  const occ = occupancyOn(data, r.to);
  return { billed, received: received.net, reversed: received.reversed, credits, costs, outstanding: end.outstanding, pastDue: end.pastDue, occupied: occ.occupied, available: occ.available, rate: occ.rate };
}

const FIGURE_COLUMNS: ReportColumn[] = [
  col("billed", "Billed (KES)", "money"),
  col("received", "Received (KES)", "money"),
  col("credits", "Credits (KES)", "money"),
  col("costs", "Expenses (KES)", "money"),
  col("outstanding", "Owed at end (KES)", "money"),
  col("pastDue", "Arrears (KES)", "money"),
  col("occupancy", "Occupied"),
  col("rate", "Occupancy", "percent"),
];
const figureRow = (f: ReturnType<typeof periodFigures>): ReportRow => ({ billed: f.billed, received: f.received, credits: f.credits, costs: f.costs, outstanding: f.outstanding, pastDue: f.pastDue, occupancy: `${f.occupied} / ${f.available}`, rate: f.rate });
const FIGURE_NOTES = [
  "Billed = invoices by billing month (manual invoices by issue date). Received = verified payments by date received, less reversals on the day they were made — not a bank balance. Occupied = units occupied / units in use.",
  "Expenses = approved and paid costs by service date. Outstanding and arrears are as at the last day shown. Occupancy counts units now in use (retirements are not dated).",
];

function monthOnMonth(data: ReportData, year: number, today: ISODate, base: Base): ReportDoc {
  const months = monthsOf(year).filter((m) => m.from <= today);
  const figures = months.map((m) => ({ m, f: periodFigures(data, { from: m.from, to: m.to < today ? m.to : today }) }));
  const rows: ReportRow[] = figures.map(({ m, f }, i) => {
    const prev = figures[i - 1]?.f;
    return {
      month: `${formatDate(m.from).slice(3)}${m.to > today ? ` (to ${formatDate(today)})` : ""}`,
      ...figureRow(f),
      billedChange: prev ? f.billed - prev.billed : null,
      receivedChange: prev ? f.received - prev.received : null,
      collection: f.billed > 0 ? f.received / f.billed : null,
    };
  });
  const sum = (k: "billed" | "received" | "credits" | "costs") => sumCents(figures.map((x) => x.f[k]));
  return {
    ...base,
    period: `${year}${months.length < 12 ? ` (January to ${formatDate(today)})` : ""}`,
    filters: [["Year", String(year)]],
    summary: [
      { label: "Billed", value: sum("billed"), type: "money" },
      { label: "Received, net", value: sum("received"), type: "money" },
      { label: "Credits", value: sum("credits"), type: "money" },
      { label: "Expenses", value: sum("costs"), type: "money" },
    ],
    sections: [
      {
        title: "Months",
        columns: [col("month", "Month"), ...FIGURE_COLUMNS, col("billedChange", "Billed vs prev. (KES)", "money"), col("receivedChange", "Received vs prev. (KES)", "money"), col("collection", "Rec. ÷ billed", "percent")],
        rows,
        totals: { month: "Total", billed: sum("billed"), received: sum("received"), credits: sum("credits"), costs: sum("costs"), outstanding: null, pastDue: null, occupancy: "", rate: null, billedChange: null, receivedChange: null, collection: sum("billed") > 0 ? sum("received") / sum("billed") : null },
        empty: "This year has not started yet.",
        note: "Rec. ÷ billed compares the month's net receipts with its billing (N/A when nothing was billed); it is not the dashboard collection rate. Future months are not shown.",
      },
    ],
    notes: FIGURE_NOTES,
  };
}

function yearOnYear(data: ReportData, year: number, count: number, today: ISODate, base: Base): ReportDoc {
  const years = Array.from({ length: count }, (_, i) => year - count + 1 + i).filter((y) => `${y}-01-01` <= today);
  const figures = years.map((y) => ({ y, r: yearRange(y, today) })).map(({ y, r }) => ({ y, r, f: periodFigures(data, r) }));
  const rows: ReportRow[] = figures.map(({ y, r, f }, i) => {
    const prev = figures[i - 1]?.f;
    return { year: r.partial ? `${y} (to ${formatDate(r.to)})` : String(y), ...figureRow(f), billedChange: prev ? f.billed - prev.billed : null, billedPct: prev ? pct(f.billed, prev.billed) : null, receivedChange: prev ? f.received - prev.received : null, receivedPct: prev ? pct(f.received, prev.received) : null };
  });
  const sections: ReportSection[] = [
    {
      title: "Calendar years",
      columns: [col("year", "Year"), ...FIGURE_COLUMNS, col("billedChange", "Billed vs prev. (KES)", "money"), col("billedPct", "Billed %", "percent"), col("receivedChange", "Received vs prev. (KES)", "money"), col("receivedPct", "Received %", "percent")],
      rows,
      empty: "No years to show.",
      note: "Changes compare each year with the one before; a year in progress is compared fairly in the next table. N/A where the previous figure is zero.",
    },
  ];
  const current = figures.find((x) => x.r.partial);
  if (current) {
    const span = sameSpanLastYear(current.r);
    const before = periodFigures(data, span);
    const f = current.f;
    sections.push({
      title: `Same period compared (${formatDate(current.r.from).slice(0, 6)} – ${formatDate(current.r.to).slice(0, 6)})`,
      columns: [col("measure", "Measure"), col("now", `${current.y} (KES)`, "money"), col("before", `${current.y - 1} (KES)`, "money"), col("change", "Change (KES)", "money"), col("pct", "Change", "percent")],
      rows: (["billed", "received", "credits", "costs"] as const).map((k) => ({ measure: { billed: "Billed", received: "Received, net", credits: "Credits", costs: "Expenses" }[k], now: f[k], before: before[k], change: f[k] - before[k], pct: pct(f[k], before[k]) })),
      empty: "—",
    });
  }
  return {
    ...base,
    period: `${years[0] ?? year} – ${years.at(-1) ?? year}`,
    filters: [["Last year shown", String(year)], ["Years", String(years.length)]],
    summary: figures.length ? [{ label: `Billed ${figures.at(-1)!.y}${figures.at(-1)!.r.partial ? " (to date)" : ""}`, value: figures.at(-1)!.f.billed, type: "money" }, { label: `Received ${figures.at(-1)!.y}${figures.at(-1)!.r.partial ? " (to date)" : ""}`, value: figures.at(-1)!.f.received, type: "money" }] : [],
    sections,
    notes: FIGURE_NOTES,
  };
}

// ---------------------------------------------------------------- Property Grouping

async function grouping(data: ReportData, r: Range, base: Base): Promise<ReportDoc> {
  const building = await findBuilding();
  const occ = occupancyOn(data, r.to);
  const unitRows = data.units.map((u) => {
    const live = occ.live.filter((a) => a.unitId === u.id);
    const invoices = data.invoices.filter((i) => i.unit.id === u.id);
    const billed = sumCents(invoices.filter((i) => within(i.issueDate, r)).map((i) => i.total));
    const applied = sumCents(invoices.flatMap((i) => i.allocations).filter((a) => within(a.made, r)).map((a) => a.amount)) - sumCents(invoices.flatMap((i) => i.allocations).filter((a) => a.reversed != null && within(a.reversed, r)).map((a) => a.amount));
    const end = balancesAsOf(data, r.to, { unitId: u.id });
    const costs = sumCents(data.expenses.filter((e) => e.unit?.id === u.id && (e.status === "APPROVED" || e.status === "PAID") && within(e.date, r)).map((e) => e.amount));
    return {
      unit: u.unitNumber + (u.isActive ? "" : " (retired)"),
      status: !u.isActive ? "Retired" : live.length ? "Occupied" : "Vacant",
      agreements: live.length,
      account: live.map((a) => a.party.displayName).join(", ") || "—",
      billed,
      received: applied,
      outstanding: end.outstanding,
      pastDue: end.pastDue,
      costs,
      _href: `/units/${u.id}`,
    };
  });
  const buildingCosts = sumCents(data.expenses.filter((e) => e.unit == null && (e.status === "APPROVED" || e.status === "PAID") && within(e.date, r)).map((e) => e.amount));
  const t = (k: "billed" | "received" | "outstanding" | "pastDue" | "costs") => sumCents(unitRows.map((x) => x[k]));
  const name = building?.name ?? "Building";
  return {
    ...base,
    period: range(r),
    filters: [["Property", name], ["Occupancy as at", formatDate(r.to)]],
    summary: [
      { label: "Units in use", value: occ.available, type: "number" },
      { label: "Occupied", value: occ.occupied, type: "number" },
      { label: "Vacant", value: occ.available - occ.occupied, type: "number" },
      { label: "Occupancy", value: occ.rate, type: "percent" },
      { label: "Billed", value: t("billed"), type: "money" },
      { label: "Received (applied)", value: t("received"), type: "money" },
      { label: "Outstanding at end", value: t("outstanding"), type: "money" },
      { label: "Expenses (units + building)", value: t("costs") + buildingCosts, type: "money" },
    ],
    sections: [
      {
        title: "Property",
        columns: [col("property", "Property"), col("units", "Units", "number"), col("occupied", "Occupied", "number"), col("vacant", "Vacant", "number"), col("agreements", "Agreements in force", "number"), col("billed", "Billed (KES)", "money"), col("received", "Received (KES)", "money"), col("outstanding", "Outstanding (KES)", "money"), col("pastDue", "Arrears (KES)", "money"), col("costs", "Expenses (KES)", "money")],
        rows: [{ property: name, units: occ.available, occupied: occ.occupied, vacant: occ.available - occ.occupied, agreements: occ.live.length, billed: t("billed"), received: t("received"), outstanding: t("outstanding"), pastDue: t("pastDue"), costs: t("costs") + buildingCosts }],
        empty: "No property set up.",
        note: "BAKAAL manages one property; building-wide expenses (not linked to a unit) are included in its total.",
      },
      {
        title: "Units",
        columns: [col("unit", "Unit"), col("status", "Status"), col("agreements", "Agreements", "number"), col("account", "Account(s)"), col("billed", "Billed (KES)", "money"), col("received", "Received (KES)", "money"), col("outstanding", "Outstanding (KES)", "money"), col("pastDue", "Arrears (KES)", "money"), col("costs", "Expenses (KES)", "money")],
        rows: unitRows,
        totals: { unit: "Total (units)", status: "", agreements: null, account: "", billed: t("billed"), received: t("received"), outstanding: t("outstanding"), pastDue: t("pastDue"), costs: t("costs") },
        empty: "No units registered.",
        note: `Occupancy and agreements as at ${formatDate(r.to)}. Billed by issue date; received = payments allocated to the unit's invoices in the period.`,
      },
    ],
    notes: [`Building-wide expenses not linked to a unit: ${(buildingCosts / 100).toFixed(2)} KES.`],
  };
}

/** Options for the filter selects (accounts and units), for roles that may run the reports. */
export async function reportFilterOptions(actor: Actor) {
  if (!can(actor.role, "reports.financial")) return { parties: [], units: [] };
  const [parties, units] = await Promise.all([db.party.findMany({ select: { id: true, displayName: true, archivedAt: true }, orderBy: { displayName: "asc" } }), db.unit.findMany({ select: { id: true, unitNumber: true } })]);
  units.sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));
  return { parties: parties.map((p) => ({ value: p.id, label: p.displayName + (p.archivedAt ? " (archived)" : "") })), units: units.map((u) => ({ value: u.id, label: u.unitNumber })) };
}


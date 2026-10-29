// Reports and dashboard figures, always computed from source records.

import { db } from "@/server/db";
import { BusinessError, requirePermission, type Actor } from "@/server/auth/actor";
import { can, type Permission } from "@/server/auth/permissions";
import { cents, getBuilding, linkableRecords, RECORD_LINKS } from "@/server/services/common";
import { expensePaidDate, expenseServiceDate, inRange, isReceipt, reversalDate } from "@/server/money-dates";
import { listUnits } from "@/server/services/property";
import { listPayments, summarizeInvoice } from "@/server/services/finance";
import { previewBilling } from "@/server/services/billing";
import { occupancyOn, OCCUPANCY_LABELS, type Occupancy } from "@/server/services/occupancy";
import { AGEING_BUCKETS, ageingBucket, buildStatement, type AgeingBucket, type StatementEntry } from "@/server/ledger";
import { formatMoney, sumCents, type Cents } from "@/lib/money";
import { addDays, daysBetween, fromDbDate, isISODate, monthEnd, monthStart, optionalFromDbDate, toDbDate, todayISO, type ISODate } from "@/lib/dates";
import { chartMonths, periodRange, type DashboardPeriod } from "@/lib/dashboard-period";
import type { Range } from "@/lib/report-dates";

async function issuedInvoiceSummaries() {
  const rows = await db.invoice.findMany({
    where: { status: "ISSUED" },
    include: {
      party: { select: { id: true, displayName: true } },
      unit: { select: { id: true, unitNumber: true } },
      agreement: { select: { id: true, type: true, graceDays: true } },
      allocations: { where: { reversedAt: null }, select: { amount: true } },
      creditNotes: { select: { amount: true } },
    },
  });
  const today = todayISO();
  return rows.map((r) => summarizeInvoice(r, today));
}

// ---------------------------------------------------------------- dashboard

// Periods live in lib/dashboard-period.ts (pure, shared with the pages); re-exported for existing imports.
export { DASHBOARD_PERIODS, periodRange, type DashboardPeriod } from "@/lib/dashboard-period";

/** "Agreements expiring soon" on the dashboard: active agreements ending within this many days (display only). */
export const EXPIRING_SOON_DAYS = 30;

/**
 * Dashboard figures, all derived from source records.
 * - Billed: issued invoices whose billing month (or, for manual invoices, issue date) falls in the period.
 * - Collected: verified, non-reversed payments received in the period.
 * - Outstanding / arrears: current invoice balances (as of today), past-due part shown separately.
 * - Expenses: approved or paid, by service-period start (or entry date).
 */
export async function dashboard(actor: Actor, period: DashboardPeriod | "custom" = "month", custom?: Range) {
  requirePermission(actor, "dashboard.view");
  const today = todayISO();
  // A custom range is checked by resolveDashboardPeriod before it gets here; refuse a bad one anyway.
  if (period === "custom" && (!custom || !isISODate(custom.from) || !isISODate(custom.to) || custom.from > custom.to)) throw new BusinessError("Choose a valid start and end date.");
  const { from, to } = period === "custom" ? custom! : periodRange(period, today);
  // Charts cover the period's months, but always at least the last six (and at most the last 24).
  const months = chartMonths({ from, to });
  const chartStart = months[0];

  const units = can(actor.role, "units.view") ? await listUnits(actor) : [];
  const activeUnits = units.filter((u) => u.isActive);
  const occupancyCounts = activeUnits.reduce<Record<Occupancy, number>>(
    (acc, u) => ({ ...acc, [u.occupancy]: acc[u.occupancy] + 1 }),
    { VACANT: 0, RENTED: 0, OWNER_HELD: 0, OWNER_MANAGED: 0, RENTED_OWNER_UNIT: 0 },
  );

  const showMoney = can(actor.role, "reports.financial") || can(actor.role, "invoices.view");
  let money = null;
  if (showMoney) {
    const [summaries, billedInvoices, payments, expenses] = await Promise.all([
      issuedInvoiceSummaries(),
      db.invoice.findMany({
        where: {
          status: "ISSUED",
          OR: [
            { periodStart: { gte: toDbDate(chartStart), lte: toDbDate(to) } },
            { periodStart: null, issueDate: { gte: toDbDate(chartStart), lte: toDbDate(to) } },
          ],
        },
        select: { total: true, periodStart: true, issueDate: true, lines: { select: { category: true, amount: true } } },
      }),
      // Receipts by the day received (including ones reversed later), and reversals by the day reversed.
      db.payment.findMany({
        where: { status: { in: ["VERIFIED", "REVERSED"] }, OR: [{ receivedDate: { gte: toDbDate(chartStart), lte: toDbDate(to) } }, { reversedAt: { gte: toDbDate(addDays(chartStart, -1)) } }] },
        select: { amount: true, receivedDate: true, status: true, reversedAt: true },
      }),
      can(actor.role, "expenses.view")
        ? db.expense.findMany({
            where: { status: { in: ["SUBMITTED", "APPROVED", "REJECTED", "PAID"] }, ...(can(actor.role, "salary.view") ? {} : { category: { not: "SALARIES" as const } }) },
            select: { amount: true, status: true, createdAt: true, servicePeriodStart: true, category: true, paidDate: true, paidAt: true },
          })
        : Promise.resolve([]),
    ]);
    const allExpenses = expenses;
    const approvedExpenses = allExpenses.filter((e) => e.status === "APPROVED" || e.status === "PAID");
    const billingDate = (i: (typeof billedInvoices)[number]) => fromDbDate(i.periodStart ?? i.issueDate!);
    const expenseDate = expenseServiceDate;
    const inPeriod = (d: ISODate) => d >= from && d <= to;
    const periodInvoices = billedInvoices.filter((i) => inPeriod(billingDate(i)));
    // Collection rate: money allocated to the invoices billed in this period ÷ their total.
    // Never above 100%; payments for older invoices do not inflate it.
    const periodSummaries = summaries.filter((i) => {
      const d = i.periodStart ?? i.issueDate;
      return d != null && inPeriod(d);
    });
    const rateBilled = sumCents(periodSummaries.map((i) => i.total));
    const ratePaid = sumCents(periodSummaries.map((i) => i.allocated));

    const open = summaries.filter((i) => i.balance > 0);
    const ageing = Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0])) as Record<AgeingBucket, Cents>;
    const ageingCounts = Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0])) as Record<AgeingBucket, number>;
    for (const i of open) {
      ageing[ageingBucket(i.dueDate, today)] += i.balance;
      ageingCounts[ageingBucket(i.dueDate, today)] += 1;
    }
    const periodExpenses = allExpenses.filter((e) => inPeriod(expenseDate(e)));
    const expenseTotal = (statuses: string[]) => sumCents(periodExpenses.filter((e) => statuses.includes(e.status)).map((e) => cents(e.amount)!));
    const amountOf = (xs: { amount: { toString(): string } }[]) => sumCents(xs.map((x) => cents(x.amount)!));
    const salary = (xs: typeof expenses) => xs.filter((e) => e.category === "SALARIES");
    // Approved costs by service month; money actually paid out by the day it was paid.
    const approvedUnpaid = periodExpenses.filter((e) => e.status === "APPROVED");
    const paidOut = allExpenses.filter((e) => inRange(expensePaidDate(e), from, to));
    const receivedIn = (a: ISODate, b: ISODate) => amountOf(payments.filter((p) => isReceipt(p) && inRange(fromDbDate(p.receivedDate), a, b)));
    const reversedIn = (a: ISODate, b: ISODate) => amountOf(payments.filter((p) => inRange(reversalDate(p), a, b)));

    money = {
      billed: sumCents(periodInvoices.map((i) => cents(i.total)!)),
      rentBilled: sumCents(periodInvoices.flatMap((i) => i.lines.filter((l) => l.category === "RENT").map((l) => cents(l.amount)!))),
      /** Money received in the period, less reversals made in the period (each on its own date, as in the ledger). */
      collected: receivedIn(from, to) - reversedIn(from, to),
      received: receivedIn(from, to),
      reversed: reversedIn(from, to),
      expenses: sumCents(approvedExpenses.filter((e) => inPeriod(expenseDate(e))).map((e) => cents(e.amount)!)),
      /** null when nothing was billed in the period (no denominator). */
      collectionRate: rateBilled > 0 ? ratePaid / rateBilled : null,
      collectionRatePaid: ratePaid,
      collectionRateBilled: rateBilled,
      ageingCounts,
      expensesByStatus: { awaiting: expenseTotal(["SUBMITTED"]), approved: expenseTotal(["APPROVED", "PAID"]), rejected: expenseTotal(["REJECTED"]) },
      /** Approved and paid staff salaries in the period (already inside `expenses`; shown separately). Null without salary access. */
      salaries: can(actor.role, "salary.view") ? sumCents(approvedExpenses.filter((e) => e.category === "SALARIES" && inPeriod(expenseDate(e))).map((e) => cents(e.amount)!)) : null,
      /** Approved (by service month) but not yet paid, and actually paid (by payment date). Salaries included, and also shown on their own. */
      expensesApprovedUnpaid: amountOf(approvedUnpaid),
      expensesPaid: amountOf(paidOut),
      salariesApprovedUnpaid: can(actor.role, "salary.view") ? amountOf(salary(approvedUnpaid)) : null,
      salariesPaid: can(actor.role, "salary.view") ? amountOf(salary(paidOut)) : null,
      outstanding: sumCents(open.map((i) => i.balance)),
      /** The same outstanding total split by billing month (billing month, or issue date for manual invoices): before this month vs this month. */
      outstandingBroughtForward: sumCents(open.filter((i) => (i.periodStart ?? i.issueDate ?? today) < monthStart(today)).map((i) => i.balance)),
      outstandingThisMonth: sumCents(open.filter((i) => (i.periodStart ?? i.issueDate ?? today) >= monthStart(today)).map((i) => i.balance)),
      pastDue: sumCents(open.filter((i) => i.dueDate != null && i.dueDate < today).map((i) => i.balance)),
      accountsInArrears: new Set(open.filter((i) => i.dueDate != null && i.dueDate < today).map((i) => i.party.id)).size,
      /** Issued invoices still owed after their due date, the oldest such due date, and the accounts owing most past due. */
      overdueInvoices: open.filter((i) => i.dueDate != null && i.dueDate < today).length,
      oldestDue: open.filter((i) => i.dueDate != null && i.dueDate < today).reduce<ISODate | null>((o, i) => (o == null || i.dueDate! < o ? i.dueDate! : o), null),
      topArrears: [...open.filter((i) => i.dueDate != null && i.dueDate < today).reduce((acc, i) => {
        const a = acc.get(i.party.id) ?? { partyId: i.party.id, name: i.party.displayName, pastDue: 0, invoices: 0, oldestDue: i.dueDate! };
        acc.set(i.party.id, { ...a, pastDue: a.pastDue + i.balance, invoices: a.invoices + 1, oldestDue: i.dueDate! < a.oldestDue ? i.dueDate! : a.oldestDue });
        return acc;
      }, new Map<string, { partyId: string; name: string; pastDue: Cents; invoices: number; oldestDue: ISODate }>()).values()].sort((x, y) => y.pastDue - x.pastDue).slice(0, 5),
      ageing,
      monthly: months.map((m) => ({
        month: m,
        billed: sumCents(billedInvoices.filter((i) => monthStart(billingDate(i)) === m).map((i) => cents(i.total)!)),
        collected: receivedIn(m, monthEnd(m)) - reversedIn(m, monthEnd(m)),
        expenses: sumCents(approvedExpenses.filter((e) => monthStart(expenseDate(e)) === m).map((e) => cents(e.amount)!)),
        paidOut: amountOf(allExpenses.filter((e) => inRange(expensePaidDate(e), m, monthEnd(m)))),
      })),
      showExpenses: can(actor.role, "expenses.view"),
    };
  }

  const salaryFilter = can(actor.role, "salary.view") ? {} : { category: { not: "SALARIES" as const } };
  const openStatuses = ["OPEN", "ASSIGNED", "IN_PROGRESS"] as const;
  const list = <T,>(allowed: boolean, q: () => Promise<T[]>) => (allowed ? q() : Promise.resolve(null));
  const [pendingPayments, submittedExpenses, openWorkOrders, overdueTasks, draftInvoices, unallocated, expiringAgreements] = await Promise.all([
    list(can(actor.role, "payments.view"), () => db.payment.findMany({ where: { status: "PENDING" }, select: { amount: true, party: { select: { displayName: true } } }, orderBy: { recordedAt: "asc" } })),
    list(can(actor.role, "expenses.view"), () => db.expense.findMany({ where: { status: "SUBMITTED", ...salaryFilter }, select: { payee: true }, orderBy: { submittedAt: "asc" } })),
    list(can(actor.role, "workorders.view"), () => db.workOrder.findMany({ where: { status: { in: [...openStatuses] } }, select: { priority: true, location: true, unit: { select: { unitNumber: true } } }, orderBy: { createdAt: "asc" } })),
    list(can(actor.role, "staff.view"), () => db.staffTask.findMany({ where: { status: "OPEN", dueDate: { lt: toDbDate(today) } }, select: { title: true } })),
    list(can(actor.role, "invoices.view"), () => db.invoice.findMany({ where: { status: "DRAFT" }, select: { party: { select: { displayName: true } } } })),
    list(can(actor.role, "payments.view"), async () => (await listPayments(actor, { status: "VERIFIED" })).filter((p) => p.unallocated > 0)),
    list(can(actor.role, "agreements.view"), () =>
      db.agreement.findMany({
        where: { status: "ACTIVE", endDate: { gte: toDbDate(today), lte: toDbDate(addDays(today, EXPIRING_SOON_DAYS)) } },
        select: { id: true },
      }),
    ),
  ]);
  let billingHeld: { unitNumber: string }[] | null = null;
  if (can(actor.role, "billing.preview")) {
    const preview = await previewBilling(actor, monthStart(today));
    billingHeld = preview.exceptions.filter((e) => e.code !== "ALREADY_INVOICED");
  }

  const names = (xs: (string | null | undefined)[]) => {
    const u = [...new Set(xs.filter((x): x is string => !!x))];
    return u.length === 0 ? null : u.slice(0, 3).join(", ") + (u.length > 3 ? ` +${u.length - 3} more` : "");
  };
  const urgent = openWorkOrders?.filter((w) => w.priority === "HIGH" || w.priority === "URGENT") ?? [];
  const arrearsHref = can(actor.role, "reports.financial") ? "/reports/arrears" : "/invoices?status=PAST_DUE";
  const pending: PendingItem[] = [
    pendingPayments?.length && { key: "payments", count: pendingPayments.length, text: "payment(s) awaiting verification", detail: names(pendingPayments.map((p) => p.party.displayName)), href: "/payments?status=PENDING", tone: "amber" },
    submittedExpenses?.length && { key: "expenses", count: submittedExpenses.length, text: "expense(s) awaiting approval", detail: names(submittedExpenses.map((e) => e.payee)), href: "/expenses?status=SUBMITTED", tone: "amber" },
    billingHeld?.length && { key: "billing", count: billingHeld.length, text: "billing item(s) held for review this month", detail: names(billingHeld.map((e) => `Unit ${e.unitNumber}`)), href: "/billing", tone: "amber" },
    urgent.length && { key: "maintenance", count: urgent.length, text: "high-priority maintenance request(s)", detail: names(urgent.map((w) => (w.unit ? `Unit ${w.unit.unitNumber}` : w.location))), href: "/maintenance", tone: "red" },
    openWorkOrders?.length && !urgent.length && { key: "maintenance", count: openWorkOrders.length, text: "maintenance request(s) open", detail: names(openWorkOrders.map((w) => (w.unit ? `Unit ${w.unit.unitNumber}` : w.location))), href: "/maintenance", tone: "blue" },
    draftInvoices?.length && { key: "drafts", count: draftInvoices.length, text: "draft invoice(s) awaiting review and issue", detail: names(draftInvoices.map((i) => i.party.displayName)), href: "/invoices?status=DRAFT", tone: "blue" },
    unallocated?.length && { key: "unallocated", count: unallocated.length, text: "verified payment(s) with unallocated money", detail: names(unallocated.map((p) => p.party.displayName)), href: "/payments?status=VERIFIED", tone: "blue" },
    overdueTasks?.length && { key: "tasks", count: overdueTasks.length, text: "service task(s) past their due date", detail: names(overdueTasks.map((t) => t.title)), href: "/staff/tasks", tone: "red" },
    money && money.accountsInArrears > 0 && { key: "arrears", count: money.accountsInArrears, text: "account(s) with balances past due", detail: `${formatMoney(money.pastDue)} past due in total`, href: arrearsHref, tone: "red" },
  ].filter((x): x is PendingItem => !!x);

  return {
    period,
    from,
    to,
    totalUnits: activeUnits.length,
    /** Retired units (no longer let or sold): not counted as available for occupancy. */
    unavailableUnits: units.length - activeUnits.length,
    occupied: activeUnits.filter((u) => u.occupancy !== "VACANT").length,
    vacant: activeUnits.filter((u) => u.occupancy === "VACANT").length,
    occupancyCounts,
    money,
    pendingPayments: pendingPayments?.length ?? null,
    /** Recorded but not yet verified: not collected, changes no balance. */
    pendingPaymentsAmount: pendingPayments ? sumCents(pendingPayments.map((p) => cents(p.amount)!)) : null,
    /** Verified money not yet applied to any invoice. */
    unallocatedAmount: unallocated ? sumCents(unallocated.map((p) => p.unallocated)) : null,
    expiringAgreements: expiringAgreements?.length ?? null,
    submittedExpenses: submittedExpenses?.length ?? null,
    openWorkOrders: openWorkOrders?.length ?? null,
    urgentWorkOrders: urgent.length,
    pending,
    arrearsHref,
    recent: await recentActivity(actor, 6),
  };
}

export interface PendingItem {
  key: string;
  count: number;
  text: string;
  detail: string | null;
  href: string;
  tone: "amber" | "red" | "blue";
}

// ---------------------------------------------------------------- recent activity

/** Which record types a role may see in the activity feed (mirrors page permissions). */
const ACTIVITY_PERMISSIONS: Record<string, Permission> = {
  Payment: "payments.view",
  Invoice: "invoices.view",
  BillingRun: "billing.preview",
  Expense: "expenses.view",
  Unit: "units.view",
  Party: "accounts.view",
  Agreement: "agreements.view",
  WorkOrder: "workorders.view",
  StaffMember: "staff.view",
  StaffTask: "staff.view",
  BuildingPolicy: "settings.view",
  Building: "settings.view",
  User: "users.manage",
};


export interface ActivityItem {
  id: string;
  entityType: string;
  action: string;
  summary: string;
  context: string | null;
  amount: Cents | null;
  actor: string | null;
  at: Date;
  href: string | null;
}

/**
 * Recent activity from the audit log, limited to record types the viewer may see. Salary
 * expenses are hidden from roles without salary access; actors are shown only to roles
 * that may read the audit log. Amounts and units come from the related records.
 */
export async function recentActivity(actor: Actor, limit = 6): Promise<ActivityItem[]> {
  requirePermission(actor, "dashboard.view");
  const allowedTypes = Object.entries(ACTIVITY_PERMISSIONS).filter(([, p]) => can(actor.role, p)).map(([t]) => t);
  if (allowedTypes.length === 0) return [];
  const events = await db.auditEvent.findMany({
    where: { entityType: { in: allowedTypes }, action: { notIn: ["report.export"] }, NOT: { action: { startsWith: "auth." } } },
    orderBy: { id: "desc" },
    take: limit * 4,
  });
  const ids = (type: string) => [...new Set(events.filter((e) => e.entityType === type && e.entityId).map((e) => e.entityId!))];
  const [payments, expenses, invoices, units, agreements, workOrders] = await Promise.all([
    db.payment.findMany({ where: { id: { in: ids("Payment") } }, select: { id: true, amount: true, party: { select: { displayName: true } } } }),
    db.expense.findMany({ where: { id: { in: ids("Expense") } }, select: { id: true, amount: true, category: true, payee: true } }),
    db.invoice.findMany({ where: { id: { in: ids("Invoice") } }, select: { id: true, total: true, unit: { select: { unitNumber: true } } } }),
    db.unit.findMany({ where: { id: { in: ids("Unit") } }, select: { id: true, unitNumber: true } }),
    db.agreement.findMany({ where: { id: { in: ids("Agreement") } }, select: { id: true, unit: { select: { unitNumber: true } } } }),
    db.workOrder.findMany({ where: { id: { in: ids("WorkOrder") } }, select: { id: true, location: true, unit: { select: { unitNumber: true } } } }),
  ]);
  const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
  const P = byId(payments), E = byId(expenses), I = byId(invoices), U = byId(units), A = byId(agreements), W = byId(workOrders);
  const showActor = can(actor.role, "audit.view");
  const showSalary = can(actor.role, "salary.view");

  const linkable = await linkableRecords(actor, events);
  const items: ActivityItem[] = [];
  for (const e of events) {
    if (items.length >= limit) break;
    const id = e.entityId ?? "";
    let context: string | null = null;
    let amount: Cents | null = null;
    switch (e.entityType) {
      case "Payment": {
        const p = P.get(id);
        context = p?.party.displayName ?? null;
        amount = p ? cents(p.amount) : null;
        break;
      }
      case "Expense": {
        const x = E.get(id);
        if (x?.category === "SALARIES" && !showSalary) continue;
        if (!x && !showSalary && /salar/i.test(e.summary)) continue;
        context = x ? x.payee : null;
        amount = x ? cents(x.amount) : null;
        break;
      }
      case "Invoice": {
        const i = I.get(id);
        context = i ? `Unit ${i.unit.unitNumber}` : null;
        amount = i ? cents(i.total) : null;
        break;
      }
      case "Unit":
        context = U.get(id) ? `Unit ${U.get(id)!.unitNumber}` : null;
        break;
      case "Agreement":
        context = A.get(id) ? `Unit ${A.get(id)!.unit.unitNumber}` : null;
        break;
      case "WorkOrder": {
        const w = W.get(id);
        context = w ? (w.unit ? `Unit ${w.unit.unitNumber}` : w.location) : null;
        break;
      }
    }
    const base = RECORD_LINKS[e.entityType];
    items.push({
      id: String(e.id),
      entityType: e.entityType,
      action: e.action,
      summary: e.summary,
      context,
      amount,
      actor: showActor ? e.actorEmail : null,
      at: e.occurredAt,
      href: base && e.entityId ? (linkable.get(`${e.entityType}:${e.entityId}`) ?? null) : null,
    });
  }
  return items;
}

// ---------------------------------------------------------------- operational

export async function occupancyReport(actor: Actor, on: ISODate) {
  requirePermission(actor, "reports.operational");
  const building = await getBuilding();
  const units = await db.unit.findMany({
    where: { buildingId: building.id },
    include: { agreements: { include: { party: true } } },
  });
  const rows = units
    .map((u) => {
      const spans = u.agreements.map((a) => ({ ...a, startDate: fromDbDate(a.startDate), endDate: optionalFromDbDate(a.endDate) }));
      const occupancy = occupancyOn(spans, on);
      const live = spans.filter((a) => a.status !== "CANCELLED" && a.startDate <= on && (a.endDate == null || a.endDate >= on));
      return {
        unitNumber: u.unitNumber,
        floor: u.floor ?? "",
        unitType: u.unitType ?? "",
        isActive: u.isActive,
        occupancy,
        status: OCCUPANCY_LABELS[occupancy],
        tenant: live.find((a) => a.type === "RENTAL")?.party.displayName ?? "",
        owner: live.find((a) => a.type === "OWNERSHIP")?.party.displayName ?? "",
      };
    })
    .sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));
  return rows;
}

export async function rentRoll(actor: Actor, on: ISODate) {
  requirePermission(actor, "reports.financial");
  const agreements = await db.agreement.findMany({
    where: { status: { not: "CANCELLED" }, startDate: { lte: toDbDate(on) }, OR: [{ endDate: null }, { endDate: { gte: toDbDate(on) } }] },
    include: { unit: true, party: true, charges: true },
  });
  return agreements
    .map((a) => {
      const charges = a.charges.filter((c) => fromDbDate(c.effectiveFrom) <= on && (c.effectiveTo == null || fromDbDate(c.effectiveTo) >= on));
      const rent = cents(a.rentAmount) ?? 0;
      const fee = cents(a.managementFeeAmount) ?? 0;
      const other = sumCents(charges.map((c) => cents(c.amount)!));
      return {
        unitNumber: a.unit.unitNumber,
        party: a.party.displayName,
        type: a.type,
        startDate: fromDbDate(a.startDate),
        endDate: optionalFromDbDate(a.endDate),
        dueDay: a.dueDay,
        rent,
        managementFee: fee,
        otherCharges: other,
        monthlyTotal: rent + fee + other,
      };
    })
    .sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }) || a.type.localeCompare(b.type));
}

export interface UpcomingBillingRow {
  key: string;
  dueDate: ISODate | null;
  party: { id: string; name: string };
  unit: { id: string; unitNumber: string };
  amount: Cents;
  status: "Due" | "Part-paid" | "Not yet billed";
  href: string;
}

/**
 * Upcoming billing, from existing records and approved rules only: issued invoices still owed whose
 * due date is today or later (earliest first) and, for roles that may preview billing, this month's
 * invoices the approved rules would issue but that are not issued yet. Nothing is projected beyond
 * the current month (future months cannot be billed).
 */
export async function upcomingBilling(actor: Actor, limit = 8): Promise<UpcomingBillingRow[]> {
  requirePermission(actor, "invoices.view");
  const today = todayISO();
  const due: UpcomingBillingRow[] = (await issuedInvoiceSummaries())
    .filter((i) => i.balance > 0 && i.dueDate != null && i.dueDate >= today)
    .map((i) => ({ key: i.id, dueDate: i.dueDate, party: { id: i.party.id, name: i.party.displayName }, unit: i.unit, amount: i.balance, status: i.allocated + i.credited > 0 ? "Part-paid" : "Due", href: `/invoices/${i.id}` }));
  const notYet: UpcomingBillingRow[] = can(actor.role, "billing.preview")
    ? (await previewBilling(actor, monthStart(today))).invoices.map((i) => ({
        key: `preview-${i.agreementId}`,
        dueDate: i.dueDate,
        party: { id: i.partyId, name: i.partyName },
        unit: { id: i.unitId, unitNumber: i.unitNumber },
        amount: i.total,
        status: "Not yet billed",
        href: "/billing",
      }))
    : [];
  return [...due, ...notYet].sort((a, b) => ((a.dueDate ?? "") < (b.dueDate ?? "") ? -1 : 1)).slice(0, limit);
}

export async function arrearsReport(actor: Actor) {
  requirePermission(actor, "reports.financial");
  const today = todayISO();
  const invoices = (await issuedInvoiceSummaries()).filter((i) => i.balance > 0);
  const byParty = new Map<string, { partyId: string; party: string; units: Set<string>; buckets: Record<AgeingBucket, Cents>; total: Cents; oldestDue: ISODate | null }>();
  for (const inv of invoices) {
    const row = byParty.get(inv.party.id) ?? {
      partyId: inv.party.id,
      party: inv.party.displayName,
      units: new Set<string>(),
      buckets: Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0])) as Record<AgeingBucket, Cents>,
      total: 0,
      oldestDue: null,
    };
    row.units.add(inv.unit.unitNumber);
    row.buckets[ageingBucket(inv.dueDate, today)] += inv.balance;
    row.total += inv.balance;
    if (inv.dueDate && (!row.oldestDue || inv.dueDate < row.oldestDue)) row.oldestDue = inv.dueDate;
    byParty.set(inv.party.id, row);
  }
  const rows = [...byParty.values()].map((r) => ({ ...r, units: [...r.units].join(", ") })).sort((a, b) => b.total - a.total);
  const totals = Object.fromEntries(AGEING_BUCKETS.map((b) => [b, sumCents(rows.map((r) => r.buckets[b]))])) as Record<AgeingBucket, Cents>;
  // The same balances invoice by invoice, oldest due first (days overdue counted from the due date, as the buckets are).
  const detail = invoices
    .map((i) => ({
      id: i.id,
      number: i.number,
      partyId: i.party.id,
      party: i.party.displayName,
      unit: i.unit.unitNumber,
      dueDate: i.dueDate,
      daysOverdue: i.dueDate && i.dueDate < today ? daysBetween(i.dueDate, today) : 0,
      total: i.total,
      paid: i.allocated,
      credited: i.credited,
      balance: i.balance,
    }))
    .sort((a, b) => ((a.dueDate ?? "") < (b.dueDate ?? "") ? -1 : (a.dueDate ?? "") > (b.dueDate ?? "") ? 1 : 0));
  return { rows, totals, grandTotal: sumCents(rows.map((r) => r.total)), invoices: detail };
}

/**
 * Money received in a period: each verified receipt on the day it was received (also when it was
 * reversed later, marked as such), and each reversal as its own negative row on the day it was
 * reversed. Total = received − reversed, the same figure as the dashboard and the ledger.
 */
export async function collectionsReport(actor: Actor, from: ISODate, to: ISODate) {
  requirePermission(actor, "reports.financial");
  const payments = await db.payment.findMany({
    where: { status: { in: ["VERIFIED", "REVERSED"] }, OR: [{ receivedDate: { gte: toDbDate(from), lte: toDbDate(to) } }, { reversedAt: { gte: toDbDate(addDays(from, -1)) } }] },
    include: { party: true, allocations: { where: { reversedAt: null }, select: { amount: true } } },
    orderBy: { receivedDate: "asc" },
  });
  type Row = {
    date: ISODate;
    kind: "RECEIPT" | "REVERSAL";
    receiptNumber: string;
    party: string;
    method: (typeof payments)[number]["method"];
    reference: string;
    amount: Cents;
    reversedLater: boolean;
    /** Of a receipt still verified: allocated to invoices today, and the rest (null for reversals and reversed receipts). */
    allocated: Cents | null;
    unallocated: Cents | null;
    href: string;
  };
  const rows: Row[] = [];
  for (const p of payments) {
    const base = { receiptNumber: p.receiptNumber ?? "", party: p.party.displayName, method: p.method, reference: p.reference, href: `/payments/${p.id}` };
    const received = fromDbDate(p.receivedDate);
    const allocated = p.status === "VERIFIED" ? sumCents(p.allocations.map((a) => cents(a.amount)!)) : null;
    const unallocated = allocated == null ? null : cents(p.amount)! - allocated;
    if (isReceipt(p) && inRange(received, from, to)) rows.push({ ...base, date: received, kind: "RECEIPT", amount: cents(p.amount)!, reversedLater: p.status === "REVERSED", allocated, unallocated });
    const reversed = reversalDate(p);
    if (inRange(reversed, from, to)) rows.push({ ...base, date: reversed!, kind: "REVERSAL", amount: -cents(p.amount)!, reversedLater: false, allocated: null, unallocated: null });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const sum = (xs: Row[]) => sumCents(xs.map((r) => r.amount));
  const byMethod = ["MPESA", "BANK", "CASH"].map((m) => ({ method: m, total: sum(rows.filter((r) => r.method === m)) }));
  return { rows, byMethod, received: sum(rows.filter((r) => r.kind === "RECEIPT")), reversed: sumCents(rows.filter((r) => r.kind === "REVERSAL").map((r) => -r.amount)), total: sum(rows) };
}

/**
 * Approved costs in a period, grouped by service month (the day recorded when there is no service
 * period), with the recorded and payment dates kept for reference. Money actually paid out in the
 * period is a separate figure, by payment date.
 */
export async function expenseReport(actor: Actor, from: ISODate, to: ISODate) {
  requirePermission(actor, "reports.financial");
  const showSalary = can(actor.role, "salary.view");
  const expenses = await db.expense.findMany({
    where: { status: { in: ["APPROVED", "PAID"] }, ...(showSalary ? {} : { category: { not: "SALARIES" } }) },
    orderBy: [{ servicePeriodStart: "asc" }, { createdAt: "asc" }],
  });
  const toRow = (e: (typeof expenses)[number]) => ({
    id: e.id,
    number: e.number,
    date: expenseServiceDate(e),
    recordedDate: todayISO(e.createdAt),
    paidDate: expensePaidDate(e),
    category: e.category,
    payee: e.payee,
    description: e.description,
    status: e.status,
    amount: cents(e.amount)!,
    href: e.category === "SALARIES" && e.staffMemberId ? `/staff/salary-payments/${e.id}` : `/expenses/${e.id}`,
  });
  const all = expenses.map(toRow);
  const rows = all.filter((r) => inRange(r.date, from, to)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const paidInPeriod = all.filter((r) => inRange(r.paidDate, from, to));
  const categories = [...new Set(rows.map((r) => r.category))].sort();
  return {
    rows,
    // Staff salaries apart from the building's running costs; together they are the total (each counted once).
    salaries: sumCents(rows.filter((r) => r.category === "SALARIES").map((r) => r.amount)),
    runningCosts: sumCents(rows.filter((r) => r.category !== "SALARIES").map((r) => r.amount)),
    approvedUnpaid: sumCents(rows.filter((r) => r.status === "APPROVED").map((r) => r.amount)),
    /** Paid out in the period, by payment date (may include costs of other service months). */
    paidInPeriod: sumCents(paidInPeriod.map((r) => r.amount)),
    byCategory: categories.map((c) => ({ category: c, total: sumCents(rows.filter((r) => r.category === c).map((r) => r.amount)) })),
    total: sumCents(rows.map((r) => r.amount)),
    salariesHidden: !showSalary,
  };
}

// ---------------------------------------------------------------- statements

/**
 * Ledger entries from issued invoices, credit notes, verified payments and reversals: the one
 * source for account statements and the building-wide ledger, so the two always agree.
 */
async function statementEntries(partyId?: string): Promise<StatementEntry[]> {
  const where = partyId ? { partyId } : {};
  const [invoices, payments] = await Promise.all([
    db.invoice.findMany({ where: { ...where, status: "ISSUED" }, include: { creditNotes: true, unit: true, party: { select: { id: true, displayName: true } } } }),
    db.payment.findMany({ where: { ...where, status: { in: ["VERIFIED", "REVERSED"] } }, include: { party: { select: { id: true, displayName: true } } } }),
  ]);
  const entries: StatementEntry[] = [];
  for (const inv of invoices) {
    const party = { id: inv.party.id, name: inv.party.displayName };
    entries.push({
      date: fromDbDate(inv.issueDate!),
      kind: "INVOICE",
      reference: inv.number!,
      description: `Invoice — unit ${inv.unit.unitNumber}${inv.periodStart ? ` (${fromDbDate(inv.periodStart).slice(0, 7)})` : ""}`,
      debit: cents(inv.total)!,
      credit: 0,
      party,
      href: `/invoices/${inv.id}`,
      billingPeriod: inv.periodStart ? fromDbDate(inv.periodStart) : null,
    });
    for (const cn of inv.creditNotes) {
      entries.push({ date: todayISO(cn.createdAt), kind: "CREDIT_NOTE", reference: cn.number, description: `Credit note on ${inv.number}: ${cn.reason}`, debit: 0, credit: cents(cn.amount)!, party, href: `/invoices/${inv.id}`, billingPeriod: inv.periodStart ? fromDbDate(inv.periodStart) : null });
    }
  }
  for (const p of payments) {
    const party = { id: p.party.id, name: p.party.displayName };
    entries.push({ date: fromDbDate(p.receivedDate), kind: "PAYMENT", reference: p.receiptNumber ?? p.reference, description: `${p.method} payment ${p.reference}`, debit: 0, credit: cents(p.amount)!, party, href: `/payments/${p.id}` });
    if (p.status === "REVERSED" && p.reversedAt) {
      entries.push({ date: todayISO(p.reversedAt), kind: "PAYMENT_REVERSAL", reference: p.receiptNumber ?? p.reference, description: `Reversal: ${p.reversalReason ?? ""}`, debit: cents(p.amount)!, credit: 0, party, href: `/payments/${p.id}` });
    }
  }
  return entries;
}

export async function accountStatement(actor: Actor, partyId: string, from: ISODate, to: ISODate) {
  requirePermission(actor, "invoices.view");
  return buildStatement(await statementEntries(partyId), from, to);
}

/**
 * Building-wide ledger for a period: every invoice, credit note, verified payment and reversal
 * with a running balance (the same entries as the account statements), plus payments still
 * pending or rejected, listed separately because they do not change any balance.
 */
export async function financeLedger(actor: Actor, from: ISODate, to: ISODate) {
  requirePermission(actor, "invoices.view");
  requirePermission(actor, "payments.view");
  const [statement, notCounted] = await Promise.all([
    statementEntries().then((e) => buildStatement(e, from, to)),
    db.payment.findMany({
      where: { status: { in: ["PENDING", "REJECTED"] }, receivedDate: { gte: toDbDate(from), lte: toDbDate(to) } },
      include: { party: { select: { id: true, displayName: true } } },
      orderBy: [{ receivedDate: "asc" }, { recordedAt: "asc" }],
    }),
  ]);
  return {
    ...statement,
    notCounted: notCounted.map((p) => ({ id: p.id, date: fromDbDate(p.receivedDate), status: p.status, reference: p.reference, method: p.method, amount: cents(p.amount)!, party: { id: p.party.id, name: p.party.displayName } })),
  };
}

/**
 * Cross-checks that ledgers agree: for every account, the statement balance must equal
 * the sum of invoice balances minus unallocated verified payments.
 */
export async function reconciliationCheck(actor: Actor) {
  requirePermission(actor, "reports.financial");
  const parties = await db.party.findMany({ select: { id: true, displayName: true } });
  const invoices = await issuedInvoiceSummaries();
  const payments = await db.payment.findMany({ where: { status: "VERIFIED" }, include: { allocations: { where: { reversedAt: null } } } });
  const today = todayISO();
  const results = [];
  for (const p of parties) {
    const statement = await accountStatement(actor, p.id, "1900-01-01", today);
    const invBal = sumCents(invoices.filter((i) => i.party.id === p.id).map((i) => i.balance));
    const unalloc = sumCents(payments.filter((x) => x.partyId === p.id).map((x) => cents(x.amount)! - sumCents(x.allocations.map((a) => cents(a.amount)!))));
    if (statement.entries.length === 0 && invBal === 0 && unalloc === 0) continue;
    results.push({ party: p.displayName, partyId: p.id, statementBalance: statement.closing, invoiceBalances: invBal, unallocated: unalloc, matches: statement.closing === invBal - unalloc });
  }
  return results;
}

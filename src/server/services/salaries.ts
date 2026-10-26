// Staff salary payments.
//
// A salary payment is a salary expense (category SALARIES) linked to one staff member and one
// calendar month, with its gross / allowances / deductions breakdown. It uses the normal expense
// workflow, so each salary is counted exactly once in expenses, the dashboard and reports:
//   Draft → Pending approval (SUBMITTED) → Approved or Rejected → Paid.
// Approval does not mean money has moved; "Paid" is set only when the actual payment date,
// method and reference are recorded (markExpensePaid). Deciding uses decideExpense (one confirmation,
// F61). No statutory deductions or tax rules are applied.

import { db, type Tx } from "@/server/db";
import { audit } from "@/server/audit";
import { attachStaged } from "@/server/services/documents";
import { BusinessError, requirePermission, type Actor } from "@/server/auth/actor";
import { cents, describeDbError, getBuilding, nextNumber } from "@/server/services/common";
import { userNames } from "@/server/services/finance";
import { centsToDecimalString, formatMoney, sumCents, type Cents } from "@/lib/money";
import { formatMonth, fromDbDate, monthStart, optionalFromDbDate, toDbDate, todayISO, type ISODate } from "@/lib/dates";
import { employedDuring, isFutureMonth, netSalary, salaryPeriod } from "@/server/salary";
import { expensePaidDate } from "@/server/money-dates";

export const SALARY_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "PAID"] as const;
export type SalaryStatus = (typeof SALARY_STATUSES)[number];
export const SALARY_STATUS_LABELS: Record<SalaryStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Pending approval",
  APPROVED: "Approved — not yet paid",
  REJECTED: "Rejected",
  PAID: "Paid",
};

export interface SalaryInput {
  staffMemberId: string;
  /** Any date in the salary month; stored as the month's first and last day. */
  month: ISODate;
  gross: Cents;
  allowances: Cents;
  deductions: Cents;
  notes: string | null;
  evidenceNote: string | null;
}

function requireRecording(actor: Actor) {
  requirePermission(actor, "salary.manage");
  requirePermission(actor, "expenses.submit");
}

/** Validates the input and returns the expense fields to store. */
async function salaryFields(tx: Tx, input: SalaryInput, excludeId: string | null) {
  if (isFutureMonth(input.month, todayISO())) throw new BusinessError("Salaries cannot be recorded for a future month.");
  const result = netSalary(input);
  if ("error" in result) throw new BusinessError(result.error);
  const staff = await tx.staffMember.findUnique({ where: { id: input.staffMemberId } });
  if (!staff) throw new BusinessError("Choose a staff member.");
  const period = salaryPeriod(input.month);
  if (!employedDuring({ startDate: optionalFromDbDate(staff.startDate), endDate: optionalFromDbDate(staff.endDate) }, period.start)) {
    throw new BusinessError(`${staff.fullName} was not employed in ${formatMonth(period.start)} (check the staff member's start and end dates).`);
  }
  const existing = await tx.expense.findFirst({
    where: { category: "SALARIES", staffMemberId: staff.id, servicePeriodStart: toDbDate(period.start), status: { not: "REJECTED" }, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (existing) {
    throw new BusinessError(
      `A salary payment for ${staff.fullName} for ${formatMonth(period.start)} already exists (${existing.number}, ${SALARY_STATUS_LABELS[existing.status].toLowerCase()}). Correct that record instead; a rejected one frees the month.`,
    );
  }
  return {
    staff,
    period,
    net: result.net,
    data: {
      category: "SALARIES" as const,
      payee: staff.fullName,
      description: input.notes?.trim() || `Salary for ${formatMonth(period.start)}`,
      amount: centsToDecimalString(result.net),
      salaryGross: centsToDecimalString(input.gross),
      salaryAllowances: centsToDecimalString(input.allowances),
      salaryDeductions: centsToDecimalString(input.deductions),
      servicePeriodStart: toDbDate(period.start),
      servicePeriodEnd: toDbDate(period.end),
      staffMemberId: staff.id,
      evidenceNote: input.evidenceNote,
      costCentre: null,
      workOrderId: null,
    },
  };
}

const summary = (verb: string, number: string, staff: string, month: ISODate, net: Cents) => `${verb} salary payment ${number}: ${staff}, ${formatMonth(month)}, net ${formatMoney(net)}`;

/** Translates the database's one-salary-per-month constraint (concurrent saves) into a message. */
function rethrow(e: unknown): never {
  if (String((e as Error)?.message ?? "").includes("Expense_one_salary_per_staff_month")) {
    throw new BusinessError("A salary payment for this staff member and month already exists. Correct that record instead.");
  }
  if (e instanceof BusinessError) throw e;
  const known = describeDbError(e);
  throw known ? new BusinessError(known) : e;
}

/** Records a salary payment as a draft, or submits it for approval. Never approves it. */
export async function recordSalaryPayment(actor: Actor, input: SalaryInput, submit: boolean, { documentIds = [] }: { documentIds?: string[] } = {}) {
  requireRecording(actor);
  const building = await getBuilding();
  try {
    return await db.$transaction(async (tx) => {
      const { staff, period, net, data } = await salaryFields(tx, input, null);
      const number = await nextNumber(tx, "EXP", "EXP", Number(todayISO().slice(0, 4)));
      const e = await tx.expense.create({
        data: { number, buildingId: building.id, ...data, createdById: actor.id, status: submit ? "SUBMITTED" : "DRAFT", submittedById: submit ? actor.id : null, submittedAt: submit ? new Date() : null },
      });
      await audit(tx, actor, {
        action: submit ? "salary.submit" : "salary.draft",
        entityType: "Expense",
        entityId: e.id,
        summary: summary(submit ? "Submitted" : "Drafted", number, staff.fullName, period.start, net),
        after: { ...data, servicePeriodStart: period.start, servicePeriodEnd: period.end },
      });
      await attachStaged(tx, actor, documentIds, "EXPENSE", e.id);
      return e;
    });
  } catch (e) {
    rethrow(e);
  }
}

/** Edits a draft salary payment (and optionally submits it). A rejected one is corrected by recording a copy. */
export async function updateSalaryPayment(actor: Actor, id: string, input: SalaryInput, submit: boolean) {
  requireRecording(actor);
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Expense" WHERE id = ${id} FOR UPDATE`;
      const before = await tx.expense.findUniqueOrThrow({ where: { id } });
      if (before.category !== "SALARIES") throw new BusinessError("This is not a salary payment.");
      if (before.status === "REJECTED") throw new BusinessError("A rejected salary payment is kept as it was decided. Record a corrected copy instead (the month is free again).");
      if (before.status !== "DRAFT") throw new BusinessError("Only a draft salary payment can be edited.");
      const { staff, period, net, data } = await salaryFields(tx, input, id);
      const after = await tx.expense.update({
        where: { id },
        data: { ...data, status: submit ? "SUBMITTED" : "DRAFT", submittedById: submit ? actor.id : null, submittedAt: submit ? new Date() : null, decidedById: null, decidedAt: null, decisionReason: null },
      });
      await audit(tx, actor, { action: submit ? "salary.submit" : "salary.edit", entityType: "Expense", entityId: id, summary: summary(submit ? "Submitted" : "Edited", before.number, staff.fullName, period.start, net), before, after });
      return after;
    });
  } catch (e) {
    rethrow(e);
  }
}

/**
 * Deletes a draft salary payment (never submitted, so it never counted anywhere). Anything past
 * draft is kept and corrected through rejection and a corrected copy; the database refuses
 * deleting it too. The deletion is audited with the draft's details.
 */
export async function deleteSalaryDraft(actor: Actor, id: string) {
  requireRecording(actor);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Expense" WHERE id = ${id} FOR UPDATE`;
    const e = await tx.expense.findUniqueOrThrow({ where: { id } });
    if (e.category !== "SALARIES") throw new BusinessError("This is not a salary payment.");
    if (e.status !== "DRAFT") throw new BusinessError("Only a draft salary payment can be deleted. Submitted, approved, paid and rejected ones are kept for the record.");
    if (await tx.document.count({ where: { ownerType: "EXPENSE", ownerId: id, removedAt: null } })) {
      throw new BusinessError("This draft has documents attached. Remove them first, or keep the draft.");
    }
    await tx.expense.delete({ where: { id } });
    await audit(tx, actor, { action: "salary.draft_delete", entityType: "Expense", entityId: id, summary: `Deleted draft salary payment ${e.number} (${e.payee}, net ${formatMoney(cents(e.amount)!)})`, before: e });
  });
}

function toRow(e: Awaited<ReturnType<typeof loadSalaries>>[number]) {
  return {
    id: e.id,
    number: e.number,
    status: e.status,
    staff: e.staffMember ? { id: e.staffMember.id, fullName: e.staffMember.fullName, position: e.staffMember.position } : null,
    payee: e.payee,
    month: optionalFromDbDate(e.servicePeriodStart),
    gross: cents(e.salaryGross),
    allowances: cents(e.salaryAllowances),
    deductions: cents(e.salaryDeductions),
    net: cents(e.amount)!,
    description: e.description,
    paidDate: expensePaidDate(e),
    paymentMethod: e.paymentMethod,
    paymentReference: e.paymentReference,
    submittedAt: e.submittedAt,
    createdById: e.createdById,
    submittedById: e.submittedById,
    createdAt: e.createdAt,
  };
}

function loadSalaries(where: object) {
  return db.expense.findMany({ where: { category: "SALARIES", ...where }, include: { staffMember: true }, orderBy: [{ servicePeriodStart: "desc" }, { createdAt: "desc" }] });
}

export type SalaryRow = ReturnType<typeof toRow>;

/** Salary payment history, filtered by staff member, month and status. Salary access only. */
export async function listSalaryPayments(actor: Actor, filter: { staffMemberId?: string; month?: ISODate; status?: SalaryStatus } = {}) {
  requirePermission(actor, "salary.view");
  const rows = (
    await loadSalaries({
      ...(filter.staffMemberId ? { staffMemberId: filter.staffMemberId } : {}),
      ...(filter.month ? { servicePeriodStart: toDbDate(salaryPeriod(filter.month).start) } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    })
  ).map(toRow);
  const total = (statuses: SalaryStatus[]) => sumCents(rows.filter((r) => statuses.includes(r.status)).map((r) => r.net));
  return { rows, totals: { draft: total(["DRAFT"]), pending: total(["SUBMITTED"]), approvedUnpaid: total(["APPROVED"]), paid: total(["PAID"]), rejected: total(["REJECTED"]) } };
}

export async function getSalaryPayment(actor: Actor, id: string) {
  requirePermission(actor, "salary.view");
  const e = await db.expense.findUnique({ where: { id }, include: { staffMember: true } });
  if (!e || e.category !== "SALARIES") return null;
  const [users, history] = await Promise.all([
    userNames([e.createdById, e.submittedById, e.decidedById, e.paidById]),
    // This record's own audit trail, for everyone allowed to see the salary (the full log needs audit access).
    db.auditEvent.findMany({ where: { entityType: "Expense", entityId: id }, orderBy: { id: "asc" }, select: { id: true, occurredAt: true, actorEmail: true, action: true, summary: true, reason: true } }),
  ]);
  return { expense: e, row: toRow(e), users, history };
}

/**
 * Salary management for one month: every staff member employed that month, their agreed monthly
 * salary, and the salary payment recorded for the month (if any), plus the latest paid month.
 */
export async function salaryOverview(actor: Actor, month: ISODate) {
  requirePermission(actor, "salary.view");
  const period = salaryPeriod(month);
  const [staff, records, paid] = await Promise.all([
    db.staffMember.findMany({ orderBy: { fullName: "asc" } }),
    db.expense.findMany({ where: { category: "SALARIES", servicePeriodStart: toDbDate(period.start), status: { not: "REJECTED" } } }),
    db.expense.groupBy({ by: ["staffMemberId"], where: { category: "SALARIES", status: "PAID" }, _max: { servicePeriodStart: true } }),
  ]);
  const lastPaid = new Map(paid.map((p) => [p.staffMemberId, p._max.servicePeriodStart]));
  const rows = staff
    .map((s) => {
      const record = records.find((r) => r.staffMemberId === s.id) ?? null;
      const employed = employedDuring({ startDate: optionalFromDbDate(s.startDate), endDate: optionalFromDbDate(s.endDate) }, period.start);
      return {
        id: s.id,
        fullName: s.fullName,
        position: s.position,
        employed,
        agreedSalary: cents(s.salaryAmount),
        record: record ? { id: record.id, number: record.number, status: record.status, net: cents(record.amount)! } : null,
        lastPaidMonth: lastPaid.get(s.id) ? fromDbDate(lastPaid.get(s.id)!) : null,
      };
    })
    .filter((r) => r.employed || r.record);
  return {
    month: period.start,
    isCurrentOrPast: period.start <= monthStart(todayISO()),
    rows,
    agreedTotal: sumCents(rows.filter((r) => r.employed).map((r) => r.agreedSalary ?? 0)),
    notRecorded: rows.filter((r) => r.employed && !r.record).length,
  };
}

// Invoices, credit notes, payments, allocations and receipts.
//
// Posted records are never edited or deleted (enforced again by database triggers).
// Payments only affect balances after verification by someone other than the person
// who recorded them (a System Administrator may verify their own under the audited
// self-approval exception, see self-approval.ts). Allocation is always chosen by staff: no automatic order
// (oldest-first etc.) is applied because no allocation rule has been approved.
// Unallocated money stays visible on the payment for review; it is not turned into a
// credit or refund automatically (overpayment treatment is unresolved).

import { db, type DbOrTx, type Tx } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import type { ChargeCategory } from "@/generated/prisma/enums";
import { audit } from "@/server/audit";
import { checkSelfException, otherHolders, SELF_EXCEPTION, SELF_EXCEPTION_MIN_REASON, selfExceptionHint, type SelfException } from "@/server/services/self-approval";
import { BusinessError, requirePermission, type Actor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { cents, describeDbError, getBuilding, lockActiveParty, nextNumber } from "@/server/services/common";
import { attachStaged } from "@/server/services/documents";
import { compareByBillingPeriod, invoiceBalance, invoicePaymentStatus, dueState } from "@/server/ledger";
import { centsToDecimalString, formatMoney, sumCents, type Cents } from "@/lib/money";
import { fromDbDate, optionalFromDbDate, toDbDate, todayISO, type ISODate } from "@/lib/dates";

// ---------------------------------------------------------------- invoice reads

const invoiceInclude = {
  party: { select: { id: true, displayName: true } },
  unit: { select: { id: true, unitNumber: true } },
  agreement: { select: { id: true, type: true, graceDays: true } },
  allocations: { where: { reversedAt: null }, select: { amount: true } },
  creditNotes: { select: { amount: true } },
  lines: { select: { category: true } },
} as const;

type InvoiceWithAmounts = Omit<Awaited<ReturnType<typeof loadInvoices>>[number], "lines"> & { lines?: { category: ChargeCategory }[] };

async function loadInvoices(where: Prisma.InvoiceWhereInput) {
  return db.invoice.findMany({ where, include: invoiceInclude, orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }] });
}

export function summarizeInvoice(inv: InvoiceWithAmounts, today = todayISO()) {
  const amounts = {
    total: cents(inv.total)!,
    allocated: sumCents(inv.allocations.map((a) => cents(a.amount)!)),
    credited: sumCents(inv.creditNotes.map((c) => cents(c.amount)!)),
  };
  const balance = invoiceBalance(amounts);
  return {
    id: inv.id,
    number: inv.number,
    kind: inv.kind,
    status: inv.status,
    party: inv.party,
    unit: inv.unit,
    agreementId: inv.agreementId,
    agreementType: inv.agreement?.type ?? null,
    periodStart: optionalFromDbDate(inv.periodStart),
    periodEnd: optionalFromDbDate(inv.periodEnd),
    issueDate: optionalFromDbDate(inv.issueDate),
    dueDate: optionalFromDbDate(inv.dueDate),
    ...amounts,
    balance,
    /** The charge types on the invoice, in the usual order (rent first). */
    chargeTypes: CHARGE_ORDER.filter((c) => inv.lines?.some((l) => l.category === c)),
    paymentStatus: inv.status === "DRAFT" ? ("DRAFT" as const) : invoicePaymentStatus(amounts),
    dueState: inv.status === "DRAFT" ? null : dueState(balance, optionalFromDbDate(inv.dueDate), inv.agreement?.graceDays ?? null, today),
  };
}

export type InvoiceSummary = ReturnType<typeof summarizeInvoice>;

const CHARGE_ORDER: ChargeCategory[] = ["RENT", "SERVICE_CHARGE", "SHARED_CHARGE", "MANAGEMENT_FEE", "OTHER"];

export type InvoiceFilter = "UNPAID" | "PART_PAID" | "PAID" | "DRAFT" | "PAST_DUE" | "OPEN" | "";
export const INVOICE_SORTS = { newest: "Newest first", oldest: "Oldest first", due: "Due date", balance: "Largest outstanding", account: "Account A–Z" } as const;
export type InvoiceSort = keyof typeof INVOICE_SORTS;

export interface InvoiceListFilter {
  status?: InvoiceFilter;
  partyId?: string;
  q?: string;
  /** Billing date range: the billing month for monthly invoices, the issue date for manual ones. */
  from?: ISODate;
  to?: ISODate;
  unitId?: string;
  agreementType?: "RENTAL" | "OWNERSHIP" | "MANAGEMENT" | "NONE";
  category?: ChargeCategory;
  dueFrom?: ISODate;
  dueTo?: ISODate;
  /** Only invoices with at least this much still owed. */
  minBalance?: Cents;
  sort?: InvoiceSort;
}

/**
 * Lists invoices. `from`/`to` filter on the billing date: the billing month for monthly
 * invoices, the issue date for manual ones (the same definition the dashboard uses).
 */
export async function listInvoices(actor: Actor, filter: InvoiceListFilter = {}) {
  requirePermission(actor, "invoices.view");
  const rows = await loadInvoices({
    ...(filter.partyId ? { partyId: filter.partyId } : {}),
    ...(filter.status === "DRAFT" ? { status: "DRAFT" } : {}),
    ...(filter.unitId ? { unitId: filter.unitId } : {}),
    ...(filter.agreementType === "NONE" ? { agreementId: null } : filter.agreementType ? { agreement: { type: filter.agreementType } } : {}),
    ...(filter.category ? { lines: { some: { category: filter.category } } } : {}),
    ...(filter.dueFrom || filter.dueTo ? { dueDate: { ...(filter.dueFrom ? { gte: toDbDate(filter.dueFrom) } : {}), ...(filter.dueTo ? { lte: toDbDate(filter.dueTo) } : {}) } } : {}),
    ...(filter.q
      ? { OR: [{ number: { contains: filter.q, mode: "insensitive" } }, { party: { displayName: { contains: filter.q, mode: "insensitive" } } }, { unit: { unitNumber: { contains: filter.q, mode: "insensitive" } } }] }
      : {}),
  });
  const today = todayISO();
  let list = rows.map((r) => summarizeInvoice(r, today));
  if (filter.minBalance != null) list = list.filter((i) => i.status === "ISSUED" && i.balance >= filter.minBalance!);
  if (filter.sort && filter.sort !== "newest") {
    const by: Record<Exclude<InvoiceSort, "newest">, (a: InvoiceSummary, b: InvoiceSummary) => number> = {
      oldest: (a, b) => (a.issueDate ?? "9999").localeCompare(b.issueDate ?? "9999") || (a.number ?? "").localeCompare(b.number ?? ""),
      due: (a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"),
      balance: (a, b) => b.balance - a.balance,
      account: (a, b) => a.party.displayName.localeCompare(b.party.displayName, undefined, { sensitivity: "base" }),
    };
    list = [...list].sort(by[filter.sort]);
  }
  if (filter.from || filter.to) {
    list = list.filter((i) => {
      const d = i.periodStart ?? i.issueDate;
      return d != null && (!filter.from || d >= filter.from) && (!filter.to || d <= filter.to);
    });
  }
  switch (filter.status) {
    case "UNPAID":
    case "PART_PAID":
    case "PAID":
      return list.filter((i) => i.status === "ISSUED" && i.paymentStatus === filter.status);
    case "OPEN":
      return list.filter((i) => i.status === "ISSUED" && i.balance > 0);
    case "PAST_DUE":
      return list.filter((i) => i.status === "ISSUED" && i.balance > 0 && i.dueDate != null && i.dueDate < today);
    default:
      return list;
  }
}

/**
 * The Billing & Payments summary cards (F65). Period figures cover the invoices billed in the
 * period (billing month, or issue date for manual invoices); the outstanding balance is every issued
 * invoice still owed today, whatever its period. Unallocated money is shown apart and reduces nothing.
 */
export async function billingSummary(actor: Actor, period: { from: ISODate; to: ISODate } | null) {
  requirePermission(actor, "invoices.view");
  const today = todayISO();
  const [issued, inForce, payments] = await Promise.all([
    loadInvoices({ status: "ISSUED" }),
    db.agreement.findMany({
      where: { status: { not: "CANCELLED" }, startDate: { lte: toDbDate(today) }, OR: [{ endDate: null }, { endDate: { gte: toDbDate(today) } }], party: { archivedAt: null } },
      select: { partyId: true, type: true },
    }),
    can(actor.role, "payments.view") ? db.payment.findMany({ where: { status: "VERIFIED" }, select: { amount: true, allocations: { where: { reversedAt: null }, select: { amount: true } } } }) : Promise.resolve(null),
  ]);
  const all = issued.map((i) => summarizeInvoice(i, today));
  const inPeriod = period ? all.filter((i) => {
    const d = i.periodStart ?? i.issueDate;
    return d != null && d >= period.from && d <= period.to;
  }) : all;
  const open = all.filter((i) => i.balance > 0);
  const tenants = new Set(inForce.filter((a) => a.type === "RENTAL").map((a) => a.partyId));
  const otherAccounts = new Set(inForce.filter((a) => a.type !== "RENTAL" && !tenants.has(a.partyId)).map((a) => a.partyId));
  return {
    /** Rent-paying tenants: accounts (not archived) with a rental agreement in force today, each counted once. */
    tenants: tenants.size,
    /** Purchased-unit owners and managed owners with an agreement in force today (not counted as tenants). */
    otherAccounts: otherAccounts.size,
    billed: sumCents(inPeriod.map((i) => i.total)),
    invoiceCount: inPeriod.length,
    paid: sumCents(inPeriod.map((i) => i.allocated)),
    credited: sumCents(inPeriod.map((i) => i.credited)),
    periodOutstanding: sumCents(inPeriod.map((i) => i.balance)),
    outstanding: sumCents(open.map((i) => i.balance)),
    pastDue: sumCents(open.filter((i) => i.dueDate != null && i.dueDate < today).map((i) => i.balance)),
    openInvoices: open.length,
    /** Units with at least one issued invoice (the list's unit filter). */
    units: [...new Map(all.map((i) => [i.unit.id, i.unit])).values()].sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true })),
    /** Verified money not applied to any invoice (null without payment access): not a reduction of any balance. */
    unallocated: payments ? sumCents(payments.map((p) => cents(p.amount)! - sumCents(p.allocations.map((a) => cents(a.amount)!)))) : null,
  };
}

export async function getInvoice(actor: Actor, id: string) {
  requirePermission(actor, "invoices.view");
  const inv = await db.invoice.findUnique({
    where: { id },
    include: {
      ...invoiceInclude,
      lines: true,
      creditNotes: { orderBy: { createdAt: "asc" } },
      allocations: { include: { payment: true }, orderBy: { createdAt: "asc" } },
      building: true,
    },
  });
  if (!inv) return null;
  const summary = summarizeInvoice({
    ...inv,
    allocations: inv.allocations.filter((a) => !a.reversedAt).map((a) => ({ amount: a.amount })),
    creditNotes: inv.creditNotes.map((c) => ({ amount: c.amount })),
  });
  const users = await userNames([inv.createdById, inv.issuedById, ...inv.creditNotes.map((c) => c.createdById)]);
  return { invoice: inv, summary, users };
}

export async function userNames(ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

/** Issued invoices of a party that still have a balance (for allocation), oldest billing period first. */
export async function openInvoicesForParty(partyId: string) {
  const rows = await loadInvoices({ partyId, status: "ISSUED" });
  return rows.map((r) => summarizeInvoice(r)).filter((i) => i.balance > 0).sort(compareByBillingPeriod);
}

// ---------------------------------------------------------------- manual invoices

export interface ManualInvoiceInput {
  partyId: string;
  unitId: string;
  agreementId: string | null;
  notes: string | null;
  dueDate: ISODate;
  lines: { category: "RENT" | "MANAGEMENT_FEE" | "SERVICE_CHARGE" | "SHARED_CHARGE" | "OTHER"; description: string; amount: Cents }[];
}

/**
 * Creates a DRAFT manual invoice (e.g. a final settlement under proposed Rule 8, or an
 * authorised one-off charge). It has no effect on balances until another authorised
 * person reviews and issues it.
 */
export async function createManualInvoice(actor: Actor, input: ManualInvoiceInput, { issue = false }: { issue?: boolean } = {}) {
  requirePermission(actor, "invoices.create_manual");
  // Single-operator mode (F49): someone who may both create and issue manual invoices saves and issues in one step.
  if (issue) requirePermission(actor, "invoices.issue_manual");
  if (input.lines.length === 0) throw new BusinessError("Add at least one invoice line.");
  const issueDate = todayISO();
  if (issue && input.dueDate < issueDate) throw new BusinessError("The due date cannot be before the invoice date (today).");
  if (input.agreementId) {
    const ag = await db.agreement.findUnique({ where: { id: input.agreementId } });
    if (!ag || ag.partyId !== input.partyId || ag.unitId !== input.unitId || ag.status === "CANCELLED") throw new BusinessError("The selected agreement does not match this account and unit.");
  }
  await checkLineCategories(db, input.lines, input.agreementId);
  const building = await getBuilding();
  const total = sumCents(input.lines.map((l) => l.amount));
  return db.$transaction(async (tx) => {
    await lockActiveParty(tx, input.partyId);
    // The form offers only the account's own units; a unit it has no agreement on is refused whatever is submitted.
    if (!input.agreementId && !(await tx.agreement.count({ where: { partyId: input.partyId, unitId: input.unitId, status: { not: "CANCELLED" } } }))) {
      throw new BusinessError("This account has no agreement on the selected unit. Choose one of the account's units.");
    }
    const inv = await tx.invoice.create({
      data: {
        buildingId: building.id,
        partyId: input.partyId,
        unitId: input.unitId,
        agreementId: input.agreementId,
        kind: "MANUAL",
        status: "DRAFT",
        dueDate: toDbDate(input.dueDate),
        total: centsToDecimalString(total),
        notes: input.notes,
        createdById: actor.id,
        lines: { create: input.lines.map((l) => ({ ...l, amount: centsToDecimalString(l.amount), sourceType: "MANUAL" })) },
      },
    });
    await audit(tx, actor, {
      action: "invoice.draft_create",
      entityType: "Invoice",
      entityId: inv.id,
      summary: `Drafted manual invoice for ${formatMoney(total)}`,
      after: { ...input, lines: input.lines.map((l) => ({ ...l, amount: centsToDecimalString(l.amount) })) },
    });
    if (issue) {
      // Lines are added while the invoice is a draft (issued lines are immutable), then it is issued in the same transaction.
      const number = await nextNumber(tx, "INV", "INV", Number(issueDate.slice(0, 4)));
      const issued = await tx.invoice.update({ where: { id: inv.id }, data: { status: "ISSUED", number, issueDate: toDbDate(issueDate), issuedById: actor.id, issuedAt: new Date() } });
      await audit(tx, actor, {
        action: "invoice.issue_manual",
        entityType: "Invoice",
        entityId: inv.id,
        summary: `Created and issued manual invoice ${number} for ${formatMoney(total)} in one step (single-operator)`,
        after: { number, issueDate, dueDate: input.dueDate, total: centsToDecimalString(total), createdById: actor.id, issuedById: actor.id },
      });
      return issued;
    }
    return inv;
  });
}

/**
 * Rent is charged only under a rental agreement and a management fee only under a management
 * agreement (owners are never charged rent; C9, F27). Checked when a manual invoice is drafted and
 * again when it is issued, so an older draft cannot be issued with the wrong charge either.
 */
async function checkLineCategories(tx: DbOrTx, lines: { category: string }[], agreementId: string | null) {
  const needs = { RENT: ["RENTAL", "Rent"], MANAGEMENT_FEE: ["MANAGEMENT", "A management fee"] } as const;
  const wanted = [...new Set(lines.map((l) => l.category))].filter((c): c is keyof typeof needs => c in needs);
  if (!wanted.length) return;
  const ag = agreementId ? await tx.agreement.findUnique({ where: { id: agreementId }, select: { type: true } }) : null;
  for (const c of wanted) {
    const [type, label] = needs[c];
    if (ag?.type !== type) {
      throw new BusinessError(`${label} can only be invoiced under the account's ${type === "RENTAL" ? "rental" : "management"} agreement for this unit${ag ? `; this invoice is for a${ag.type === "OWNERSHIP" ? "n ownership record" : ag.type === "RENTAL" ? " rental agreement" : " management agreement"}` : ""}. Use another category (e.g. Other) for an approved one-off charge.`);
    }
  }
}

/**
 * Reviews and issues a draft manual invoice. The issuer must not be its creator, except a
 * System Administrator issuing their own draft under the audited self-approval exception.
 */
export async function issueManualInvoice(actor: Actor, id: string, self?: SelfException) {
  requirePermission(actor, "invoices.issue_manual");
  const issueDate = todayISO();
  return db.$transaction(async (tx) => {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    if (inv.status !== "DRAFT") throw new BusinessError("Only a draft invoice can be issued.");
    await checkLineCategories(tx, inv.lines, inv.agreementId);
    const own = inv.createdById === actor.id;
    if (own && !self) throw new BusinessError(`A manual invoice must be reviewed and issued by someone other than the person who drafted it.${selfExceptionHint(actor)}`);
    if (!own && self) throw new BusinessError("The self-approval exception only applies to a draft you created. Issue this one normally.");
    const reason = self ? checkSelfException(actor, self) : null;
    const number = await nextNumber(tx, "INV", "INV", Number(issueDate.slice(0, 4)));
    const dueDate = inv.dueDate && fromDbDate(inv.dueDate) < issueDate ? toDbDate(issueDate) : inv.dueDate;
    const after = await tx.invoice.update({
      where: { id },
      data: { status: "ISSUED", number, issueDate: toDbDate(issueDate), dueDate, issuedById: actor.id, issuedAt: new Date() },
    });
    if (reason) {
      await audit(tx, actor, {
        action: "invoice.issue_self_exception",
        entityType: "Invoice",
        entityId: id,
        summary: `Issued own manual invoice ${number} for ${formatMoney(cents(inv.total)!)} under the administrator self-approval exception`,
        reason,
        after: { exception: SELF_EXCEPTION, createdById: inv.createdById, createdAt: inv.createdAt, issuedById: actor.id, issuedAt: after.issuedAt, otherActiveIssuers: await otherHolders(tx, actor.id, "invoices.issue_manual"), number, total: String(inv.total) },
      });
    } else {
      await audit(tx, actor, { action: "invoice.issue_manual", entityType: "Invoice", entityId: id, summary: `Issued manual invoice ${number} for ${formatMoney(cents(inv.total)!)}` });
    }
    return after;
  });
}

export async function discardDraftInvoice(actor: Actor, id: string, reason: string | null = null) {
  requirePermission(actor, "invoices.create_manual");
  return db.$transaction(async (tx) => {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    if (inv.status !== "DRAFT") throw new BusinessError("Only drafts can be discarded. Issued invoices are corrected with a credit note.");
    await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
    await tx.invoice.delete({ where: { id } });
    await audit(tx, actor, { action: "invoice.draft_discard", entityType: "Invoice", entityId: id, summary: "Discarded a draft manual invoice", before: inv, reason: reason?.trim() || null });
  });
}

/** For old links to a discarded draft (audit log, activity): who discarded it, when and why. */
export async function findDiscardedInvoice(actor: Actor, id: string) {
  requirePermission(actor, "invoices.view");
  return db.auditEvent.findFirst({
    where: { entityType: "Invoice", entityId: id, action: "invoice.draft_discard" },
    orderBy: { id: "desc" },
    select: { occurredAt: true, actorEmail: true, reason: true },
  });
}

// ---------------------------------------------------------------- credit notes

async function lockInvoiceAmounts(tx: Tx, invoiceId: string) {
  await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
  const inv = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { allocations: { where: { reversedAt: null } }, creditNotes: true },
  });
  const amounts = {
    total: cents(inv.total)!,
    allocated: sumCents(inv.allocations.map((a) => cents(a.amount)!)),
    credited: sumCents(inv.creditNotes.map((c) => cents(c.amount)!)),
  };
  return { inv, balance: invoiceBalance(amounts) };
}

/** Reduces an issued invoice's balance with a traceable credit note (never by editing it). */
export async function createCreditNote(actor: Actor, invoiceId: string, amount: Cents, reason: string) {
  requirePermission(actor, "credits.create");
  if (!reason.trim()) throw new BusinessError("A reason is required for a credit note.");
  return db.$transaction(async (tx) => {
    const { inv, balance } = await lockInvoiceAmounts(tx, invoiceId);
    if (inv.status !== "ISSUED") throw new BusinessError("Credit notes apply only to issued invoices.");
    if (amount > balance) throw new BusinessError(`The credit note cannot exceed the invoice's outstanding balance (${formatMoney(balance)}).`);
    const number = await nextNumber(tx, "CN", "CN", Number(todayISO().slice(0, 4)));
    const cn = await tx.creditNote.create({ data: { number, invoiceId, amount: centsToDecimalString(amount), reason, createdById: actor.id } });
    await audit(tx, actor, { action: "credit_note.create", entityType: "Invoice", entityId: invoiceId, summary: `Credit note ${number} of ${formatMoney(amount)} on ${inv.number}`, reason });
    return cn;
  });
}

// ---------------------------------------------------------------- payments

export interface PaymentInput {
  partyId: string;
  method: "MPESA" | "BANK" | "CASH";
  reference: string;
  amount: Cents;
  receivedDate: ISODate;
  evidenceNote: string | null;
}

/** Records a payment as PENDING. It does not change any balance until verified. */
/**
 * Credit notes, read-only, newest first. Each stays attached to its invoice (this only lists the
 * existing records); dated by the day it was issued, the same date the ledger uses.
 */
export async function listCreditNotes(actor: Actor, filter: { q?: string; from?: ISODate; to?: ISODate } = {}) {
  requirePermission(actor, "invoices.view");
  const notes = await db.creditNote.findMany({
    include: { invoice: { select: { id: true, number: true, party: { select: { id: true, displayName: true } }, unit: { select: { unitNumber: true } } } } },
    orderBy: { createdAt: "desc" },
  });
  const users = await userNames(notes.map((n) => n.createdById));
  const q = filter.q?.trim().toLowerCase();
  return notes
    .map((n) => ({
      id: n.id,
      number: n.number,
      date: todayISO(n.createdAt),
      amount: cents(n.amount)!,
      reason: n.reason,
      createdBy: users.get(n.createdById) ?? "—",
      invoice: { id: n.invoice.id, number: n.invoice.number },
      party: n.invoice.party,
      unitNumber: n.invoice.unit.unitNumber,
    }))
    .filter((n) => (!filter.from || n.date >= filter.from) && (!filter.to || n.date <= filter.to))
    .filter((n) => !q || [n.number, n.reason, n.invoice.number ?? "", n.party.displayName, n.unitNumber].some((v) => v.toLowerCase().includes(q)));
}

export async function recordPayment(
  actor: Actor,
  input: PaymentInput,
  { documentIds = [], verify = false, allocations = [] }: { documentIds?: string[]; verify?: boolean; allocations?: { invoiceId: string; amount: Cents }[] } = {},
) {
  requirePermission(actor, "payments.record");
  // Single-operator mode (F49): someone who may both record and verify records a verified payment in one
  // step and may allocate it at once. Everyone else records it pending, for verification as before.
  if (verify) requirePermission(actor, "payments.verify");
  const wanted = allocations.filter((a) => a.amount > 0);
  if (wanted.length && !verify) throw new BusinessError("Only a verified payment can be allocated.");
  if (wanted.length) requirePermission(actor, "payments.allocate");
  if (new Set(wanted.map((a) => a.invoiceId)).size !== wanted.length) throw new BusinessError("Each invoice can appear only once.");
  if (input.receivedDate > todayISO()) throw new BusinessError("The received date cannot be in the future.");
  const building = await getBuilding();
  const reference = input.reference.trim().toUpperCase();
  try {
    return await db.$transaction(async (tx) => {
      await lockActiveParty(tx, input.partyId);
      const p = await tx.payment.create({
        data: {
          buildingId: building.id,
          partyId: input.partyId,
          method: input.method,
          reference,
          amount: centsToDecimalString(input.amount),
          receivedDate: toDbDate(input.receivedDate),
          evidenceNote: input.evidenceNote,
          recordedById: actor.id,
          ...(verify ? { status: "VERIFIED" as const, verifiedById: actor.id, verifiedAt: new Date(), receiptNumber: await nextNumber(tx, "RCT", "RCT", Number(todayISO().slice(0, 4))) } : {}),
        },
        include: { party: true },
      });
      await audit(tx, actor, {
        action: verify ? "payment.record_verified" : "payment.record",
        entityType: "Payment",
        entityId: p.id,
        summary: verify
          ? `Recorded and verified ${input.method} payment ${reference} of ${formatMoney(input.amount)} from ${p.party.displayName} in one step (single-operator); receipt ${p.receiptNumber}`
          : `Recorded pending ${input.method} payment ${reference} of ${formatMoney(input.amount)} from ${p.party.displayName}`,
        after: { ...input, reference, amount: centsToDecimalString(input.amount), ...(verify ? { status: "VERIFIED", verifiedById: actor.id, receiptNumber: p.receiptNumber } : {}) },
      });
      await attachStaged(tx, actor, documentIds, "PAYMENT", p.id);
      if (wanted.length) await applyAllocations(tx, actor, p.id, wanted);
      return p;
    });
  } catch (e) {
    if (e instanceof BusinessError) throw e;
    const msg = describeDbError(e);
    if (msg === "A record with these details already exists.") {
      throw new BusinessError(`A ${input.method} payment with reference ${reference} has already been recorded. Duplicate payments are not allowed.`);
    }
    throw new BusinessError(msg ?? "Could not record the payment.");
  }
}

export async function listPayments(actor: Actor, filter: { status?: string; partyId?: string; q?: string; from?: ISODate; to?: ISODate } = {}) {
  requirePermission(actor, "payments.view");
  const rows = await db.payment.findMany({
    where: {
      ...(filter.status ? { status: filter.status as "PENDING" } : {}),
      ...(filter.partyId ? { partyId: filter.partyId } : {}),
      ...(filter.q ? { OR: [{ reference: { contains: filter.q, mode: "insensitive" } }, { receiptNumber: { contains: filter.q, mode: "insensitive" } }, { party: { displayName: { contains: filter.q, mode: "insensitive" } } }] } : {}),
      ...(filter.from || filter.to ? { receivedDate: { ...(filter.from ? { gte: toDbDate(filter.from) } : {}), ...(filter.to ? { lte: toDbDate(filter.to) } : {}) } } : {}),
    },
    include: {
      party: { select: { id: true, displayName: true, agreements: { where: { status: "ACTIVE" }, select: { unit: { select: { id: true, unitNumber: true } } } } } },
      allocations: { where: { reversedAt: null }, select: { amount: true, invoice: { select: { id: true, number: true, unit: { select: { id: true, unitNumber: true } } } } } },
    },
    orderBy: [{ receivedDate: "desc" }, { recordedAt: "desc" }],
  });
  return rows.map(({ party: { agreements, ...party }, ...p }) => {
    const amount = cents(p.amount)!;
    const allocated = sumCents(p.allocations.map((a) => cents(a.amount)!));
    // A payment has no unit of its own: the units of the invoices it paid, otherwise the account's units in force.
    const paidUnits = p.allocations.map((a) => a.invoice.unit);
    const units = [...new Map((paidUnits.length ? paidUnits : agreements.map((a) => a.unit)).map((u) => [u.id, u])).values()];
    const invoices = [...new Map(p.allocations.map((a) => [a.invoice.id, { id: a.invoice.id, number: a.invoice.number }])).values()];
    return { ...p, party, units, invoices, amountCents: amount, allocated, unallocated: p.status === "VERIFIED" ? amount - allocated : 0 };
  });
}

export async function getPayment(actor: Actor, id: string) {
  requirePermission(actor, "payments.view");
  const p = await db.payment.findUnique({
    where: { id },
    include: { party: true, building: true, allocations: { include: { invoice: { include: { unit: true } } }, orderBy: { createdAt: "asc" } } },
  });
  if (!p) return null;
  const amount = cents(p.amount)!;
  const allocated = sumCents(p.allocations.filter((a) => !a.reversedAt).map((a) => cents(a.amount)!));
  const users = await userNames([p.recordedById, p.verifiedById, p.rejectedById, p.reversedById, ...p.allocations.map((a) => a.createdById)]);
  return { payment: p, amount, allocated, unallocated: p.status === "VERIFIED" ? amount - allocated : 0, users };
}

/** Verifies a pending payment and issues its receipt. Uploaded proof alone is not confirmation. */
export async function verifyPayment(actor: Actor, id: string) {
  requirePermission(actor, "payments.verify");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${id} FOR UPDATE`;
    const p = await tx.payment.findUniqueOrThrow({ where: { id } });
    if (p.status !== "PENDING") throw new BusinessError(`This payment is already ${p.status.toLowerCase()}.`);
    if (p.recordedById === actor.id) throw new BusinessError(`A payment must be verified by someone other than the person who recorded it.${selfExceptionHint(actor)}`);
    const receiptNumber = await nextNumber(tx, "RCT", "RCT", Number(todayISO().slice(0, 4)));
    const after = await tx.payment.update({ where: { id }, data: { status: "VERIFIED", verifiedById: actor.id, verifiedAt: new Date(), receiptNumber } });
    await audit(tx, actor, { action: "payment.verify", entityType: "Payment", entityId: id, summary: `Verified payment ${p.reference} (${formatMoney(cents(p.amount)!)}); receipt ${receiptNumber}` });
    return after;
  });
}

// ---------------------------------------------------------------- administrator self-verification

export const SELF_VERIFY_MIN_REASON = SELF_EXCEPTION_MIN_REASON;

/**
 * Whether the actor may verify this payment themselves: only a System Administrator, only for a
 * pending payment they recorded. Other verifiers being available does not block it, but they are
 * counted, shown and audited, because independent verification is still preferred.
 */
export async function selfVerificationEligibility(actor: Actor, payment: { status: string; recordedById: string }) {
  if (!can(actor.role, "approvals.self_exception") || !can(actor.role, "payments.verify")) return { eligible: false as const, others: 0, why: "Only a System Administrator can use the self-verification exception." };
  if (payment.status !== "PENDING") return { eligible: false as const, others: 0, why: "Only a pending payment can be verified." };
  if (payment.recordedById !== actor.id) return { eligible: false as const, others: 0, why: "You did not record this payment; verify it normally." };
  const others = await otherHolders(db, actor.id, "payments.verify");
  return {
    eligible: true as const,
    others,
    why: others === 0 ? "No other active staff member can verify payments." : `${others} other active staff member(s) could verify it independently, which is preferred.`,
  };
}

/**
 * Verifies a payment that the same administrator recorded. Never automatic: it needs an explicit
 * confirmation and a reason, re-checks the payment inside the locked transaction, and writes a
 * distinct audit event with the recorder, verifier, times, reason, other available verifiers and
 * payment details. Everything else (status, receipt, balances, allocation rules) is exactly as
 * for normal verification.
 */
export async function verifyPaymentSelf(actor: Actor, id: string, input: SelfException) {
  requirePermission(actor, "payments.verify");
  const reason = checkSelfException(actor, input);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${id} FOR UPDATE`;
    const p = await tx.payment.findUniqueOrThrow({ where: { id } });
    if (p.status !== "PENDING") throw new BusinessError(`This payment is already ${p.status.toLowerCase()}.`);
    if (p.recordedById !== actor.id) throw new BusinessError("The exception only applies to payments you recorded yourself. Verify this one normally.");
    const receiptNumber = await nextNumber(tx, "RCT", "RCT", Number(todayISO().slice(0, 4)));
    const verifiedAt = new Date();
    const after = await tx.payment.update({ where: { id }, data: { status: "VERIFIED", verifiedById: actor.id, verifiedAt, receiptNumber } });
    await audit(tx, actor, {
      action: "payment.verify_self_exception",
      entityType: "Payment",
      entityId: id,
      summary: `Verified own payment ${p.reference} (${formatMoney(cents(p.amount)!)}) under the administrator self-verification exception; receipt ${receiptNumber}`,
      reason,
      after: {
        exception: SELF_EXCEPTION,
        recordedById: p.recordedById,
        recordedAt: p.recordedAt,
        verifiedById: actor.id,
        verifiedAt,
        otherActiveVerifiers: await otherHolders(tx, actor.id, "payments.verify"),
        partyId: p.partyId,
        method: p.method,
        reference: p.reference,
        amount: String(p.amount),
        receivedDate: p.receivedDate,
        receiptNumber,
      },
    });
    return after;
  });
}

/** For the payment page: the reason and time recorded when a payment was self-verified. */
export async function selfVerificationRecord(actor: Actor, paymentId: string) {
  requirePermission(actor, "payments.view");
  return db.auditEvent.findFirst({ where: { entityType: "Payment", entityId: paymentId, action: "payment.verify_self_exception" }, select: { reason: true, occurredAt: true, actorEmail: true } });
}

export async function rejectPayment(actor: Actor, id: string, reason: string) {
  requirePermission(actor, "payments.verify");
  if (!reason.trim()) throw new BusinessError("A reason is required to reject a payment.");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${id} FOR UPDATE`;
    const p = await tx.payment.findUniqueOrThrow({ where: { id } });
    if (p.status !== "PENDING") throw new BusinessError(`This payment is already ${p.status.toLowerCase()}.`);
    const after = await tx.payment.update({ where: { id }, data: { status: "REJECTED", rejectedById: actor.id, rejectedAt: new Date(), rejectionReason: reason } });
    await audit(tx, actor, { action: "payment.reject", entityType: "Payment", entityId: id, summary: `Rejected payment ${p.reference}`, reason });
    return after;
  });
}

/**
 * Allocates parts of a verified payment to the party's issued invoices, as chosen by
 * staff. Rows are locked so concurrent allocations can never exceed the payment or an
 * invoice's balance.
 */
export async function allocatePayment(actor: Actor, paymentId: string, allocations: { invoiceId: string; amount: Cents }[]) {
  requirePermission(actor, "payments.allocate");
  const wanted = allocations.filter((a) => a.amount > 0);
  if (wanted.length === 0) throw new BusinessError("Enter an amount to allocate to at least one invoice.");
  if (new Set(wanted.map((a) => a.invoiceId)).size !== wanted.length) throw new BusinessError("Each invoice can appear only once.");
  return db.$transaction((tx) => applyAllocations(tx, actor, paymentId, wanted));
}

/** Allocates part of a verified payment inside a transaction: the account's own issued invoices, never more than either balance. */
async function applyAllocations(tx: Tx, actor: Actor, paymentId: string, wanted: { invoiceId: string; amount: Cents }[]) {
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
  const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { allocations: { where: { reversedAt: null } } } });
  if (p.status !== "VERIFIED") throw new BusinessError("Only a verified payment can be allocated.");
  const unallocated = cents(p.amount)! - sumCents(p.allocations.map((a) => cents(a.amount)!));
  const requested = sumCents(wanted.map((a) => a.amount));
  if (requested > unallocated) throw new BusinessError(`Only ${formatMoney(unallocated)} of this payment is unallocated.`);
  for (const a of [...wanted].sort((x, y) => x.invoiceId.localeCompare(y.invoiceId))) {
    const { inv, balance } = await lockInvoiceAmounts(tx, a.invoiceId);
    if (inv.status !== "ISSUED") throw new BusinessError("Payments can only be allocated to issued invoices.");
    if (inv.partyId !== p.partyId) throw new BusinessError(`Invoice ${inv.number} belongs to a different account.`);
    if (a.amount > balance) throw new BusinessError(`${formatMoney(a.amount)} is more than the ${formatMoney(balance)} outstanding on ${inv.number}.`);
    await tx.paymentAllocation.create({ data: { paymentId, invoiceId: a.invoiceId, amount: centsToDecimalString(a.amount), createdById: actor.id } });
  }
  await audit(tx, actor, {
    action: "payment.allocate",
    entityType: "Payment",
    entityId: paymentId,
    summary: `Allocated ${formatMoney(requested)} of payment ${p.reference} to ${wanted.length} invoice(s)`,
    after: wanted.map((a) => ({ invoiceId: a.invoiceId, amount: centsToDecimalString(a.amount) })),
  });
}

/** Reverses a verified payment (e.g. a bounced transfer). Its allocations are reversed too. */
export async function reversePayment(actor: Actor, id: string, reason: string) {
  requirePermission(actor, "payments.reverse");
  if (!reason.trim()) throw new BusinessError("A reason is required to reverse a payment.");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${id} FOR UPDATE`;
    const p = await tx.payment.findUniqueOrThrow({ where: { id } });
    if (p.status !== "VERIFIED") throw new BusinessError("Only a verified payment can be reversed.");
    const now = new Date();
    await tx.paymentAllocation.updateMany({ where: { paymentId: id, reversedAt: null }, data: { reversedAt: now } });
    const after = await tx.payment.update({ where: { id }, data: { status: "REVERSED", reversedById: actor.id, reversedAt: now, reversalReason: reason } });
    await audit(tx, actor, { action: "payment.reverse", entityType: "Payment", entityId: id, summary: `Reversed payment ${p.reference} (${formatMoney(cents(p.amount)!)}) and its allocations`, reason });
    return after;
  });
}

export async function partyFinancialSummary(partyId: string) {
  const [invoices, payments] = await Promise.all([
    loadInvoices({ partyId, status: "ISSUED" }),
    db.payment.findMany({ where: { partyId }, include: { allocations: { where: { reversedAt: null } } }, orderBy: { receivedDate: "desc" } }),
  ]);
  const inv = invoices.map((i) => summarizeInvoice(i));
  const invoiceBalances = sumCents(inv.map((i) => i.balance));
  const unallocated = sumCents(
    payments.filter((p) => p.status === "VERIFIED").map((p) => cents(p.amount)! - sumCents(p.allocations.map((a) => cents(a.amount)!))),
  );
  return { invoices: inv, payments, invoiceBalances, unallocated, accountBalance: invoiceBalances - unallocated };
}


// ---------------------------------------------------------------- account balance

/**
 * The account balance shown by the forms, the account register and Billing & Payments (F49):
 * outstanding = what is still owed on the account's issued invoices after allocated payments and
 * credit notes; unallocated = verified money not yet applied to an invoice, shown apart (it does
 * not reduce any invoice). Same figures as the account page and statement.
 */
export async function accountBalance(actor: Actor, partyId: string) {
  requirePermission(actor, "invoices.view");
  const s = await partyFinancialSummary(partyId);
  return {
    outstanding: s.invoiceBalances,
    unallocated: s.unallocated,
    openInvoices: s.invoices
      .filter((i) => i.balance > 0)
      .sort(compareByBillingPeriod)
      .map((i) => ({ id: i.id, number: i.number, unitNumber: i.unit.unitNumber, periodStart: i.periodStart, issueDate: i.issueDate, dueDate: i.dueDate, total: i.total, paid: i.allocated, credited: i.credited, balance: i.balance })),
  };
}
export type AccountBalance = Awaited<ReturnType<typeof accountBalance>>;

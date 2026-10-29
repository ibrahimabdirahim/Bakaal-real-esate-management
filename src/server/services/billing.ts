// Billing runs and policies. The calculation itself lives in billing/compute.ts.

import { db, type DbOrTx, type Tx } from "@/server/db";
import { audit } from "@/server/audit";
import { BusinessError, requirePermission, type Actor } from "@/server/auth/actor";
import { cents, getBuilding, nextNumber } from "@/server/services/common";
import { billedKey, computeBillingPreview, LINE_CATEGORIES, type ApprovedPolicy, type BillableAgreement, type BillingPreview, type LineCategory } from "@/server/billing/compute";
import { centsToDecimalString, type Cents } from "@/lib/money";
import { fromDbDate, monthEnd, optionalFromDbDate, toDbDate, todayISO, type ISODate } from "@/lib/dates";

export async function approvedPolicies(tx: DbOrTx, buildingId: string): Promise<ApprovedPolicy[]> {
  const rows = await tx.buildingPolicy.findMany({ where: { buildingId, approvedAt: { not: null } } });
  return rows.map((p) => ({ key: p.key, value: p.value, effectiveFrom: fromDbDate(p.effectiveFrom) }));
}

/** What a billing preview or run covers: the month, the charge types (none = all) and the accounts (none = all). */
export interface BillingScope {
  categories?: LineCategory[];
  partyIds?: string[];
}

async function loadInputs(tx: DbOrTx, buildingId: string, periodStart: ISODate, partyIds: string[]) {
  const periodEnd = monthEnd(periodStart);
  const agreements = await tx.agreement.findMany({
    where: {
      buildingId,
      status: { not: "CANCELLED" },
      startDate: { lte: toDbDate(periodEnd) },
      OR: [{ endDate: null }, { endDate: { gte: toDbDate(periodStart) } }],
      ...(partyIds.length ? { partyId: { in: partyIds } } : {}),
    },
    include: { unit: true, party: true, charges: true },
  });
  const billable: BillableAgreement[] = agreements.map((a) => ({
    id: a.id,
    type: a.type,
    status: a.status,
    partyId: a.partyId,
    partyName: a.party.displayName,
    unitId: a.unitId,
    unitNumber: a.unit.unitNumber,
    startDate: fromDbDate(a.startDate),
    endDate: optionalFromDbDate(a.endDate),
    rentAmount: cents(a.rentAmount),
    managementFeeAmount: cents(a.managementFeeAmount),
    dueDay: a.dueDay,
    charges: a.charges.map((c) => ({
      id: c.id,
      category: c.category as "SERVICE_CHARGE" | "SHARED_CHARGE" | "OTHER",
      description: c.description,
      amount: cents(c.amount)!,
      effectiveFrom: fromDbDate(c.effectiveFrom),
      effectiveTo: optionalFromDbDate(c.effectiveTo),
    })),
  }));
  // Every recurring charge already billed for the month (the database keeps these unique).
  const billed = await tx.billedCharge.findMany({
    where: { periodStart: toDbDate(periodStart), agreementId: { in: billable.map((a) => a.id) } },
    select: { agreementId: true, sourceType: true, sourceId: true },
  });
  return {
    agreements: billable,
    policies: await approvedPolicies(tx, buildingId),
    alreadyBilled: new Set(billed.map((b) => billedKey(b.agreementId, b.sourceType, b.sourceId))),
  };
}

function checkPeriod(periodStart: string) {
  if (!/^\d{4}-\d{2}-01$/.test(periodStart)) throw new BusinessError("Choose a billing month.");
  const latestAllowed = `${todayISO().slice(0, 7)}-01`;
  if (periodStart > latestAllowed) throw new BusinessError("Future months cannot be billed in advance.");
}

/** The scope as sent by a page: only known charge types, and account ids that look like ids. */
function checkScope(scope: BillingScope): Required<BillingScope> {
  const categories = [...new Set(scope.categories ?? [])];
  if (categories.some((c) => !LINE_CATEGORIES.includes(c))) throw new BusinessError("Choose valid charge types.");
  const partyIds = [...new Set(scope.partyIds ?? [])];
  if (partyIds.length > 1000 || partyIds.some((id) => typeof id !== "string" || !/^[a-z0-9_-]{1,64}$/i.test(id))) throw new BusinessError("Choose valid accounts.");
  return { categories, partyIds };
}

export async function previewBilling(actor: Actor, periodStart: ISODate, scope: BillingScope = {}): Promise<BillingPreview> {
  requirePermission(actor, "billing.preview");
  checkPeriod(periodStart);
  const { categories, partyIds } = checkScope(scope);
  const building = await getBuilding();
  return computeBillingPreview({ periodStart, categories, ...(await loadInputs(db, building.id, periodStart, partyIds)) });
}

/** The outcome of a billing run, in the words of the result report. */
export interface BillingOutcome {
  run: { id: string } | null;
  preview: BillingPreview;
  invoices: { id: string; number: string; partyId: string; unitNumber: string; total: Cents }[];
  total: Cents;
  alreadyBilled: number;
  review: number;
  notApplicable: number;
}

export function outcomeCounts(preview: BillingPreview) {
  const already = preview.exceptions.filter((e) => e.code === "ALREADY_INVOICED").length;
  return {
    total: preview.invoices.reduce((s, i) => s + i.total, 0),
    alreadyBilled: already,
    review: preview.exceptions.length - already + preview.reviews.length,
    notApplicable: preview.nothingToBill.length,
  };
}

/**
 * Bills a month inside the caller's transaction: recomputed from the database, serialised per
 * building, and every billed charge recorded in BilledCharge, whose unique key makes a second
 * billing of the same charge for the same month impossible (retries, double clicks, two staff at
 * once). Creates nothing, and no run, when there is nothing new. Shared by the billing page and
 * by account registration (the first invoice).
 */
export async function billMonth(tx: Tx, actor: Actor, buildingId: string, periodStart: ISODate, scope: Required<BillingScope>, source: "BILLING_PAGE" | "REGISTRATION"): Promise<BillingOutcome> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"billing:" + buildingId}))`;
  const preview = computeBillingPreview({ periodStart, categories: scope.categories, ...(await loadInputs(tx, buildingId, periodStart, scope.partyIds)) });
  const counts = outcomeCounts(preview);
  if (preview.invoices.length === 0) return { run: null, preview, invoices: [], ...counts };
  const issueDate = todayISO();
  const run = await tx.billingRun.create({
    data: {
      buildingId,
      periodStart: toDbDate(periodStart),
      issuedById: actor.id,
      invoiceCount: preview.invoices.length,
      skippedCount: preview.exceptions.length,
      chargeTypes: preview.categories,
      partyIds: scope.partyIds,
      source,
      totalAmount: centsToDecimalString(counts.total),
      alreadyBilledCount: counts.alreadyBilled,
      reviewCount: counts.review,
      notApplicableCount: counts.notApplicable,
    },
  });
  const year = Number(issueDate.slice(0, 4));
  const invoices: BillingOutcome["invoices"] = [];
  for (const inv of preview.invoices) {
    // When a past month is billed, the due date still comes from the agreement or
    // policy, so the invoice may already be past due when issued.
    // Lines can only be added while the invoice is a draft (database rule), so the
    // invoice is created as a draft with its lines and issued in the same transaction.
    const draft = await tx.invoice.create({
      data: {
        buildingId,
        partyId: inv.partyId,
        unitId: inv.unitId,
        agreementId: inv.agreementId,
        billingRunId: run.id,
        kind: "RECURRING",
        status: "DRAFT",
        periodStart: toDbDate(inv.periodStart),
        periodEnd: toDbDate(inv.periodEnd),
        issueDate: toDbDate(issueDate),
        dueDate: toDbDate(inv.dueDate),
        total: centsToDecimalString(inv.total),
        createdById: actor.id,
        notes: inv.dueDateSource === "BUILDING_POLICY" ? "Due date from the approved building-wide policy (agreement silent)." : null,
        lines: {
          create: inv.lines.map((l) => ({
            category: l.category,
            description: l.description,
            amount: centsToDecimalString(l.amount),
            sourceType: l.sourceType,
            sourceId: l.sourceId,
          })),
        },
      },
    });
    await tx.billedCharge.createMany({
      data: inv.lines.map((l) => ({
        agreementId: inv.agreementId,
        periodStart: toDbDate(inv.periodStart),
        category: l.category,
        sourceType: l.sourceType,
        sourceId: l.sourceId,
        invoiceId: draft.id,
        amount: centsToDecimalString(l.amount),
      })),
    });
    const number = await nextNumber(tx, "INV", "INV", year);
    await tx.invoice.update({ where: { id: draft.id }, data: { status: "ISSUED", number, issuedById: actor.id, issuedAt: new Date() } });
    invoices.push({ id: draft.id, number, partyId: inv.partyId, unitNumber: inv.unitNumber, total: inv.total });
  }
  const types = preview.categories.length === LINE_CATEGORIES.length ? "all charge types" : preview.categories.map((c) => CATEGORY_WORDS[c]).join(", ");
  await audit(tx, actor, {
    action: source === "REGISTRATION" ? "billing.issue_registration" : "billing.issue",
    entityType: "BillingRun",
    entityId: run.id,
    summary: `Issued ${preview.invoices.length} invoice(s) for ${periodStart.slice(0, 7)} (${types}${scope.partyIds.length ? `, ${scope.partyIds.length} account(s)` : ""}); ${counts.alreadyBilled} already billed, ${counts.review} held for review`,
    after: {
      periodStart,
      chargeTypes: preview.categories,
      partyIds: scope.partyIds,
      invoices: invoices.map((i) => i.number),
      total: centsToDecimalString(counts.total),
      alreadyBilled: counts.alreadyBilled,
      review: [...preview.exceptions.filter((e) => e.code !== "ALREADY_INVOICED").map((e) => ({ unit: e.unitNumber, code: e.code })), ...preview.reviews.map((r) => ({ unit: r.unitNumber, code: "REVIEW" }))],
      notApplicable: counts.notApplicable,
    },
  });
  return { run, preview, invoices, ...counts };
}

const CATEGORY_WORDS: Record<LineCategory, string> = { RENT: "rent", SERVICE_CHARGE: "service charges", SHARED_CHARGE: "shared charges", MANAGEMENT_FEE: "management fees", OTHER: "other charges" };

/**
 * Issues the invoices for a month (all charge types and accounts unless a scope is given). All or
 * nothing: one transaction, so a failure leaves no invoice behind and a retry bills exactly what
 * is still unbilled. Refused when there is nothing new to invoice.
 */
export async function issueBilling(actor: Actor, periodStart: ISODate, scope: BillingScope = {}) {
  requirePermission(actor, "billing.issue");
  checkPeriod(periodStart);
  const checked = checkScope(scope);
  const building = await getBuilding();
  return db.$transaction(async (tx) => {
    const outcome = await billMonth(tx, actor, building.id, periodStart, checked, "BILLING_PAGE");
    if (!outcome.run) {
      throw new BusinessError(
        `There is nothing new to invoice for this month: ${outcome.alreadyBilled} already billed, ${outcome.review} held for review, ${outcome.notApplicable} with no charge of the chosen types. Review the list below.`,
      );
    }
    return outcome;
  });
}

export async function listBillingRuns(actor: Actor) {
  requirePermission(actor, "billing.preview");
  const runs = await db.billingRun.findMany({ orderBy: { issuedAt: "desc" }, take: 50 });
  const names = await db.user.findMany({ where: { id: { in: [...new Set(runs.map((r) => r.issuedById))] } }, select: { id: true, name: true } });
  const byId = new Map(names.map((u) => [u.id, u.name]));
  return runs.map((r) => ({ ...r, issuedBy: byId.get(r.issuedById) ?? "—", totalAmount: cents(r.totalAmount) }));
}

/** Invoices issued for an account when it was registered (its first billing). */
export async function registrationInvoices(actor: Actor, partyId: string) {
  requirePermission(actor, "invoices.view");
  const rows = await db.invoice.findMany({ where: { partyId, billingRun: { source: "REGISTRATION" } }, select: { id: true, number: true, total: true, periodStart: true }, orderBy: { number: "asc" } });
  return rows.map((r) => ({ id: r.id, number: r.number ?? "", total: cents(r.total)!, periodStart: optionalFromDbDate(r.periodStart) }));
}

export async function getBillingRun(actor: Actor, id: string) {
  requirePermission(actor, "billing.preview");
  const run = await db.billingRun.findUnique({
    where: { id },
    include: { invoices: { select: { id: true, number: true, total: true, party: { select: { id: true, displayName: true } }, unit: { select: { unitNumber: true } } }, orderBy: { number: "asc" } } },
  });
  if (!run) return null;
  const by = await db.user.findUnique({ where: { id: run.issuedById }, select: { name: true } });
  return { ...run, issuedBy: by?.name ?? "—", totalAmount: cents(run.totalAmount), invoices: run.invoices.map((i) => ({ ...i, total: cents(i.total)! })) };
}

// ---------------------------------------------------------------- building policies

export async function listPolicies(actor: Actor) {
  requirePermission(actor, "settings.view");
  return db.buildingPolicy.findMany({ orderBy: [{ key: "asc" }, { effectiveFrom: "desc" }] });
}

/** Proposes a building-wide policy. It has no effect until separately approved. */
export async function proposePolicy(actor: Actor, input: { key: "DEFAULT_DUE_DAY"; value: string; effectiveFrom: ISODate; note: string | null }) {
  requirePermission(actor, "settings.manage");
  if (input.key === "DEFAULT_DUE_DAY" && !/^([1-9]|1[0-9]|2[0-8])$/.test(input.value)) {
    throw new BusinessError("The default due day must be a whole number from 1 to 28.");
  }
  const building = await getBuilding();
  return db.$transaction(async (tx) => {
    const p = await tx.buildingPolicy.create({
      data: { buildingId: building.id, key: input.key, value: input.value, effectiveFrom: toDbDate(input.effectiveFrom), note: input.note, createdById: actor.id },
    });
    await audit(tx, actor, { action: "policy.propose", entityType: "BuildingPolicy", entityId: p.id, summary: `Proposed ${input.key} = ${input.value} from ${input.effectiveFrom}`, after: input });
    return p;
  });
}

/** Approves a proposed policy. Approval is a separate, explicit, audited step. */
export async function approvePolicy(actor: Actor, id: string) {
  requirePermission(actor, "policies.approve");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "BuildingPolicy" WHERE id = ${id} FOR UPDATE`;
    const p = await tx.buildingPolicy.findUniqueOrThrow({ where: { id } });
    if (p.approvedAt) throw new BusinessError("This policy is already approved.");
    const after = await tx.buildingPolicy.update({ where: { id }, data: { approvedAt: new Date(), approvedById: actor.id } });
    await audit(tx, actor, { action: "policy.approve", entityType: "BuildingPolicy", entityId: id, summary: `Approved ${p.key} = ${p.value} from ${fromDbDate(p.effectiveFrom)}` });
    return after;
  });
}

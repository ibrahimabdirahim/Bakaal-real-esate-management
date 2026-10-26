// Billing runs and policies. The calculation itself lives in billing/compute.ts.

import { db, type DbOrTx } from "@/server/db";
import { audit } from "@/server/audit";
import { BusinessError, requirePermission, type Actor } from "@/server/auth/actor";
import { cents, getBuilding, nextNumber } from "@/server/services/common";
import { computeBillingPreview, type ApprovedPolicy, type BillableAgreement, type BillingPreview } from "@/server/billing/compute";
import { centsToDecimalString } from "@/lib/money";
import { fromDbDate, monthEnd, optionalFromDbDate, toDbDate, todayISO, type ISODate } from "@/lib/dates";

export async function approvedPolicies(tx: DbOrTx, buildingId: string): Promise<ApprovedPolicy[]> {
  const rows = await tx.buildingPolicy.findMany({ where: { buildingId, approvedAt: { not: null } } });
  return rows.map((p) => ({ key: p.key, value: p.value, effectiveFrom: fromDbDate(p.effectiveFrom) }));
}

async function loadInputs(tx: DbOrTx, buildingId: string, periodStart: ISODate) {
  const periodEnd = monthEnd(periodStart);
  const agreements = await tx.agreement.findMany({
    where: {
      buildingId,
      status: { not: "CANCELLED" },
      startDate: { lte: toDbDate(periodEnd) },
      OR: [{ endDate: null }, { endDate: { gte: toDbDate(periodStart) } }],
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
  const existing = await tx.invoice.findMany({
    where: { buildingId, kind: "RECURRING", periodStart: toDbDate(periodStart) },
    select: { agreementId: true },
  });
  return {
    agreements: billable,
    policies: await approvedPolicies(tx, buildingId),
    alreadyInvoicedAgreementIds: new Set(existing.map((e) => e.agreementId!).filter(Boolean)),
  };
}

function checkPeriod(periodStart: string) {
  if (!/^\d{4}-\d{2}-01$/.test(periodStart)) throw new BusinessError("Choose a billing month.");
  const latestAllowed = `${todayISO().slice(0, 7)}-01`;
  if (periodStart > latestAllowed) throw new BusinessError("Future months cannot be billed in advance.");
}

export async function previewBilling(actor: Actor, periodStart: ISODate): Promise<BillingPreview> {
  requirePermission(actor, "billing.preview");
  checkPeriod(periodStart);
  const building = await getBuilding();
  return computeBillingPreview({ periodStart, ...(await loadInputs(db, building.id, periodStart)) });
}

/**
 * Issues the invoices for a month. The preview is recomputed inside the transaction,
 * and the (agreementId, periodStart) unique constraint guarantees that running the
 * same month again can never create a duplicate invoice.
 */
export async function issueBilling(actor: Actor, periodStart: ISODate) {
  requirePermission(actor, "billing.issue");
  checkPeriod(periodStart);
  const building = await getBuilding();
  const issueDate = todayISO();
  return db.$transaction(async (tx) => {
    // Serialise billing runs for the building.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"billing:" + building.id}))`;
    const preview = computeBillingPreview({ periodStart, ...(await loadInputs(tx, building.id, periodStart)) });
    if (preview.invoices.length === 0) {
      throw new BusinessError("There is nothing new to invoice for this month. Review the exceptions list.");
    }
    const run = await tx.billingRun.create({
      data: {
        buildingId: building.id,
        periodStart: toDbDate(periodStart),
        issuedById: actor.id,
        invoiceCount: preview.invoices.length,
        skippedCount: preview.exceptions.length,
      },
    });
    const year = Number(issueDate.slice(0, 4));
    for (const inv of preview.invoices) {
      // When a past month is billed, the due date still comes from the agreement or
      // policy, so the invoice may already be past due when issued.
      // Lines can only be added while the invoice is a draft (database rule), so the
      // invoice is created as a draft with its lines and issued in the same transaction.
      const draft = await tx.invoice.create({
        data: {
          buildingId: building.id,
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
      await tx.invoice.update({
        where: { id: draft.id },
        data: { status: "ISSUED", number: await nextNumber(tx, "INV", "INV", year), issuedById: actor.id, issuedAt: new Date() },
      });
    }
    await audit(tx, actor, {
      action: "billing.issue",
      entityType: "BillingRun",
      entityId: run.id,
      summary: `Issued ${preview.invoices.length} invoice(s) for ${periodStart.slice(0, 7)}; ${preview.exceptions.length} item(s) held for review`,
      after: { periodStart, invoices: preview.invoices.length, exceptions: preview.exceptions.map((e) => ({ unit: e.unitNumber, code: e.code })) },
    });
    return { run, preview };
  });
}

export async function listBillingRuns(actor: Actor) {
  requirePermission(actor, "billing.preview");
  return db.billingRun.findMany({ orderBy: { issuedAt: "desc" }, take: 50 });
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

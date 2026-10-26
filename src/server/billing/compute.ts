// Monthly billing calculation (pure; no database access).
//
// Approved policy hierarchy (DECISIONS.md C9): use the agreement's term first; if the
// agreement is silent, use an approved, effective-dated building policy; if neither
// gives a rule, flag the item for review. Nothing here invents a financial rule:
// - Only whole calendar months are billed. Proration is unresolved (C16), so an
//   agreement or charge that covers only part of the month is flagged, not billed.
// - Purchased-unit owners are never charged rent (no rent amount on OWNERSHIP).
// - Late fees are deferred (C10) and are never calculated.

import type { Cents } from "@/lib/money";
import { dayOfMonth, monthEnd, type ISODate } from "@/lib/dates";

export type AgreementType = "RENTAL" | "OWNERSHIP" | "MANAGEMENT";
export type LineCategory = "RENT" | "MANAGEMENT_FEE" | "SERVICE_CHARGE" | "SHARED_CHARGE" | "OTHER";

export interface BillableCharge {
  id: string;
  category: Exclude<LineCategory, "RENT" | "MANAGEMENT_FEE">;
  description: string;
  amount: Cents;
  effectiveFrom: ISODate;
  effectiveTo: ISODate | null;
}

export interface BillableAgreement {
  id: string;
  type: AgreementType;
  status: "ACTIVE" | "ENDED" | "CANCELLED";
  partyId: string;
  partyName: string;
  unitId: string;
  unitNumber: string;
  startDate: ISODate;
  endDate: ISODate | null;
  rentAmount: Cents | null;
  managementFeeAmount: Cents | null;
  dueDay: number | null;
  charges: BillableCharge[];
}

export interface ApprovedPolicy {
  key: "DEFAULT_DUE_DAY";
  value: string;
  effectiveFrom: ISODate;
}

export interface ProposedLine {
  category: LineCategory;
  description: string;
  amount: Cents;
  sourceType: "AGREEMENT_RENT" | "AGREEMENT_MANAGEMENT_FEE" | "AGREEMENT_CHARGE";
  sourceId: string;
}

export interface ProposedInvoice {
  agreementId: string;
  agreementType: AgreementType;
  partyId: string;
  partyName: string;
  unitId: string;
  unitNumber: string;
  periodStart: ISODate;
  periodEnd: ISODate;
  dueDate: ISODate;
  dueDateSource: "AGREEMENT" | "BUILDING_POLICY";
  lines: ProposedLine[];
  total: Cents;
}

export type ExceptionCode =
  | "PARTIAL_PERIOD"
  | "PARTIAL_CHARGE_PERIOD"
  | "NO_DUE_DATE"
  | "ALREADY_INVOICED";

export interface BillingException {
  agreementId: string;
  unitNumber: string;
  partyName: string;
  code: ExceptionCode;
  message: string;
}

export interface BillingPreview {
  periodStart: ISODate;
  periodEnd: ISODate;
  invoices: ProposedInvoice[];
  exceptions: BillingException[];
  /** Agreements in force with nothing billable this month (e.g. an owner with no approved charges). */
  nothingToBill: { agreementId: string; unitNumber: string; partyName: string }[];
  /**
   * Terms missing from an agreement that do not hold its invoice: a management agreement with no
   * agreed fee bills no fee (its approved charges are still billed). Shown so it can be completed.
   */
  reviews: { agreementId: string; unitNumber: string; partyName: string; message: string }[];
}

export function resolveDueDay(
  agreementDueDay: number | null,
  policies: ApprovedPolicy[],
  periodStart: ISODate,
): { day: number; source: "AGREEMENT" | "BUILDING_POLICY" } | null {
  if (agreementDueDay != null) return { day: agreementDueDay, source: "AGREEMENT" };
  const applicable = policies
    .filter((p) => p.key === "DEFAULT_DUE_DAY" && p.effectiveFrom <= periodStart)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
  if (!applicable) return null;
  return { day: Number(applicable.value), source: "BUILDING_POLICY" };
}

function overlaps(start: ISODate, end: ISODate | null, periodStart: ISODate, periodEnd: ISODate) {
  return start <= periodEnd && (end == null || end >= periodStart);
}

function covers(start: ISODate, end: ISODate | null, periodStart: ISODate, periodEnd: ISODate) {
  return start <= periodStart && (end == null || end >= periodEnd);
}

export function computeBillingPreview(input: {
  periodStart: ISODate;
  agreements: BillableAgreement[];
  policies: ApprovedPolicy[];
  alreadyInvoicedAgreementIds: Set<string>;
}): BillingPreview {
  const { periodStart, agreements, policies, alreadyInvoicedAgreementIds } = input;
  if (!/^\d{4}-\d{2}-01$/.test(periodStart)) throw new Error("Billing period must start on the 1st");
  const periodEnd = monthEnd(periodStart);
  const preview: BillingPreview = { periodStart, periodEnd, invoices: [], exceptions: [], nothingToBill: [], reviews: [] };

  const sorted = [...agreements].sort((a, b) =>
    a.unitNumber === b.unitNumber ? a.type.localeCompare(b.type) : a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }),
  );

  for (const ag of sorted) {
    if (ag.status === "CANCELLED") continue;
    if (!overlaps(ag.startDate, ag.endDate, periodStart, periodEnd)) continue;
    const base = { agreementId: ag.id, unitNumber: ag.unitNumber, partyName: ag.partyName };

    if (alreadyInvoicedAgreementIds.has(ag.id)) {
      preview.exceptions.push({ ...base, code: "ALREADY_INVOICED", message: "An invoice for this agreement and month already exists; it will not be duplicated." });
      continue;
    }
    if (!covers(ag.startDate, ag.endDate, periodStart, periodEnd)) {
      preview.exceptions.push({
        ...base,
        code: "PARTIAL_PERIOD",
        message: "Agreement starts or ends during this month. Part-month billing rules are not approved, so no automatic invoice is created. Use a reviewed manual invoice if a charge is authorised.",
      });
      continue;
    }

    const lines: ProposedLine[] = [];
    if (ag.type === "RENTAL" && ag.rentAmount != null && ag.rentAmount > 0) {
      lines.push({ category: "RENT", description: "Rent", amount: ag.rentAmount, sourceType: "AGREEMENT_RENT", sourceId: ag.id });
    }
    if (ag.type === "MANAGEMENT" && ag.managementFeeAmount != null && ag.managementFeeAmount > 0) {
      lines.push({ category: "MANAGEMENT_FEE", description: "Management fee", amount: ag.managementFeeAmount, sourceType: "AGREEMENT_MANAGEMENT_FEE", sourceId: ag.id });
    }
    if (ag.type === "MANAGEMENT" && !(ag.managementFeeAmount != null && ag.managementFeeAmount > 0)) {
      preview.reviews.push({
        agreementId: base.agreementId,
        unitNumber: base.unitNumber,
        partyName: base.partyName,
        message: "No management fee is recorded on this management agreement, so no fee is billed. Record the agreed fee on the agreement; no fee is assumed.",
      });
    }

    let partialCharge = false;
    for (const ch of ag.charges) {
      if (!overlaps(ch.effectiveFrom, ch.effectiveTo, periodStart, periodEnd)) continue;
      if (!covers(ch.effectiveFrom, ch.effectiveTo, periodStart, periodEnd)) {
        partialCharge = true;
        continue;
      }
      lines.push({ category: ch.category, description: ch.description, amount: ch.amount, sourceType: "AGREEMENT_CHARGE", sourceId: ch.id });
    }
    if (partialCharge) {
      preview.exceptions.push({
        ...base,
        code: "PARTIAL_CHARGE_PERIOD",
        message: "A charge on this agreement starts or ends during this month. Part-month rules are not approved, so the whole invoice is held for review.",
      });
      continue;
    }

    if (lines.length === 0) {
      preview.nothingToBill.push(base);
      continue;
    }

    const due = resolveDueDay(ag.dueDay, policies, periodStart);
    if (!due) {
      preview.exceptions.push({
        ...base,
        code: "NO_DUE_DATE",
        message: "The agreement has no due day and no approved building-wide due-day policy applies. Add a due day to the agreement or approve a building policy.",
      });
      continue;
    }

    preview.invoices.push({
      agreementId: ag.id,
      agreementType: ag.type,
      partyId: ag.partyId,
      partyName: ag.partyName,
      unitId: ag.unitId,
      unitNumber: ag.unitNumber,
      periodStart,
      periodEnd,
      dueDate: dayOfMonth(periodStart, due.day),
      dueDateSource: due.source,
      lines,
      total: lines.reduce((s, l) => s + l.amount, 0),
    });
  }
  return preview;
}

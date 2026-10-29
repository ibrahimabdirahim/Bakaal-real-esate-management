// Monthly billing calculation (pure; no database access).
//
// Approved policy hierarchy (DECISIONS.md C9): use the agreement's term first; if the
// agreement is silent, use an approved, effective-dated building policy; if neither
// gives a rule, flag the item for review. Nothing here invents a financial rule:
// - Only whole calendar months are billed. Proration is unresolved (C16), so an
//   agreement or charge that covers only part of the month is flagged, not billed.
// - Purchased-unit owners are never charged rent (no rent amount on OWNERSHIP).
// - Late fees are deferred (C10) and are never calculated.
// - Each recurring charge (an agreement's rent or management fee, or one approved charge) is
//   billed at most once per month (F65): charges already billed are skipped, so charge types can
//   be billed separately and a month can be run again without duplicating anything.
// - Shared and service charges are the fixed amounts approved on the agreement; no expense is
//   divided between accounts (allocation methods are unresolved, C13).

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

/** The identity of one recurring charge for a month (with the period): what BilledCharge stores. */
export const billedKey = (agreementId: string, sourceType: string, sourceId: string) => `${agreementId}|${sourceType}|${sourceId}`;

export const LINE_CATEGORIES: LineCategory[] = ["RENT", "SERVICE_CHARGE", "SHARED_CHARGE", "MANAGEMENT_FEE", "OTHER"];

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
  /** Charges of this agreement already billed for the month (not on this invoice). */
  alreadyBilled: { category: LineCategory; description: string }[];
}

export type ExceptionCode =
  | "PARTIAL_PERIOD"
  | "PARTIAL_CHARGE_PERIOD"
  | "NO_DUE_DATE"
  | "ALREADY_INVOICED";

export interface BillingException {
  agreementId: string;
  partyId: string;
  unitNumber: string;
  partyName: string;
  code: ExceptionCode;
  message: string;
}

export interface BillingPreview {
  periodStart: ISODate;
  periodEnd: ISODate;
  /** The charge types this preview covers (every type when none was chosen). */
  categories: LineCategory[];
  invoices: ProposedInvoice[];
  exceptions: BillingException[];
  /** Agreements in force with nothing billable this month of the chosen types (e.g. an owner with no approved charges). */
  nothingToBill: { agreementId: string; partyId: string; unitNumber: string; partyName: string }[];
  /**
   * Terms missing from an agreement that do not hold its invoice: a management agreement with no
   * agreed fee bills no fee (its approved charges are still billed). Shown so it can be completed.
   */
  reviews: { agreementId: string; partyId: string; unitNumber: string; partyName: string; message: string }[];
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
  /** billedKey(...) of every recurring charge already billed for this month. */
  alreadyBilled: Set<string>;
  /** Charge types to bill; empty or missing = every type. */
  categories?: LineCategory[];
}): BillingPreview {
  const { periodStart, agreements, policies, alreadyBilled } = input;
  if (!/^\d{4}-\d{2}-01$/.test(periodStart)) throw new Error("Billing period must start on the 1st");
  const categories = input.categories?.length ? LINE_CATEGORIES.filter((c) => input.categories!.includes(c)) : LINE_CATEGORIES;
  const wanted = new Set(categories);
  const periodEnd = monthEnd(periodStart);
  const preview: BillingPreview = { periodStart, periodEnd, categories, invoices: [], exceptions: [], nothingToBill: [], reviews: [] };

  const sorted = [...agreements].sort((a, b) =>
    a.unitNumber === b.unitNumber ? a.type.localeCompare(b.type) : a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }),
  );

  for (const ag of sorted) {
    if (ag.status === "CANCELLED") continue;
    if (!overlaps(ag.startDate, ag.endDate, periodStart, periodEnd)) continue;
    const base = { agreementId: ag.id, partyId: ag.partyId, unitNumber: ag.unitNumber, partyName: ag.partyName };

    // The agreement's charges of the chosen types that apply in this month.
    const lines: ProposedLine[] = [];
    if (wanted.has("RENT") && ag.type === "RENTAL" && ag.rentAmount != null && ag.rentAmount > 0) {
      lines.push({ category: "RENT", description: "Rent", amount: ag.rentAmount, sourceType: "AGREEMENT_RENT", sourceId: ag.id });
    }
    const feeMissing = wanted.has("MANAGEMENT_FEE") && ag.type === "MANAGEMENT" && !(ag.managementFeeAmount != null && ag.managementFeeAmount > 0);
    if (wanted.has("MANAGEMENT_FEE") && ag.type === "MANAGEMENT" && !feeMissing) {
      lines.push({ category: "MANAGEMENT_FEE", description: "Management fee", amount: ag.managementFeeAmount!, sourceType: "AGREEMENT_MANAGEMENT_FEE", sourceId: ag.id });
    }
    let partialCharge = false;
    for (const ch of ag.charges) {
      if (!wanted.has(ch.category) || !overlaps(ch.effectiveFrom, ch.effectiveTo, periodStart, periodEnd)) continue;
      if (!covers(ch.effectiveFrom, ch.effectiveTo, periodStart, periodEnd)) {
        if (!alreadyBilled.has(billedKey(ag.id, "AGREEMENT_CHARGE", ch.id))) partialCharge = true;
        continue;
      }
      lines.push({ category: ch.category, description: ch.description, amount: ch.amount, sourceType: "AGREEMENT_CHARGE", sourceId: ch.id });
    }

    // Charges already billed for this month are never billed again.
    const billed = lines.filter((l) => alreadyBilled.has(billedKey(ag.id, l.sourceType, l.sourceId)));
    const fresh = lines.filter((l) => !billed.includes(l));
    if (lines.length > 0 && fresh.length === 0 && !partialCharge) {
      preview.exceptions.push({ ...base, code: "ALREADY_INVOICED", message: `Already billed for this month: ${billed.map((l) => l.description).join(", ")}. Nothing is billed twice.` });
      continue;
    }
    if (fresh.length === 0 && !partialCharge && !feeMissing) {
      preview.nothingToBill.push(base);
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
    if (feeMissing) {
      preview.reviews.push({
        ...base,
        message: "No management fee is recorded on this management agreement, so no fee is billed. Record the agreed fee on the agreement; no fee is assumed.",
      });
    }
    if (partialCharge) {
      preview.exceptions.push({
        ...base,
        code: "PARTIAL_CHARGE_PERIOD",
        message: "A charge on this agreement starts or ends during this month. Part-month rules are not approved, so the whole invoice is held for review.",
      });
      continue;
    }
    if (fresh.length === 0) continue; // only the missing fee to review

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
      lines: fresh,
      total: fresh.reduce((s, l) => s + l.amount, 0),
      alreadyBilled: billed.map((l) => ({ category: l.category, description: l.description })),
    });
  }
  return preview;
}

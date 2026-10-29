// Units, accounts (people/companies) and agreements.

import { db, type DbOrTx } from "@/server/db";
import { audit } from "@/server/audit";
import { BusinessError, requirePermission, type Actor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { cents, describeDbError, findBuilding, getBuilding, lockActiveParty } from "@/server/services/common";
import { registrationProgress } from "@/lib/capacity";
import { unitTypeProblem } from "@/lib/unit-types";
import { attachStaged } from "@/server/services/documents";
import { billMonth } from "@/server/services/billing";
import { CONTACT_FIELD_LABELS, changedContactFields, matchingContactFields, normalizeEmail, normalizeIdNumber, normalizePhone, type ContactDetails, type ContactField } from "@/lib/contact";
import { occupancyOn, type Occupancy } from "@/server/services/occupancy";
import { centsToDecimalString, type Cents } from "@/lib/money";
import { fromDbDate, monthStart, optionalFromDbDate, toDbDate, todayISO, type ISODate } from "@/lib/dates";
import type { AccountContext, ContextAgreement, ContextUnit } from "@/lib/account-context";

// ---------------------------------------------------------------- units

/** Unit list filters: one occupancy, any occupied unit, or retired units. Occupancy filters cover units in use only (as the dashboard counts them). */
export type UnitFilter = Occupancy | "OCCUPIED" | "RETIRED" | "";

export async function listUnits(actor: Actor, filter: { q?: string; occupancy?: UnitFilter } = {}) {
  requirePermission(actor, "units.view");
  const building = await getBuilding();
  const today = todayISO();
  const units = await db.unit.findMany({
    where: {
      buildingId: building.id,
      ...(filter.q ? { OR: [{ unitNumber: { contains: filter.q, mode: "insensitive" } }, { unitType: { contains: filter.q, mode: "insensitive" } }] } : {}),
    },
    include: { agreements: { include: { party: { select: { id: true, displayName: true } } } } },
  });
  const rows = units.map((u) => {
    const spans = u.agreements.map((a) => ({
      ...a,
      startDate: fromDbDate(a.startDate),
      endDate: optionalFromDbDate(a.endDate),
    }));
    const occupancy = occupancyOn(spans, today);
    const live = spans.filter((a) => a.status !== "CANCELLED" && a.startDate <= today && (a.endDate == null || a.endDate >= today));
    const rental = live.find((a) => a.type === "RENTAL");
    const owner = live.find((a) => a.type === "OWNERSHIP");
    return {
      id: u.id,
      unitNumber: u.unitNumber,
      floor: u.floor,
      unitType: u.unitType,
      isActive: u.isActive,
      occupancy,
      tenant: rental ? rental.party : null,
      owner: owner ? owner.party : null,
      monthlyRent: rental ? cents(rental.rentAmount) : null,
    };
  });
  rows.sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));
  switch (filter.occupancy) {
    case undefined:
    case "":
      return rows;
    case "RETIRED":
      return rows.filter((r) => !r.isActive);
    case "OCCUPIED":
      return rows.filter((r) => r.isActive && r.occupancy !== "VACANT");
    default:
      return rows.filter((r) => r.isActive && r.occupancy === filter.occupancy);
  }
}

export async function getUnit(actor: Actor, id: string) {
  requirePermission(actor, "units.view");
  const unit = await db.unit.findUnique({
    where: { id },
    include: {
      agreements: { include: { party: true, charges: { orderBy: { effectiveFrom: "asc" } } }, orderBy: { startDate: "desc" } },
      workOrders: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!unit) return null;
  const canSeeFinance = can(actor.role, "invoices.view");
  const invoices = canSeeFinance
    ? await db.invoice.findMany({ where: { unitId: id, status: "ISSUED" }, include: { party: true }, orderBy: { issueDate: "desc" }, take: 24 })
    : [];
  return { unit, invoices, occupancy: occupancyOn(unit.agreements.map((a) => ({ ...a, startDate: fromDbDate(a.startDate), endDate: optionalFromDbDate(a.endDate) })), todayISO()) };
}

export interface UnitInput {
  unitNumber: string;
  floor: string | null;
  unitType: string | null;
  notes: string | null;
}

/**
 * Unit numbers are unique within a building, ignoring letter case and surrounding
 * spaces. Checked here for a clear message; a case-insensitive unique index enforces it
 * under concurrency.
 */
async function requireFreeUnitNumber(tx: DbOrTx, buildingId: string, unitNumber: string, excludeId?: string) {
  const clash = await tx.unit.findFirst({
    where: { buildingId, unitNumber: { equals: unitNumber.trim(), mode: "insensitive" }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { unitNumber: true, isActive: true },
  });
  if (!clash) return;
  const as = clash.unitNumber !== unitNumber.trim() ? ` (registered as “${clash.unitNumber}”)` : "";
  throw new BusinessError(`Unit number ${unitNumber.trim()} already exists in this building${as}${clash.isActive ? "" : ", as a retired unit"}.`);
}

const unitNumberTaken = (input: UnitInput) => `Unit number ${input.unitNumber} already exists in this building.`;

export async function createUnit(actor: Actor, input: UnitInput) {
  requirePermission(actor, "units.manage");
  const typeProblem = unitTypeProblem(input.unitType);
  if (typeProblem) throw new BusinessError(typeProblem);
  const building = await getBuilding();
  try {
    return await db.$transaction(async (tx) => {
      await requireFreeUnitNumber(tx, building.id, input.unitNumber);
      const unit = await tx.unit.create({ data: { buildingId: building.id, ...input } });
      await audit(tx, actor, { action: "unit.create", entityType: "Unit", entityId: unit.id, summary: `Created unit ${unit.unitNumber}`, after: unit });
      return unit;
    });
  } catch (e) {
    if (e instanceof BusinessError) throw e;
    throw new BusinessError(describeDbError(e) === "A record with these details already exists." ? unitNumberTaken(input) : (describeDbError(e) ?? "Could not create the unit."));
  }
}

export async function updateUnit(actor: Actor, id: string, input: UnitInput & { isActive: boolean }) {
  requirePermission(actor, "units.manage");
  try {
    return await db.$transaction(async (tx) => {
      const before = await tx.unit.findUniqueOrThrow({ where: { id } });
      const typeProblem = unitTypeProblem(input.unitType, before.unitType);
      if (typeProblem) throw new BusinessError(typeProblem);
      await requireFreeUnitNumber(tx, before.buildingId, input.unitNumber, id);
      // A retired unit cannot receive agreements; it must not keep one either (occupancy and billing would disagree).
      if (before.isActive && !input.isActive) {
        const inForce = await tx.agreement.count({ where: { unitId: id, status: { not: "CANCELLED" }, OR: [{ endDate: null }, { endDate: { gte: toDbDate(todayISO()) } }] } });
        if (inForce) throw new BusinessError("This unit has an agreement in force or starting later. End it (or cancel it if it was entered in error) before retiring the unit.");
      }
      const unit = await tx.unit.update({ where: { id }, data: input });
      await audit(tx, actor, { action: "unit.update", entityType: "Unit", entityId: id, summary: `Updated unit ${unit.unitNumber}`, before, after: unit });
      return unit;
    });
  } catch (e) {
    if (e instanceof BusinessError) throw e;
    throw new BusinessError(describeDbError(e) === "A record with these details already exists." ? unitNumberTaken(input) : (describeDbError(e) ?? "Could not update the unit."));
  }
}

/**
 * Registration progress for the building: capacity (from Settings) versus units in use
 * in the register. Retired units are reported separately and not counted. Returns null
 * when no building exists yet.
 */
export async function unitRegistration(actor: Actor) {
  requirePermission(actor, "units.view");
  const building = await findBuilding();
  if (!building) return null;
  const [registered, retired] = await Promise.all([
    db.unit.count({ where: { buildingId: building.id, isActive: true } }),
    db.unit.count({ where: { buildingId: building.id, isActive: false } }),
  ]);
  return { ...registrationProgress(building.totalUnits, registered), retired };
}

// ---------------------------------------------------------------- accounts (parties)

export interface PartyInput {
  displayName: string;
  phone: string | null;
  email: string | null;
  idNumber: string | null;
  notes: string | null;
}

/** Archived accounts are hidden from the register unless `includeArchived` is set. */
function agreementStatusOf(agreements: { status: string; startDate: Date }[], hasLive: boolean, today: ISODate): string {
  if (hasLive) return "Active";
  const upcoming = agreements.filter((a) => a.status !== "CANCELLED" && fromDbDate(a.startDate) > today).map((a) => fromDbDate(a.startDate)).sort()[0];
  if (upcoming) return `Starts ${upcoming}`;
  return agreements.some((a) => a.status !== "CANCELLED") ? "Ended" : "None";
}

export async function listParties(actor: Actor, q?: string, { includeArchived = false, type = "" }: { includeArchived?: boolean; type?: AccountType | "NONE" | "" } = {}) {
  requirePermission(actor, "accounts.view");
  const today = todayISO();
  const parties = await db.party.findMany({
    where: {
      ...(includeArchived ? {} : { archivedAt: null }),
      ...(q ? { OR: [{ displayName: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
    },
    include: { agreements: { include: { unit: { select: { unitNumber: true } } } }, _count: { select: { agreements: true, invoices: true, payments: true } } },
    orderBy: { displayName: "asc" },
  });
  const balances = can(actor.role, "invoices.view") ? await partyBalances(parties.map((p) => p.id)) : null;
  const rows = parties.map((p) => {
    const live = p.agreements.filter((a) => a.status !== "CANCELLED" && fromDbDate(a.startDate) <= today && (a.endDate == null || fromDbDate(a.endDate) >= today));
    const types = accountTypesOf(live.map((a) => a.type));
    const category = types.length ? types.map((t) => ACCOUNT_TYPE_LABELS[t]).join(" · ") : "No agreement in force";
    return {
      id: p.id,
      displayName: p.displayName,
      phone: p.phone,
      email: p.email,
      archived: p.archivedAt != null,
      types,
      category,
      units: [...new Set(live.map((a) => a.unit.unitNumber))],
      balance: balances?.get(p.id) ?? null,
      /** Agreements, invoices and payments in any status: an account with any is kept (no archive or deletion, F25). */
      history: p._count.agreements + p._count.invoices + p._count.payments,
      /** The state of the account's agreements today: in force, starting later, all ended, or none. */
      agreementStatus: agreementStatusOf(p.agreements, live.length > 0, today),
    };
  });
  if (type === "NONE") return rows.filter((r) => r.types.length === 0);
  return type ? rows.filter((r) => r.types.includes(type)) : rows;
}

/**
 * Balances per account, as accountBalance (F49): outstanding on issued invoices after allocated
 * payments and credit notes, and verified money not yet allocated (shown apart, never deducted from an invoice).
 */
export async function partyBalances(partyIds: string[]): Promise<Map<string, { outstanding: Cents; unallocated: Cents }>> {
  const map = new Map<string, { outstanding: Cents; unallocated: Cents }>(partyIds.map((id) => [id, { outstanding: 0, unallocated: 0 }]));
  if (partyIds.length === 0) return map;
  const rows = await db.$queryRaw<{ partyId: string; outstanding: string; unallocated: string }[]>`
    SELECT p.id AS "partyId",
      COALESCE((SELECT SUM(i.total) FROM "Invoice" i WHERE i."partyId" = p.id AND i.status = 'ISSUED'), 0)
    - COALESCE((SELECT SUM(c.amount) FROM "CreditNote" c JOIN "Invoice" i ON i.id = c."invoiceId" WHERE i."partyId" = p.id AND i.status = 'ISSUED'), 0)
    - COALESCE((SELECT SUM(a.amount) FROM "PaymentAllocation" a JOIN "Invoice" i ON i.id = a."invoiceId" WHERE i."partyId" = p.id AND i.status = 'ISSUED' AND a."reversedAt" IS NULL), 0) AS outstanding,
      COALESCE((SELECT SUM(pm.amount) FROM "Payment" pm WHERE pm."partyId" = p.id AND pm.status = 'VERIFIED'), 0)
    - COALESCE((SELECT SUM(a.amount) FROM "PaymentAllocation" a JOIN "Payment" pm ON pm.id = a."paymentId" WHERE pm."partyId" = p.id AND pm.status = 'VERIFIED' AND a."reversedAt" IS NULL), 0) AS unallocated
    FROM "Party" p WHERE p.id = ANY(${partyIds})`;
  for (const r of rows) map.set(r.partyId, { outstanding: cents(r.outstanding) ?? 0, unallocated: cents(r.unallocated) ?? 0 });
  return map;
}

export async function getParty(actor: Actor, id: string) {
  requirePermission(actor, "accounts.view");
  const party = await db.party.findUnique({
    where: { id },
    include: {
      agreements: { include: { unit: true, charges: true }, orderBy: { startDate: "desc" } },
    },
  });
  if (!party) return null;
  const sensitive = can(actor.role, "accounts.view_sensitive");
  const [linked, archive, deletion] = await Promise.all([
    linkedRecordCounts(db, id),
    party.archivedAt
      ? db.auditEvent.findFirst({ where: { entityType: "Party", entityId: id, action: "account.archive" }, orderBy: { id: "desc" }, select: { occurredAt: true, actorEmail: true, reason: true } })
      : null,
    can(actor.role, "accounts.delete") ? deletionCheck(db, id) : null,
  ]);
  return {
    party: { ...party, idNumber: sensitive ? party.idNumber : party.idNumber ? "•••• (restricted)" : null },
    canSeeSensitive: sensitive,
    linked,
    archive,
    /** Only for roles that may delete. */
    deletion,
  };
}

export interface DuplicateMatch {
  id: string;
  displayName: string;
  archived: boolean;
  fields: ContactField[];
}

/** Another account (active or archived) already has this e-mail, phone or ID number. Never overridable. */
export class DuplicateAccountError extends BusinessError {
  matches: DuplicateMatch[];
  constructor(matches: DuplicateMatch[]) {
    const list = matches.map((m) => `${m.displayName}${m.archived ? " (archived)" : ""} — same ${m.fields.map((f) => CONTACT_FIELD_LABELS[f]).join(", ")}`).join("; ");
    super(`This account already exists: ${list}. Nothing was saved. Use the existing account or correct the details.`);
    this.name = "DuplicateAccountError";
    this.matches = matches;
  }
}

async function findDuplicates(tx: DbOrTx, input: ContactDetails, { excludeId, only }: { excludeId?: string; only?: ContactField[] } = {}): Promise<DuplicateMatch[]> {
  if (only?.length === 0) return [];
  if (!normalizeEmail(input.email) && !normalizePhone(input.phone) && !normalizeIdNumber(input.idNumber)) return [];
  // Compared in code (not SQL) so one set of normalisation rules applies everywhere.
  const candidates = await tx.party.findMany({
    where: { ...(excludeId ? { id: { not: excludeId } } : {}), OR: [{ email: { not: null } }, { phone: { not: null } }, { idNumber: { not: null } }] },
    select: { id: true, displayName: true, email: true, phone: true, idNumber: true, archivedAt: true },
    orderBy: { createdAt: "asc" },
  });
  return candidates.flatMap((c) => {
    const fields = matchingContactFields(input, c, only);
    return fields.length ? [{ id: c.id, displayName: c.displayName, archived: c.archivedAt != null, fields }] : [];
  });
}

// Serialises account creation and contact changes, so two submissions (or two users)
// cannot both pass the duplicate check before either is saved. The check runs inside
// the same transaction as the insert/update, so it always sees the latest committed data.
const lockAccountContacts = (tx: DbOrTx) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('bakaal.party.contacts'))`;

const maskParty = <T extends { idNumber: string | null }>(p: T) => ({ ...p, idNumber: p.idNumber ? "(set)" : null });

/** Creates an account; refused if any account, archived included, has the same e-mail, phone or ID number. */
export async function createParty(actor: Actor, input: PartyInput) {
  requirePermission(actor, "accounts.manage");
  return db.$transaction(async (tx) => {
    await lockAccountContacts(tx);
    const matches = await findDuplicates(tx, input);
    if (matches.length) throw new DuplicateAccountError(matches);
    const party = await tx.party.create({ data: input });
    await audit(tx, actor, { action: "account.create", entityType: "Party", entityId: party.id, summary: `Created account ${party.displayName}`, after: maskParty(party) });
    return party;
  });
}

/**
 * Updates an account; refused if a *changed* e-mail, phone or ID number belongs to
 * another account (archived included). The account itself is excluded, and details
 * that did not change are not re-checked, so older duplicates can still be edited.
 */
export async function updateParty(actor: Actor, id: string, input: PartyInput) {
  requirePermission(actor, "accounts.manage");
  return db.$transaction(async (tx) => {
    await lockAccountContacts(tx);
    const before = await tx.party.findUniqueOrThrow({ where: { id } });
    if (before.archivedAt) throw new BusinessError("This account is archived and can no longer be edited.");
    const matches = await findDuplicates(tx, input, { excludeId: id, only: changedContactFields(before, input) });
    if (matches.length) throw new DuplicateAccountError(matches);
    const party = await tx.party.update({ where: { id }, data: input });
    await audit(tx, actor, {
      action: "account.update",
      entityType: "Party",
      entityId: id,
      summary: `Updated account ${party.displayName}`,
      before: maskParty(before),
      after: maskParty(party),
    });
    return party;
  });
}

async function linkedRecordCounts(tx: DbOrTx, partyId: string) {
  const [agreements, invoices, payments] = await Promise.all([
    tx.agreement.count({ where: { partyId } }),
    tx.invoice.count({ where: { partyId } }),
    tx.payment.count({ where: { partyId } }),
  ]);
  return { agreements, invoices, payments };
}

/** Why an account cannot be archived, or null if it can. Counts every status, including cancelled and drafts. */
export function archiveBlocker(linked: { agreements: number; invoices: number; payments: number }): string | null {
  const parts = [
    linked.agreements && `${linked.agreements} agreement(s)`,
    linked.invoices && `${linked.invoices} invoice(s)`,
    linked.payments && `${linked.payments} payment(s)`,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return `This account cannot be archived because it has ${parts.join(", ")}. Accounts with agreements, invoices or payments stay in the register so their history remains complete.`;
}

/**
 * Audit entries about *other* records (agreements, payments, invoices, …) that mention
 * this account, even if those records no longer exist. The account's own lifecycle
 * entries (entityType "Party") are its history, not a dependency, and stay after deletion.
 */
async function auditReferenceCount(tx: DbOrTx, partyId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM "AuditEvent"
    WHERE "entityType" <> 'Party'
      AND ("entityId" = ${partyId} OR strpos(coalesce("before"::text, ''), ${partyId}) > 0 OR strpos(coalesce("after"::text, ''), ${partyId}) > 0)`;
  return rows[0]?.n ?? 0;
}

export type DeletionCheck = { agreements: number; invoices: number; payments: number; auditReferences: number };

export async function deletionCheck(tx: DbOrTx, partyId: string): Promise<DeletionCheck> {
  const [linked, auditReferences] = await Promise.all([linkedRecordCounts(tx, partyId), auditReferenceCount(tx, partyId)]);
  return { ...linked, auditReferences };
}

/** Why an account cannot be permanently deleted, or null if it can. */
export function deleteBlocker(check: DeletionCheck, { archived = false }: { archived?: boolean } = {}): string | null {
  const parts = [
    check.agreements && `${check.agreements} agreement(s)`,
    check.invoices && `${check.invoices} invoice(s)`,
    check.payments && `${check.payments} payment(s)`,
    check.auditReferences && `${check.auditReferences} audit log entr${check.auditReferences === 1 ? "y" : "ies"} about other records that refer to it`,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  const instead = archived ? "It stays archived." : "Archive it instead to take it out of use while keeping the record.";
  return `This account cannot be deleted because it has ${parts.join(", ")}. Deleting it would leave gaps in the financial and audit history. ${instead}`;
}


/**
 * Permanently deletes an account that was never used for anything. Administrators only,
 * with the typed confirmation "DELETE". Nothing else is deleted: the account's own audit
 * entries stay, and a final "account.delete" entry records who deleted it and when.
 */
/** Permanently deletes an account with no history (F25), after the one shared confirmation (F57). */
export async function deleteParty(actor: Actor, id: string, reason: string | null = null) {
  requirePermission(actor, "accounts.delete");
  return db.$transaction(async (tx) => {
    // FOR UPDATE waits for (and then blocks) any transaction adding records for this account.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Party" WHERE id = ${id} FOR UPDATE`;
    if (locked.length === 0) throw new BusinessError("This account no longer exists. It may already have been deleted.");
    const party = await tx.party.findUniqueOrThrow({ where: { id } });
    const blocker = deleteBlocker(await deletionCheck(tx, id), { archived: party.archivedAt != null });
    if (blocker) throw new BusinessError(blocker);
    await tx.party.delete({ where: { id } });
    // Only what is needed to identify the record later; no contact or ID details.
    await audit(tx, actor, {
      action: "account.delete",
      entityType: "Party",
      entityId: id,
      summary: `Permanently deleted account ${party.displayName}`,
      before: { id, displayName: party.displayName, createdAt: party.createdAt, archivedAt: party.archivedAt },
      reason: reason?.trim() || null,
    });
    return { id, displayName: party.displayName };
  });
}

/** For a deleted account's old links (audit log, activity feed): who deleted it and when. */
export async function findDeletedParty(actor: Actor, id: string) {
  requirePermission(actor, "accounts.view");
  return db.auditEvent.findFirst({
    where: { entityType: "Party", entityId: id, action: "account.delete" },
    orderBy: { id: "desc" },
    select: { occurredAt: true, actorEmail: true, summary: true, reason: true },
  });
}

/**
 * Archives an account that was never used: it is hidden from the register and cannot
 * be used for new agreements, invoices or payments. Nothing is deleted.
 */
export async function archiveParty(actor: Actor, id: string, reason: string) {
  requirePermission(actor, "accounts.manage");
  const why = reason.trim();
  if (!why) throw new BusinessError("Give a reason for archiving this account.");
  return db.$transaction(async (tx) => {
    // FOR UPDATE waits for (and blocks) any transaction adding records for this account.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Party" WHERE id = ${id} FOR UPDATE`;
    if (locked.length === 0) throw new BusinessError("Account not found.");
    const before = await tx.party.findUniqueOrThrow({ where: { id } });
    if (before.archivedAt) throw new BusinessError("This account is already archived.");
    const blocker = archiveBlocker(await linkedRecordCounts(tx, id));
    if (blocker) throw new BusinessError(blocker);
    const party = await tx.party.update({ where: { id }, data: { archivedAt: new Date() } });
    await audit(tx, actor, {
      action: "account.archive",
      entityType: "Party",
      entityId: id,
      summary: `Archived account ${party.displayName}`,
      before: maskParty(before),
      after: maskParty(party),
      reason: why,
    });
    return party;
  });
}

// ---------------------------------------------------------------- agreements

export interface AgreementInput {
  type: "RENTAL" | "OWNERSHIP" | "MANAGEMENT";
  unitId: string;
  partyId: string;
  reference: string | null;
  startDate: ISODate;
  endDate: ISODate | null;
  rentAmount: Cents | null;
  managementFeeAmount: Cents | null;
  /** Deposit agreed in a rental agreement (F52): an agreed term only — not billed, not money received. */
  depositAmount?: Cents | null;
  dueDay: number | null;
  graceDays: number | null;
  purchaseDate: ISODate | null;
  ownershipEvidence: string | null;
  lateFeeTerms: string | null;
  allocationTerms: string | null;
  notes: string | null;
}

export function validateAgreement(input: AgreementInput): string | null {
  if (input.endDate && input.endDate < input.startDate) return "End date cannot be before the start date.";
  if (input.depositAmount != null && input.type !== "RENTAL") return "A deposit is recorded on a rental agreement only.";
  if (input.depositAmount != null && input.depositAmount < 0) return "The deposit cannot be negative.";
  if (input.type === "RENTAL") {
    if (input.rentAmount == null) return "A rental agreement needs a monthly rent amount.";
    if (input.managementFeeAmount != null) return "A rental agreement cannot have a management fee.";
  }
  if (input.type === "OWNERSHIP") {
    if (input.rentAmount != null) return "Purchased-unit owners are not charged rent.";
    if (input.managementFeeAmount != null) return "Record the management fee on a separate management agreement.";
    if (!input.ownershipEvidence) return "An ownership record requires ownership evidence (e.g. sale agreement or title reference).";
  }
  if (input.type === "MANAGEMENT" && input.rentAmount != null) return "A management agreement does not charge rent to the owner.";
  return null;
}

/** Inserts an agreement and its audit event inside the caller's transaction (no permission check). */
async function insertAgreement(tx: DbOrTx, actor: Actor, input: AgreementInput, buildingId: string) {
  const unit = await tx.unit.findUnique({ where: { id: input.unitId }, select: { buildingId: true, isActive: true } });
  if (!unit || unit.buildingId !== buildingId) throw new BusinessError("Choose a unit of this building.");
  if (!unit.isActive) throw new BusinessError("This unit is retired and cannot receive new agreements.");
  const ag = await tx.agreement.create({
    data: {
      buildingId,
      unitId: input.unitId,
      partyId: input.partyId,
      type: input.type,
      status: input.endDate && input.endDate < todayISO() ? "ENDED" : "ACTIVE",
      reference: input.reference,
      startDate: toDbDate(input.startDate),
      endDate: input.endDate ? toDbDate(input.endDate) : null,
      rentAmount: input.rentAmount != null ? centsToDecimalString(input.rentAmount) : null,
      managementFeeAmount: input.managementFeeAmount != null ? centsToDecimalString(input.managementFeeAmount) : null,
      depositAmount: input.depositAmount != null ? centsToDecimalString(input.depositAmount) : null,
      dueDay: input.dueDay,
      graceDays: input.graceDays,
      purchaseDate: input.purchaseDate ? toDbDate(input.purchaseDate) : null,
      ownershipEvidence: input.ownershipEvidence,
      lateFeeTerms: input.lateFeeTerms,
      allocationTerms: input.allocationTerms,
      notes: input.notes,
      createdById: actor.id,
    },
    include: { unit: true, party: true },
  });
  await audit(tx, actor, {
    action: "agreement.create",
    entityType: "Agreement",
    entityId: ag.id,
    summary: `Created ${ag.type.toLowerCase()} agreement for unit ${ag.unit.unitNumber} with ${ag.party.displayName}`,
    after: { ...input },
  });
  return ag;
}

export async function createAgreement(actor: Actor, input: AgreementInput, { documentIds = [] }: { documentIds?: string[] } = {}) {
  requirePermission(actor, "agreements.manage");
  const problem = validateAgreement(input);
  if (problem) throw new BusinessError(problem);
  const building = await getBuilding();
  if (input.type === "MANAGEMENT") {
    const owner = await db.agreement.findFirst({
      where: {
        unitId: input.unitId, partyId: input.partyId, type: "OWNERSHIP", status: { not: "CANCELLED" },
        startDate: { lte: toDbDate(input.startDate) },
      },
    });
    if (!owner) throw new BusinessError("A management agreement must be with the unit's owner. Record the ownership first.");
  }
  try {
    return await db.$transaction(async (tx) => {
      await lockActiveParty(tx, input.partyId);
      const ag = await insertAgreement(tx, actor, input, building.id);
      await attachStaged(tx, actor, documentIds, "AGREEMENT", ag.id);
      return ag;
    });
  } catch (e) {
    if (e instanceof BusinessError) throw e;
    throw new BusinessError(describeDbError(e) ?? "Could not create the agreement.");
  }
}

export async function getAgreement(actor: Actor, id: string) {
  requirePermission(actor, "agreements.view");
  const ag = await db.agreement.findUnique({
    where: { id },
    include: { unit: true, party: true, charges: { orderBy: { effectiveFrom: "asc" } } },
  });
  if (!ag) return null;
  const invoices = can(actor.role, "invoices.view")
    ? await db.invoice.findMany({ where: { agreementId: id }, orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }] })
    : [];
  return { agreement: ag, invoices };
}

export async function listAgreements(actor: Actor, filter: { status?: string; type?: string } = {}) {
  requirePermission(actor, "agreements.view");
  return db.agreement.findMany({
    where: {
      ...(filter.status ? { status: filter.status as "ACTIVE" } : {}),
      ...(filter.type ? { type: filter.type as "RENTAL" } : {}),
    },
    include: { unit: true, party: true },
    orderBy: [{ status: "asc" }, { startDate: "desc" }],
  });
}

/** The three kinds of account the Add Account form registers (each maps to existing agreement types). */
export const ACCOUNT_TYPES = ["TENANT", "OWNER", "MANAGED"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Recurring charges that may be entered with a new account: never rent or management fees. */
export type InitialCharge = { category: "SERVICE_CHARGE" | "SHARED_CHARGE"; description: string; amount: Cents; effectiveFrom: ISODate; effectiveTo: ISODate | null };

export interface NewAccountInput {
  party: PartyInput;
  accountType: AccountType;
  unitId: string;
  /** TENANT: the rental agreement. */
  tenancy?: { startDate: ISODate; endDate: ISODate | null; rentAmount: Cents | null; depositAmount?: Cents | null; dueDay: number | null; graceDays: number | null; reference: string | null; lateFeeTerms: string | null; allocationTerms: string | null; notes: string | null };
  /** OWNER and MANAGED: the ownership record of the purchased unit (never rent). */
  ownership?: { startDate: ISODate; purchaseDate: ISODate | null; ownershipEvidence: string | null; reference: string | null; dueDay: number | null; notes: string | null };
  /** MANAGED: the management agreement with BAKAAL. A missing fee is allowed but flagged for review. */
  management?: { startDate: ISODate; endDate: ISODate | null; managementFeeAmount: Cents | null; dueDay: number | null; graceDays: number | null; reference: string | null; notes: string | null };
  /** Approved service/shared charges, added to the tenancy (TENANT), ownership (OWNER) or management (MANAGED) agreement. */
  charges?: InitialCharge[];
  /** Staged uploads: account documents, the main agreement's documents (rental/ownership), management agreement documents. */
  documents: { account: string[]; agreement: string[]; management: string[] };
  /**
   * Issue this month's invoice(s) for the new account in the same transaction (F65), by the same
   * rules as monthly billing; only for roles that may issue billing (otherwise ignored).
   */
  billNow?: boolean;
}

const blankTerms = { rentAmount: null, managementFeeAmount: null, purchaseDate: null, ownershipEvidence: null, lateFeeTerms: null, allocationTerms: null, graceDays: null, endDate: null } as const;

/** The agreements an account type creates, built only from the terms entered (nothing invented). */
function agreementsFor(input: NewAccountInput): { main: AgreementInput; management: AgreementInput | null } {
  const base = { unitId: input.unitId, partyId: "" };
  if (input.accountType === "TENANT") {
    if (!input.tenancy) throw new BusinessError("Enter the rental agreement details.");
    const t = input.tenancy;
    return { main: { ...blankTerms, ...base, type: "RENTAL", ...t }, management: null };
  }
  if (!input.ownership) throw new BusinessError("Enter the ownership record of the purchased unit.");
  const o = input.ownership;
  const main: AgreementInput = { ...blankTerms, ...base, type: "OWNERSHIP", startDate: o.startDate, purchaseDate: o.purchaseDate, ownershipEvidence: o.ownershipEvidence, reference: o.reference, dueDay: o.dueDay, notes: o.notes };
  if (input.accountType === "OWNER") return { main, management: null };
  if (!input.management) throw new BusinessError("Enter the management agreement with BAKAAL.");
  const m = input.management;
  if (m.startDate < o.startDate) throw new BusinessError("The management agreement cannot start before the owner's ownership starts.");
  return { main, management: { ...blankTerms, ...base, type: "MANAGEMENT", ...m } };
}

function checkCharges(charges: InitialCharge[], on: AgreementInput) {
  for (const c of charges) {
    if (c.category !== "SERVICE_CHARGE" && c.category !== "SHARED_CHARGE") throw new BusinessError("Only service or shared charges can be added here. Rent and management fees are set on their agreements.");
    if (!c.description.trim()) throw new BusinessError("Describe each recurring charge (e.g. the approved service charge).");
    if (!(c.amount > 0)) throw new BusinessError("Each recurring charge needs a positive amount.");
    if (c.effectiveTo && c.effectiveTo < c.effectiveFrom) throw new BusinessError("A charge's end date cannot be before its start date.");
    if (c.effectiveFrom < on.startDate) throw new BusinessError("A charge cannot start before its agreement starts.");
    if (on.endDate && c.effectiveFrom > on.endDate) throw new BusinessError("A charge cannot start after its agreement ends.");
  }
}

/** Terms the account still needs before billing can run normally (shown for review, never filled in). */
export function missingTermsFor(input: NewAccountInput): string[] {
  const flags: string[] = [];
  if (input.accountType === "MANAGED" && input.management && input.management.managementFeeAmount == null) {
    flags.push("No monthly management fee is recorded; no management fee will be billed until the agreed fee is confirmed.");
  }
  return flags;
}

/**
 * Registers an account of one of the three types, with its agreements, approved charges and
 * documents, in ONE transaction: if any part fails (duplicate details, unit already let or
 * owned, invalid terms, missing upload) nothing is saved.
 * - TENANT: a rental agreement (rent, plus any approved service/shared charges).
 * - OWNER: an ownership record only (no rent); optional approved service/shared charges.
 * - MANAGED: an ownership record and a management agreement (management fee as agreed);
 *   approved service/shared charges go on the management agreement.
 */
export async function createAccount(actor: Actor, input: NewAccountInput) {
  requirePermission(actor, "accounts.manage");
  requirePermission(actor, "agreements.manage");
  if (!ACCOUNT_TYPES.includes(input.accountType)) throw new BusinessError("Choose an account type.");
  const { main, management } = agreementsFor(input);
  for (const ag of [main, management]) {
    const problem = ag && validateAgreement(ag);
    if (problem) throw new BusinessError(problem);
  }
  const charges = input.charges ?? [];
  checkCharges(charges, management ?? main);
  const building = await getBuilding();
  try {
    return await db.$transaction(async (tx) => {
      await lockAccountContacts(tx);
      const matches = await findDuplicates(tx, input.party);
      if (matches.length) throw new DuplicateAccountError(matches);
      const party = await tx.party.create({ data: input.party });
      await audit(tx, actor, { action: "account.create", entityType: "Party", entityId: party.id, summary: `Created account ${party.displayName} (${ACCOUNT_TYPE_LABELS[input.accountType]})`, after: { ...maskParty(party), accountType: input.accountType } });
      const mainAg = await insertAgreement(tx, actor, { ...main, partyId: party.id }, building.id);
      const managementAg = management ? await insertAgreement(tx, actor, { ...management, partyId: party.id }, building.id) : null;
      const chargedAg = managementAg ?? mainAg;
      for (const c of charges) await insertCharge(tx, actor, chargedAg, c);
      await attachStaged(tx, actor, input.documents.account, "PARTY", party.id);
      await attachStaged(tx, actor, input.documents.agreement, "AGREEMENT", mainAg.id);
      if (input.documents.management.length && !managementAg) throw new BusinessError("Management agreement documents need a management agreement.");
      if (managementAg) await attachStaged(tx, actor, input.documents.management, "AGREEMENT", managementAg.id);
      // The first invoice: this month, this account, every charge type. A part month, a missing due date or fee is
      // held for review exactly as in a billing run; if issuing fails, the account is not created either.
      const firstBilling = input.billNow && can(actor.role, "billing.issue") ? await billMonth(tx, actor, building.id, monthStart(todayISO()), { categories: [], partyIds: [party.id] }, "REGISTRATION") : null;
      return { party, agreement: mainAg, management: managementAg, flags: missingTermsFor(input), firstBilling };
    });
  } catch (e) {
    if (e instanceof BusinessError) throw e;
    throw new BusinessError(describeDbError(e) ?? "Could not create the account.");
  }
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  TENANT: "Rent-paying tenant",
  OWNER: "Purchased unit owner",
  MANAGED: "Purchased unit managed by BAKAAL",
};

/** Account types from the agreements in force (an account can be, e.g., an owner who also rents). */
export function accountTypesOf(agreementTypes: Iterable<"RENTAL" | "OWNERSHIP" | "MANAGEMENT">): AccountType[] {
  const t = new Set(agreementTypes);
  const out: AccountType[] = [];
  if (t.has("RENTAL")) out.push("TENANT");
  if (t.has("MANAGEMENT")) out.push("MANAGED");
  else if (t.has("OWNERSHIP")) out.push("OWNER");
  return out;
}

async function insertCharge(tx: DbOrTx, actor: Actor, ag: { id: string; unit: { unitNumber: string } }, input: Omit<InitialCharge, "category"> & { category: "SERVICE_CHARGE" | "SHARED_CHARGE" | "OTHER" }) {
  // The same charge twice on one agreement for overlapping months would bill it twice (a repeated row,
  // a resubmitted form): refuse it. The agreement row lock makes simultaneous additions wait for each other.
  await tx.$queryRaw`SELECT id FROM "Agreement" WHERE id = ${ag.id} FOR UPDATE`;
  const description = input.description.trim();
  const same = await tx.agreementCharge.findFirst({
    where: {
      agreementId: ag.id,
      category: input.category,
      description: { equals: description, mode: "insensitive" },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: toDbDate(input.effectiveFrom) } }],
      ...(input.effectiveTo ? { effectiveFrom: { lte: toDbDate(input.effectiveTo) } } : {}),
    },
  });
  if (same) {
    throw new BusinessError(`"${description}" is already charged on this agreement for some of these months. End the existing charge first, or give the new charge its own description.`);
  }
  const charge = await tx.agreementCharge.create({
    data: {
      agreementId: ag.id,
      category: input.category,
      description: input.description.trim(),
      amount: centsToDecimalString(input.amount),
      effectiveFrom: toDbDate(input.effectiveFrom),
      effectiveTo: input.effectiveTo ? toDbDate(input.effectiveTo) : null,
    },
  });
  await audit(tx, actor, {
    action: "agreement.charge_add",
    entityType: "Agreement",
    entityId: ag.id,
    summary: `Added recurring charge "${input.description.trim()}" to agreement for unit ${ag.unit.unitNumber}`,
    after: { ...input, amount: centsToDecimalString(input.amount) },
  });
  return charge;
}

export async function addAgreementCharge(
  actor: Actor,
  agreementId: string,
  input: { category: "SERVICE_CHARGE" | "SHARED_CHARGE" | "OTHER"; description: string; amount: Cents; effectiveFrom: ISODate; effectiveTo: ISODate | null },
) {
  requirePermission(actor, "agreements.manage");
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) throw new BusinessError("The charge end date cannot be before its start date.");
  return db.$transaction(async (tx) => {
    const ag = await tx.agreement.findUniqueOrThrow({ where: { id: agreementId }, include: { unit: true } });
    if (ag.status !== "ACTIVE") throw new BusinessError(`Charges cannot be added to an ${ag.status === "ENDED" ? "ended" : "cancelled"} agreement.`);
    if (ag.endDate && input.effectiveFrom > fromDbDate(ag.endDate)) throw new BusinessError("A charge cannot start after the agreement ends.");
    if (input.effectiveFrom < fromDbDate(ag.startDate)) throw new BusinessError("A charge cannot start before the agreement starts.");
    return insertCharge(tx, actor, ag, input);
  });
}

/** Ends a recurring charge (no deletion, so issued invoices keep their history). */
export async function endAgreementCharge(actor: Actor, chargeId: string, effectiveTo: ISODate) {
  requirePermission(actor, "agreements.manage");
  return db.$transaction(async (tx) => {
    const before = await tx.agreementCharge.findUniqueOrThrow({ where: { id: chargeId } });
    if (effectiveTo < fromDbDate(before.effectiveFrom)) throw new BusinessError("End date cannot be before the charge started.");
    // Like ending an agreement: the record must not end before a month already invoiced with it.
    const lastBilled = await tx.invoice.findFirst({ where: { status: "ISSUED", lines: { some: { sourceType: "AGREEMENT_CHARGE", sourceId: chargeId } } }, orderBy: { periodEnd: "desc" } });
    if (lastBilled?.periodEnd && fromDbDate(lastBilled.periodEnd) > effectiveTo) {
      throw new BusinessError(`This charge has already been billed to ${fromDbDate(lastBilled.periodEnd)}. Choose an end date on or after that, or correct the later invoice with a credit note first.`);
    }
    const after = await tx.agreementCharge.update({ where: { id: chargeId }, data: { effectiveTo: toDbDate(effectiveTo) } });
    await audit(tx, actor, { action: "agreement.charge_end", entityType: "Agreement", entityId: before.agreementId, summary: `Ended recurring charge "${before.description}" on ${effectiveTo}`, before, after });
    return after;
  });
}

/**
 * A management agreement rests on the owner's ownership record for the same unit: the ownership
 * may not be cancelled (endDate null) or end before a management agreement that continues after it.
 */
async function requireNoManagementBeyond(tx: DbOrTx, ownership: { unitId: string; partyId: string }, endDate: ISODate | null) {
  const management = await tx.agreement.findFirst({
    where: {
      type: "MANAGEMENT",
      unitId: ownership.unitId,
      partyId: ownership.partyId,
      status: { not: "CANCELLED" },
      ...(endDate ? { OR: [{ endDate: null }, { endDate: { gt: toDbDate(endDate) } }] } : {}),
    },
  });
  if (management) {
    throw new BusinessError(
      endDate
        ? "BAKAAL's management agreement for this unit continues after this date. End the management agreement first (on or before this date), then the ownership record."
        : "This ownership record backs BAKAAL's management agreement for the unit. Cancel or end the management agreement first.",
    );
  }
}

/**
 * Ends an agreement (proposed Rule 8): recurring billing stops after the end date;
 * all invoices and debts are kept. Any final charges need a reviewed manual invoice.
 */
export async function endAgreement(actor: Actor, id: string, endDate: ISODate, reason: string) {
  requirePermission(actor, "agreements.manage");
  try {
    return await db.$transaction(async (tx) => {
      const before = await tx.agreement.findUniqueOrThrow({ where: { id }, include: { unit: true, party: true } });
      if (before.status !== "ACTIVE") throw new BusinessError("Only an active agreement can be ended.");
      if (endDate < fromDbDate(before.startDate)) throw new BusinessError("The end date cannot be before the agreement started.");
      if (before.type === "OWNERSHIP") await requireNoManagementBeyond(tx, before, endDate);
      const lastBilled = await tx.invoice.findFirst({ where: { agreementId: id, kind: "RECURRING" }, orderBy: { periodStart: "desc" } });
      if (lastBilled?.periodEnd && fromDbDate(lastBilled.periodEnd) > endDate) {
        throw new BusinessError(`This agreement has already been billed to ${fromDbDate(lastBilled.periodEnd)}. Choose an end date on or after that, or correct the later invoice with a credit note first.`);
      }
      const ag = await tx.agreement.update({ where: { id }, data: { endDate: toDbDate(endDate), status: "ENDED", endReason: reason } });
      await audit(tx, actor, {
        action: "agreement.end",
        entityType: "Agreement",
        entityId: id,
        summary: `Ended ${before.type.toLowerCase()} agreement for unit ${before.unit.unitNumber} (${before.party.displayName}) on ${endDate}`,
        before: { status: before.status, endDate: optionalFromDbDate(before.endDate) },
        after: { status: ag.status, endDate },
        reason,
      });
      return ag;
    });
  } catch (e) {
    if (e instanceof BusinessError) throw e;
    throw new BusinessError(describeDbError(e) ?? "Could not end the agreement.");
  }
}

/** Cancels an agreement entered in error. Only allowed before anything was invoiced. */
export async function cancelAgreement(actor: Actor, id: string, reason: string) {
  requirePermission(actor, "agreements.manage");
  return db.$transaction(async (tx) => {
    const before = await tx.agreement.findUniqueOrThrow({ where: { id }, include: { unit: true } });
    if (before.status === "CANCELLED") throw new BusinessError("This agreement is already cancelled.");
    const invoiced = await tx.invoice.count({ where: { agreementId: id } });
    if (invoiced > 0) throw new BusinessError("This agreement has invoices, so it cannot be cancelled. End it instead.");
    if (before.type === "OWNERSHIP") await requireNoManagementBeyond(tx, before, null);
    const ag = await tx.agreement.update({ where: { id }, data: { status: "CANCELLED", endReason: reason } });
    await audit(tx, actor, { action: "agreement.cancel", entityType: "Agreement", entityId: id, summary: `Cancelled agreement for unit ${before.unit.unitNumber} (entered in error)`, before: { status: before.status }, after: { status: "CANCELLED" }, reason });
    return ag;
  });
}

// ---------------------------------------------------------------- account lookup for forms

const BILLING_ORDER = { MANAGEMENT: 0, RENTAL: 1, OWNERSHIP: 2 } as const;

/**
 * An account's units with what its agreements say on a date: the agreement billing uses, the agreed
 * rent (rental agreements only), the agreed management fee (shown apart from rent) and the approved
 * charges in force. Read-only; forms use it to fill in the unit and show the terms, never to save them.
 * Amounts are shown only to roles that may see invoices.
 */
export async function accountContext(actor: Actor, partyId: string, on: ISODate): Promise<AccountContext | null> {
  requirePermission(actor, "accounts.view");
  requirePermission(actor, "agreements.view");
  const party = await db.party.findUnique({
    where: { id: partyId },
    include: { agreements: { where: { status: { not: "CANCELLED" } }, include: { unit: true, charges: true }, orderBy: { startDate: "desc" } } },
  });
  if (!party) return null;
  const amountsShown = can(actor.role, "invoices.view");
  const byUnit = new Map<string, typeof party.agreements>();
  for (const a of party.agreements) byUnit.set(a.unitId, [...(byUnit.get(a.unitId) ?? []), a]);
  const units: ContextUnit[] = [...byUnit.values()].map((ags) => {
    const shaped = ags.map((a): ContextAgreement & { source: (typeof ags)[number] } => {
      const startDate = fromDbDate(a.startDate);
      const endDate = optionalFromDbDate(a.endDate);
      return { id: a.id, type: a.type, status: a.status as "ACTIVE" | "ENDED", reference: a.reference, startDate, endDate, inForce: startDate <= on && (endDate == null || endDate >= on), source: a };
    });
    const live = shaped.filter((a) => a.inForce).sort((x, y) => BILLING_ORDER[x.type] - BILLING_ORDER[y.type]);
    const main = live[0] ?? shaped[0]; // newest first when none is in force
    const rental = live.find((a) => a.type === "RENTAL");
    const management = live.find((a) => a.type === "MANAGEMENT");
    const strip = ({ source: _source, ...a }: (typeof shaped)[number]): ContextAgreement => a;
    return {
      unitId: ags[0].unitId,
      unitNumber: ags[0].unit.unitNumber,
      inForce: live.length > 0,
      agreement: main ? strip(main) : null,
      rent: amountsShown && rental && rental.source.rentAmount != null ? { amount: cents(rental.source.rentAmount)!, agreementId: rental.id } : null,
      deposit: amountsShown && rental ? cents(rental.source.depositAmount) : null,
      managementFee: amountsShown && management ? { amount: cents(management.source.managementFeeAmount), agreementId: management.id } : null,
      charges: amountsShown
        ? live.flatMap((a) =>
            a.source.charges
              .filter((c) => fromDbDate(c.effectiveFrom) <= on && (c.effectiveTo == null || fromDbDate(c.effectiveTo) >= on))
              .map((c) => ({ description: c.description, category: c.category, amount: cents(c.amount)! })),
          )
        : [],
      agreements: shaped.map(strip),
    };
  });
  units.sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));
  return { party: { id: party.id, name: party.displayName, archived: party.archivedAt != null }, on, amountsShown, units };
}

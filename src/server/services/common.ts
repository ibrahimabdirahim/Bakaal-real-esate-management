import { db, type DbOrTx } from "@/server/db";
import { BusinessError, type Actor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { toCents } from "@/lib/money";

/** Next number in a named sequence, e.g. INV-2026-000123. Safe under concurrency. */
export async function nextNumber(tx: DbOrTx, key: string, prefix: string, year: number): Promise<string> {
  const seqKey = `${key}-${year}`;
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "DocumentSequence" ("key", "nextValue") VALUES (${seqKey}, 2)
    ON CONFLICT ("key") DO UPDATE SET "nextValue" = "DocumentSequence"."nextValue" + 1
    RETURNING "nextValue" - 1 AS value`;
  return `${prefix}-${year}-${String(rows[0].value).padStart(6, "0")}`;
}

/** Release 1 manages one building. */
export async function getBuilding() {
  const building = await db.building.findFirst({ orderBy: { createdAt: "asc" } });
  if (!building) throw new BusinessError("No building has been set up yet. An administrator must create it under Settings.");
  return building;
}

export async function findBuilding() {
  return db.building.findFirst({ orderBy: { createdAt: "asc" } });
}

/** Every registered building, oldest first (the first is the one the services report on). */
export async function listBuildings() {
  return db.building.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, address: true } });
}

/**
 * Inside a transaction, locks the account (FOR SHARE) and refuses archived or missing
 * accounts. Archiving takes FOR UPDATE on the same row, so an archive and a new
 * agreement, invoice or payment for that account can never both succeed.
 */
export async function lockActiveParty(tx: DbOrTx, partyId: string) {
  const rows = await tx.$queryRaw<{ archivedAt: Date | null }[]>`SELECT "archivedAt" FROM "Party" WHERE id = ${partyId} FOR SHARE`;
  if (rows.length === 0) throw new BusinessError("The selected account does not exist.");
  if (rows[0].archivedAt) throw new BusinessError("This account is archived. Archived accounts cannot be used for new agreements, invoices or payments.");
}

/** Record types the audit log and activity feed can link to. */
export const RECORD_LINKS: Record<string, string> = {
  Unit: "/units",
  Party: "/accounts",
  Agreement: "/agreements",
  Invoice: "/invoices",
  Payment: "/payments",
  Expense: "/expenses",
  StaffMember: "/staff",
  WorkOrder: "/maintenance",
};

/** Audit actions after which the record no longer exists but its page explains what happened. */
const GONE_WITH_EXPLANATION = ["account.delete", "invoice.draft_discard"];

/**
 * Which referenced records can be linked: those that still exist, plus deleted accounts and
 * discarded draft invoices (their pages say who removed them and when). Audit history is
 * append-only, so it can mention records that are gone; linking those would only lead to a
 * "not found" page. Keys are "Type:id"; values are the page to link to. Salary payments link to
 * their salary page, and only for readers with salary access (others could not open them).
 */
export async function linkableRecords(actor: Actor, refs: { entityType: string; entityId: string | null }[]): Promise<Map<string, string>> {
  const ids = (type: string) => [...new Set(refs.filter((r) => r.entityType === type && r.entityId).map((r) => r.entityId!))];
  const only = { select: { id: true } } as const;
  const found = await Promise.all([
    db.unit.findMany({ where: { id: { in: ids("Unit") } }, ...only }).then((x) => x.map((r) => `Unit:${r.id}`)),
    db.party.findMany({ where: { id: { in: ids("Party") } }, ...only }).then((x) => x.map((r) => `Party:${r.id}`)),
    db.agreement.findMany({ where: { id: { in: ids("Agreement") } }, ...only }).then((x) => x.map((r) => `Agreement:${r.id}`)),
    db.invoice.findMany({ where: { id: { in: ids("Invoice") } }, ...only }).then((x) => x.map((r) => `Invoice:${r.id}`)),
    db.payment.findMany({ where: { id: { in: ids("Payment") } }, ...only }).then((x) => x.map((r) => `Payment:${r.id}`)),
    db.expense
      .findMany({ where: { id: { in: ids("Expense") } }, select: { id: true, category: true, staffMemberId: true } })
      .then((x) => x.filter((r) => r.category !== "SALARIES" || can(actor.role, "salary.view")).map((r) => `Expense:${r.id}`)),
    db.staffMember.findMany({ where: { id: { in: ids("StaffMember") } }, ...only }).then((x) => x.map((r) => `StaffMember:${r.id}`)),
    db.workOrder.findMany({ where: { id: { in: ids("WorkOrder") } }, ...only }).then((x) => x.map((r) => `WorkOrder:${r.id}`)),
  ]);
  const href = (key: string) => {
    const [type, id] = key.split(":");
    return `${RECORD_LINKS[type]}/${id}`;
  };
  const linkable = new Map(found.flat().map((k) => [k, href(k)]));
  const salaries = await db.expense.findMany({ where: { id: { in: ids("Expense") }, category: "SALARIES", staffMemberId: { not: null } }, select: { id: true } });
  for (const s of salaries) if (linkable.has(`Expense:${s.id}`)) linkable.set(`Expense:${s.id}`, `/staff/salary-payments/${s.id}`);
  const missing = refs.filter((r) => r.entityId && RECORD_LINKS[r.entityType] && !linkable.has(`${r.entityType}:${r.entityId}`) && r.entityType !== "Expense");
  if (missing.length) {
    const gone = await db.auditEvent.findMany({
      where: { action: { in: GONE_WITH_EXPLANATION }, entityId: { in: [...new Set(missing.map((r) => r.entityId!))] } },
      select: { entityType: true, entityId: true },
    });
    for (const g of gone) linkable.set(`${g.entityType}:${g.entityId}`, href(`${g.entityType}:${g.entityId}`));
  }
  return linkable;
}

export const cents = (v: { toString(): string } | null | undefined) => (v == null ? null : toCents(v));
export const centsOrZero = (v: { toString(): string } | null | undefined) => (v == null ? 0 : toCents(v));

/** Maps a Prisma unique/exclusion violation to a readable message. */
export function describeDbError(e: unknown): string | null {
  const err = e as { code?: string; message?: string; meta?: { target?: unknown } };
  const msg = String(err?.message ?? "");
  if (msg.includes("Agreement_no_overlap")) {
    return "This unit already has an agreement of this type covering some of these dates.";
  }
  if (err?.code === "P2002") return "A record with these details already exists.";
  const doc = /(attached documents? [^\n";]*)/.exec(msg);
  if (doc) return `The database refused this change: ${doc[1]}.`;
  const raised =
    /(issued invoice[^\n"]*|payment details cannot change[^\n"]*|allocations cannot be edited|audit events are append-only|is not allowed[^\n"]*|a (?:paid|rejected) expense cannot be changed[^\n"]*|expense \S+ cannot be deleted once submitted|the details of a submitted expense cannot be changed[^\n"]*|a submitted expense can only be approved or rejected[^\n"]*|an approved expense can only be marked as paid[^\n"]*)/.exec(msg);
  if (raised) return `The database refused this change: ${raised[1]}.`;
  return null;
}

// Documents (PDF, JPEG, PNG) attached to records. Files are uploaded one at a time and
// "staged" (owner not set); saving a record attaches its staged files in the same database
// transaction. Attached documents are never deleted, only soft-removed with a reason.
import { db, type DbOrTx } from "@/server/db";
import { audit } from "@/server/audit";
import { BusinessError, requirePermission, type Actor } from "@/server/auth/actor";
import { can, type Permission } from "@/server/auth/permissions";
import { deleteStoredFile, detectType, MAX_DOCUMENT_BYTES, readStoredFile, safeFileName, storeFile } from "@/server/storage";
import type { DocumentCategory, DocumentOwner } from "@/generated/prisma/client";
import { CATEGORY_LABELS } from "@/lib/documents";

export { CATEGORY_LABELS };

export type { DocumentCategory, DocumentOwner };


interface OwnerRule {
  view: Permission;
  manage: Permission;
  categories: DocumentCategory[];
  /** Categories that also need this permission to view (identity documents, photographs of people). */
  sensitive?: { categories: DocumentCategory[]; permission: Permission };
  auditType: string;
}

/** Who may see and add documents, per kind of record (mirrors the record's own permissions). */
export const OWNER_RULES: Record<DocumentOwner, OwnerRule> = {
  PARTY: { view: "accounts.view", manage: "accounts.manage", categories: ["ID_DOCUMENT", "PHOTO", "OTHER"], sensitive: { categories: ["ID_DOCUMENT", "PHOTO"], permission: "accounts.view_sensitive" }, auditType: "Party" },
  AGREEMENT: { view: "agreements.view", manage: "agreements.manage", categories: ["SIGNED_AGREEMENT", "OTHER"], auditType: "Agreement" },
  UNIT: { view: "units.view", manage: "units.manage", categories: ["PHOTO", "OTHER"], auditType: "Unit" },
  PAYMENT: { view: "payments.view", manage: "payments.record", categories: ["PROOF_OF_PAYMENT", "OTHER"], auditType: "Payment" },
  EXPENSE: { view: "expenses.view", manage: "expenses.submit", categories: ["RECEIPT", "SUPPLIER_INVOICE", "OTHER"], auditType: "Expense" },
  WORK_ORDER: { view: "workorders.view", manage: "workorders.manage", categories: ["PHOTO", "SUPPLIER_INVOICE", "OTHER"], auditType: "WorkOrder" },
  // Staff files (contracts, IDs) are HR records: only roles that manage staff see them.
  STAFF_MEMBER: { view: "staff.manage", manage: "staff.manage", categories: ["ID_DOCUMENT", "PHOTO", "OTHER"], auditType: "StaffMember" },
};

const STAGED_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_FILES_PER_RECORD_SAVE = 20;

/** Uploads that were never saved with a record (abandoned forms) are removed after a day. */
async function purgeStaleStaged() {
  const stale = await db.document.findMany({ where: { ownerType: null, uploadedAt: { lt: new Date(Date.now() - STAGED_LIFETIME_MS) } }, select: { id: true, storageKey: true }, take: 100 });
  for (const d of stale) {
    await db.document.deleteMany({ where: { id: d.id, ownerType: null } });
    await deleteStoredFile(d.storageKey);
  }
}

/**
 * Stores an uploaded file as staged. The file's real type is read from its first bytes;
 * the uploader must be allowed to add documents to the kind of record it is for.
 */
export async function stageUpload(actor: Actor, input: { ownerType: DocumentOwner; category: DocumentCategory; fileName: string; bytes: Uint8Array }) {
  const rule = OWNER_RULES[input.ownerType];
  if (!rule) throw new BusinessError("Unknown record type for this document.");
  requirePermission(actor, rule.manage);
  if (!rule.categories.includes(input.category)) throw new BusinessError("This kind of document cannot be attached here.");
  if (input.bytes.byteLength === 0) throw new BusinessError("The file is empty.");
  if (input.bytes.byteLength > MAX_DOCUMENT_BYTES) throw new BusinessError(`The file is larger than ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB.`);
  const type = detectType(input.bytes);
  if (!type) throw new BusinessError("Only PDF, JPEG and PNG files are accepted. The file's contents do not match one of these types.");
  await purgeStaleStaged();
  const { key, sha256 } = await storeFile(input.bytes, type);
  try {
    return await db.document.create({
      data: { category: input.category, originalName: safeFileName(input.fileName), storageKey: key, mimeType: type, sizeBytes: input.bytes.byteLength, sha256, uploadedById: actor.id },
      select: { id: true, originalName: true, mimeType: true, sizeBytes: true, category: true },
    });
  } catch (e) {
    await deleteStoredFile(key); // no orphan file if the metadata cannot be saved
    throw e;
  }
}

/** Cancels a staged upload (the user removed it before saving the form). Only the uploader may. */
export async function discardStaged(actor: Actor, id: string) {
  const doc = await db.document.findUnique({ where: { id } });
  if (!doc || doc.ownerType !== null || doc.uploadedById !== actor.id) throw new BusinessError("This upload cannot be removed here.");
  await db.document.deleteMany({ where: { id, ownerType: null } });
  await deleteStoredFile(doc.storageKey);
}

/**
 * Inside the caller's transaction, attaches the actor's staged uploads to a record. Fails
 * (rolling the whole save back) if any file is missing, someone else's, already attached,
 * or not a kind of document this record accepts.
 */
export async function attachStaged(tx: DbOrTx, actor: Actor, documentIds: string[], ownerType: DocumentOwner, ownerId: string) {
  const ids = [...new Set(documentIds.filter(Boolean))];
  if (ids.length === 0) return [];
  if (ids.length > MAX_FILES_PER_RECORD_SAVE) throw new BusinessError(`Attach at most ${MAX_FILES_PER_RECORD_SAVE} files at a time.`);
  const rule = OWNER_RULES[ownerType];
  const docs = await tx.document.findMany({ where: { id: { in: ids }, uploadedById: actor.id, ownerType: null } });
  if (docs.length !== ids.length) throw new BusinessError("One or more uploaded files could not be found (they may have expired). Please upload them again.");
  const wrong = docs.find((d) => !rule.categories.includes(d.category));
  if (wrong) throw new BusinessError(`“${wrong.originalName}” is a ${CATEGORY_LABELS[wrong.category].toLowerCase()}, which cannot be attached to this record.`);
  const now = new Date();
  for (const d of docs) {
    // Conditional update: a concurrent save of the same upload attaches it only once.
    const { count } = await tx.document.updateMany({ where: { id: d.id, ownerType: null }, data: { ownerType, ownerId, attachedAt: now } });
    if (count !== 1) throw new BusinessError("An uploaded file was saved with another record at the same time. Please upload it again.");
    await audit(tx, actor, {
      action: "document.attach",
      entityType: rule.auditType,
      entityId: ownerId,
      summary: `Attached ${CATEGORY_LABELS[d.category].toLowerCase()} “${d.originalName}”`,
      after: { documentId: d.id, category: d.category, mimeType: d.mimeType, sizeBytes: d.sizeBytes, sha256: d.sha256 },
    });
  }
  return docs.map((d) => d.id);
}

/** The record must exist and accept new documents (e.g. archived accounts are closed). */
async function requireOpenOwner(tx: DbOrTx, ownerType: DocumentOwner, ownerId: string) {
  const exists = await {
    PARTY: () => tx.party.findUnique({ where: { id: ownerId }, select: { archivedAt: true } }).then((p) => (p ? (p.archivedAt ? "archived" : "ok") : null)),
    AGREEMENT: () => tx.agreement.findUnique({ where: { id: ownerId }, select: { id: true } }).then((x) => (x ? "ok" : null)),
    UNIT: () => tx.unit.findUnique({ where: { id: ownerId }, select: { id: true } }).then((x) => (x ? "ok" : null)),
    PAYMENT: () => tx.payment.findUnique({ where: { id: ownerId }, select: { id: true } }).then((x) => (x ? "ok" : null)),
    EXPENSE: () => tx.expense.findUnique({ where: { id: ownerId }, select: { id: true } }).then((x) => (x ? "ok" : null)),
    WORK_ORDER: () => tx.workOrder.findUnique({ where: { id: ownerId }, select: { id: true } }).then((x) => (x ? "ok" : null)),
    STAFF_MEMBER: () => tx.staffMember.findUnique({ where: { id: ownerId }, select: { id: true } }).then((x) => (x ? "ok" : null)),
  }[ownerType]();
  if (!exists) throw new BusinessError("The record for these documents no longer exists.");
  if (exists === "archived") throw new BusinessError("This account is archived. Documents can no longer be added to it.");
}

/** Adds staged uploads to an existing record. */
export async function addDocuments(actor: Actor, ownerType: DocumentOwner, ownerId: string, documentIds: string[]) {
  requirePermission(actor, OWNER_RULES[ownerType].manage);
  if (documentIds.filter(Boolean).length === 0) throw new BusinessError("Choose at least one file to attach.");
  return db.$transaction(async (tx) => {
    await requireOpenOwner(tx, ownerType, ownerId);
    return attachStaged(tx, actor, documentIds, ownerType, ownerId);
  });
}

/** Soft-removes an attached document with a reason; the file and the record are kept for history. */
export async function removeDocument(actor: Actor, id: string, reason: string | null = null) {
  const why = reason?.trim() || null;
  const doc = await db.document.findUnique({ where: { id } });
  if (!doc || !doc.ownerType || !doc.ownerId) throw new BusinessError("Document not found.");
  const rule = OWNER_RULES[doc.ownerType];
  requirePermission(actor, rule.manage);
  return db.$transaction(async (tx) => {
    const { count } = await tx.document.updateMany({ where: { id, removedAt: null }, data: { removedAt: new Date(), removedById: actor.id, removeReason: why } });
    if (count !== 1) throw new BusinessError("This document has already been removed.");
    await audit(tx, actor, {
      action: "document.remove",
      entityType: rule.auditType,
      entityId: doc.ownerId,
      summary: `Removed ${CATEGORY_LABELS[doc.category].toLowerCase()} “${doc.originalName}”`,
      before: { documentId: id },
      reason: why,
    });
  });
}

/** Whether the actor may see this attached document (record permission, sensitivity, salary privacy). */
async function canView(actor: Actor, doc: { ownerType: DocumentOwner; ownerId: string; category: DocumentCategory }) {
  const rule = OWNER_RULES[doc.ownerType];
  if (!can(actor.role, rule.view)) return false;
  if (rule.sensitive?.categories.includes(doc.category) && !can(actor.role, rule.sensitive.permission)) return false;
  if (doc.ownerType === "EXPENSE" && !can(actor.role, "salary.view")) {
    const e = await db.expense.findUnique({ where: { id: doc.ownerId }, select: { category: true } });
    if (!e || e.category === "SALARIES") return false;
  }
  return true;
}

/** Current (not removed) documents of a record that the actor may see, plus how many are hidden. */
export async function listDocuments(actor: Actor, ownerType: DocumentOwner, ownerId: string) {
  requirePermission(actor, OWNER_RULES[ownerType].view);
  const all = await db.document.findMany({ where: { ownerType, ownerId }, orderBy: { attachedAt: "desc" } });
  const docs = all.filter((d) => !d.removedAt);
  const visible = [];
  for (const d of docs) if (await canView(actor, { ownerType, ownerId, category: d.category })) visible.push(d);
  // Version history: removed (or replaced) documents, for staff who manage the record or read the audit log.
  const canManage = can(actor.role, OWNER_RULES[ownerType].manage);
  const seeHistory = canManage || can(actor.role, "audit.view");
  const removed = [];
  if (seeHistory) for (const d of all.filter((x) => x.removedAt)) if (await canView(actor, { ownerType, ownerId, category: d.category })) removed.push(d);
  const names = new Map(
    (await db.user.findMany({ where: { id: { in: [...new Set([...visible, ...removed].flatMap((d) => [d.uploadedById, d.removedById ?? ""]))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
  );
  return {
    documents: visible.map((d) => ({ id: d.id, category: d.category, originalName: d.originalName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, uploadedAt: d.uploadedAt, uploadedBy: names.get(d.uploadedById) ?? null })),
    history: removed.map((d) => ({
      id: d.id,
      category: d.category,
      originalName: d.originalName,
      uploadedAt: d.uploadedAt,
      uploadedBy: names.get(d.uploadedById) ?? null,
      removedAt: d.removedAt!,
      removedBy: names.get(d.removedById ?? "") ?? null,
      removeReason: d.removeReason,
    })),
    /** Removed files can be opened only by roles that read the audit log. */
    canOpenHistory: can(actor.role, "audit.view"),
    hidden: docs.length - visible.length,
    canManage,
  };
}

export const OWNER_LABELS: Record<DocumentOwner, string> = {
  PARTY: "Account",
  AGREEMENT: "Agreement",
  UNIT: "Unit",
  PAYMENT: "Payment",
  EXPENSE: "Expense",
  WORK_ORDER: "Work order",
  STAFF_MEMBER: "Staff record",
};

/** The record a document belongs to, as a name and a page (only for records the caller may see). */
async function recordLabels(docs: { ownerType: DocumentOwner; ownerId: string }[]) {
  const ids = (t: DocumentOwner) => [...new Set(docs.filter((d) => d.ownerType === t).map((d) => d.ownerId))];
  const [parties, agreements, units, payments, expenses, workOrders, staff] = await Promise.all([
    db.party.findMany({ where: { id: { in: ids("PARTY") } }, select: { id: true, displayName: true } }),
    db.agreement.findMany({ where: { id: { in: ids("AGREEMENT") } }, select: { id: true, type: true, unit: { select: { unitNumber: true } }, party: { select: { displayName: true } } } }),
    db.unit.findMany({ where: { id: { in: ids("UNIT") } }, select: { id: true, unitNumber: true } }),
    db.payment.findMany({ where: { id: { in: ids("PAYMENT") } }, select: { id: true, reference: true, party: { select: { displayName: true } } } }),
    db.expense.findMany({ where: { id: { in: ids("EXPENSE") } }, select: { id: true, number: true, payee: true, category: true, staffMemberId: true } }),
    db.workOrder.findMany({ where: { id: { in: ids("WORK_ORDER") } }, select: { id: true, number: true, title: true } }),
    db.staffMember.findMany({ where: { id: { in: ids("STAFF_MEMBER") } }, select: { id: true, fullName: true } }),
  ]);
  const map = new Map<string, { label: string; href: string }>();
  for (const x of parties) map.set(`PARTY:${x.id}`, { label: x.displayName, href: `/accounts/${x.id}` });
  for (const x of agreements) map.set(`AGREEMENT:${x.id}`, { label: `${x.type.toLowerCase()} agreement, unit ${x.unit.unitNumber} (${x.party.displayName})`, href: `/agreements/${x.id}` });
  for (const x of units) map.set(`UNIT:${x.id}`, { label: `Unit ${x.unitNumber}`, href: `/units/${x.id}` });
  for (const x of payments) map.set(`PAYMENT:${x.id}`, { label: `Payment ${x.reference} (${x.party.displayName})`, href: `/payments/${x.id}` });
  for (const x of expenses) map.set(`EXPENSE:${x.id}`, { label: `${x.number} ${x.payee}`, href: x.category === "SALARIES" && x.staffMemberId ? `/staff/salary-payments/${x.id}` : `/expenses/${x.id}` });
  for (const x of workOrders) map.set(`WORK_ORDER:${x.id}`, { label: `${x.number} ${x.title}`, href: `/maintenance/${x.id}` });
  for (const x of staff) map.set(`STAFF_MEMBER:${x.id}`, { label: x.fullName, href: `/staff/${x.id}` });
  return map;
}

/**
 * The Documents page: every current (attached, not removed) document the actor may see, with the
 * record it belongs to, searchable by file name, document type or record. Read-only; the same
 * visibility rules as each record's own documents and the download route (canView).
 */
export async function searchDocuments(actor: Actor, filter: { q?: string; category?: DocumentCategory; ownerType?: DocumentOwner } = {}) {
  const viewable = (Object.keys(OWNER_RULES) as DocumentOwner[]).filter((t) => can(actor.role, OWNER_RULES[t].view));
  if (viewable.length === 0) return [];
  const types = filter.ownerType ? viewable.filter((t) => t === filter.ownerType) : viewable;
  const docs = await db.document.findMany({
    where: { ownerType: { in: types }, ownerId: { not: null }, removedAt: null, attachedAt: { not: null }, ...(filter.category ? { category: filter.category } : {}) },
    orderBy: { attachedAt: "desc" },
  });
  const visible = [];
  for (const d of docs) if (await canView(actor, { ownerType: d.ownerType!, ownerId: d.ownerId!, category: d.category })) visible.push(d);
  const records = await recordLabels(visible.map((d) => ({ ownerType: d.ownerType!, ownerId: d.ownerId! })));
  const users = new Map((await db.user.findMany({ where: { id: { in: [...new Set(visible.map((d) => d.uploadedById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const q = filter.q?.trim().toLowerCase();
  return visible
    .map((d) => {
      const record = records.get(`${d.ownerType}:${d.ownerId}`) ?? null;
      return { id: d.id, originalName: d.originalName, category: d.category, mimeType: d.mimeType, sizeBytes: d.sizeBytes, uploadedAt: d.uploadedAt, uploadedBy: users.get(d.uploadedById) ?? null, ownerType: d.ownerType!, record };
    })
    .filter((d) => !q || [d.originalName, CATEGORY_LABELS[d.category], OWNER_LABELS[d.ownerType], d.record?.label ?? ""].some((v) => v.toLowerCase().includes(q)));
}

/**
 * For the download route. Returns null when the document does not exist or the actor may
 * not see it (the route answers 404 in both cases, so existence is not revealed). Staged
 * files are visible only to their uploader; removed ones only to roles that read the audit log.
 */
export async function documentForDownload(actor: Actor, id: string) {
  const doc = await db.document.findUnique({ where: { id } });
  if (!doc) return null;
  if (!doc.ownerType || !doc.ownerId) {
    if (doc.uploadedById !== actor.id) return null;
  } else {
    if (!(await canView(actor, { ownerType: doc.ownerType, ownerId: doc.ownerId, category: doc.category }))) return null;
    if (doc.removedAt && !can(actor.role, "audit.view")) return null;
  }
  return { name: doc.originalName, mimeType: doc.mimeType, bytes: await readStoredFile(doc.storageKey) };
}

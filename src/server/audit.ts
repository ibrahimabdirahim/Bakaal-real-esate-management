import type { DbOrTx } from "@/server/db";
import type { Actor } from "@/server/auth/actor";

// Audit events are written in the same transaction as the change they describe and
// are append-only (a database trigger rejects UPDATE/DELETE). Never pass passwords,
// password hashes, session tokens or other secrets in `before`/`after`.

const SECRET_KEYS = /password|token|secret|hash/i;

function scrub(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(scrub);
  if (value instanceof Date) return value.toISOString();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEYS.test(k)) continue;
    out[k] = typeof v === "bigint" ? v.toString() : v != null && typeof v === "object" && "toFixed" in v ? String(v) : scrub(v);
  }
  return out;
}

export async function audit(
  tx: DbOrTx,
  actor: Actor | null,
  event: {
    action: string;
    entityType: string;
    entityId?: string | null;
    summary: string;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
  },
) {
  await tx.auditEvent.create({
    data: {
      actorId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId ?? null,
      summary: event.summary,
      before: event.before === undefined ? undefined : (scrub(event.before) as object),
      after: event.after === undefined ? undefined : (scrub(event.after) as object),
      reason: event.reason ?? null,
    },
  });
}

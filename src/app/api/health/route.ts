import { db } from "@/server/db";
import { storageKind, storageWritable } from "@/server/storage";
import { errorFields, log } from "@/server/log";

// Health check for the host (e.g. Render) and for checking a deploy: is the app up and can it reach the
// database? Public and read-only: it reveals no record, setting or secret — only "ok", how long the
// database took to answer, the latest database migration applied (to confirm a deploy), and whether
// documents can be saved (storage "ok" or "unwritable"; that alone does not fail the check).
const DB_TIMEOUT_MS = 3000;

export async function GET() {
  const started = Date.now();
  const headers = { "Cache-Control": "no-store" };
  try {
    const rows = await Promise.race([
      db.$queryRaw<{ latest: string | null }[]>`SELECT max(migration_name) AS latest FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`database did not answer within ${DB_TIMEOUT_MS} ms`)), DB_TIMEOUT_MS)),
    ]);
    const storage = (await storageWritable()) ? "ok" : "unwritable";
    if (storage !== "ok") log("warn", "Health check: document storage is not writable", { storageKind: storageKind() });
    return Response.json({ status: "ok", database: "ok", storage, storageKind: storageKind(), latestMigration: rows[0]?.latest ?? null, ms: Date.now() - started }, { headers });
  } catch (e) {
    // Details stay in the server log; the response only says the database could not be reached.
    log("error", "Health check: the database could not be reached", errorFields(e));
    return Response.json({ status: "error", database: "unreachable" }, { status: 503, headers });
  }
}

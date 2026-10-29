import { db } from "@/server/db";
import { storageWritable } from "@/server/storage";

// Health check for the host (e.g. Render) and for checking a deploy: is the app up and can it reach the
// database? Public and read-only: it reveals no record, setting or secret — only "ok", how long the
// database took to answer, the latest database migration applied (to confirm a deploy), and whether
// documents can be saved (a missing persistent disk shows as "unwritable"; it does not fail the check).
export async function GET() {
  const started = Date.now();
  const headers = { "Cache-Control": "no-store" };
  try {
    const rows = await db.$queryRaw<{ latest: string | null }[]>`SELECT max(migration_name) AS latest FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    const storage = (await storageWritable()) ? "ok" : "unwritable";
    return Response.json({ status: "ok", database: "ok", storage, latestMigration: rows[0]?.latest ?? null, ms: Date.now() - started }, { headers });
  } catch {
    // Details stay in the server log; the response only says the database could not be reached.
    console.error("Health check: the database could not be reached.");
    return Response.json({ status: "error", database: "unreachable" }, { status: 503, headers });
  }
}

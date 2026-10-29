// Helpers for database integration tests (never used by the application).
import { rm } from "node:fs/promises";
import path from "node:path";
import { db } from "@/server/db";
import type { Actor } from "@/server/auth/actor";
import type { RoleName } from "@/server/auth/permissions";

export function assertTestDatabase() {
  if (process.env.BAKAAL_INTEGRATION !== "1") throw new Error("Integration tests must run via `npm run test:integration`.");
  const name = new URL(process.env.DATABASE_URL ?? "postgres://x/none").pathname.slice(1);
  if (!name.endsWith("_test")) throw new Error(`Refusing to touch database "${name}".`);
}

/** Empties every table except the append-only audit log, and the test upload folder. Test database only. */
export async function resetTestData() {
  assertTestDatabase();
  await db.$executeRawUnsafe(`TRUNCATE TABLE
    "PaymentAllocation", "Payment", "CreditNote", "BilledCharge", "InvoiceLine", "Invoice", "BillingRun",
    "AgreementCharge", "Agreement", "BuildingPolicy", "Expense", "StaffTask", "StaffMember",
    "WorkOrder", "Unit", "Party", "Session", "User", "Building", "DocumentSequence", "Document" CASCADE`);
  // Test uploads live in their own folder (see src/server/storage.ts); never the real documents.
  await rm(path.join(process.cwd(), "storage", "test-documents"), { recursive: true, force: true });
}

export function actor(role: RoleName, id = `${role.toLowerCase()}-1`): Actor {
  return { id, email: `${id}@test.local`, name: `${role} ${id}`, role };
}

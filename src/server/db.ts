import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// One client per process (survives hot reloads in development).
const globalForDb = globalThis as unknown as { bakaalDb?: PrismaClient };

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export const db: PrismaClient = globalForDb.bakaalDb ?? createClient();
if (process.env.NODE_ENV !== "production") globalForDb.bakaalDb = db;

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
export type DbOrTx = PrismaClient | Tx;


import { defineConfig } from "prisma/config";

// Prisma does not load .env by itself; Node 24 can, without extra packages. Variables already set in
// the environment win over .env. scripts/neon.mjs sets BAKAAL_NO_DOTENV so the local file is not read at all.
if (!process.env.BAKAAL_NO_DOTENV) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env: rely on variables already set in the environment.
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations need a direct (unpooled) connection: on Neon, DIRECT_DATABASE_URL is the direct string and
    // DATABASE_URL the pooled one the app uses. Locally only DATABASE_URL is set, as before.
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});

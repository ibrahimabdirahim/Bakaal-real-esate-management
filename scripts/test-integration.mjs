// Runs the database integration tests against the separate TEST database.
// Refuses to run against anything whose database name does not end in "_test".
import { execFileSync } from "node:child_process";

try {
  process.loadEnvFile(".env");
} catch {
  // Variables may already be set in the environment.
}

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("TEST_DATABASE_URL is not set (see .env.example).");
  process.exit(1);
}
const dbName = new URL(url).pathname.slice(1);
if (!dbName.endsWith("_test")) {
  console.error(`Refusing to run: test database name "${dbName}" does not end in "_test".`);
  process.exit(1);
}

const env = { ...process.env, DATABASE_URL: url, BAKAAL_INTEGRATION: "1" };
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", env });

run("npx", ["prisma", "migrate", "deploy"]);
run("npx", ["vitest", "run", "--config", "vitest.integration.config.mts"]);

// Runs the form-level workflow test against the TEST database (never the dev database).
import { execFileSync } from "node:child_process";

try {
  process.loadEnvFile(".env");
} catch {
  // Variables may already be set.
}
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.slice(1).endsWith("_test")) {
  console.error("TEST_DATABASE_URL must point to a database whose name ends in _test.");
  process.exit(1);
}
const env = { ...process.env, DATABASE_URL: url };
execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env });
execFileSync(
  "node",
  ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./scripts/register.mjs", "scripts/workflow-test.mts"],
  { stdio: "inherit", env },
);

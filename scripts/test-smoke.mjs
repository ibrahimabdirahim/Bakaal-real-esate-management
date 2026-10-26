// Runs the HTTP smoke test against a production build served on port 3200 with the TEST
// database (never the development database). Usage: npm run build && npm run test:smoke
// Run it after `npm run test:workflow`, which leaves realistic records in the test database.
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";

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
if (!existsSync(".next/BUILD_ID")) {
  console.error("No production build found. Run `npm run build` first.");
  process.exit(1);
}
const PORT = 3200;
const env = { ...process.env, DATABASE_URL: url };
execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env });

// Started directly (not through npx) so this PID is the server itself and can be stopped exactly.
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], { env, stdio: "ignore" });
let code = 1;
try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    up = await fetch(`http://localhost:${PORT}/login`).then((r) => r.ok, () => false);
  }
  if (!up) throw new Error(`The test server did not start on port ${PORT}.`);
  try {
    execFileSync("node", ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./scripts/register.mjs", "scripts/smoke-test.mts"], {
      stdio: "inherit",
      env: { ...env, SMOKE_BASE_URL: `http://localhost:${PORT}` },
    });
    code = 0;
  } catch {
    code = 1;
  }
} finally {
  server.kill("SIGTERM");
}
process.exit(code);

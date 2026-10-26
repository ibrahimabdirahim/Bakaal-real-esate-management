// Manual testing against the TEST database (never development): serves the production
// build on port 3300 with DATABASE_URL = TEST_DATABASE_URL, after checking the database name ends in
// "_test". Note: `npm run test:integration` and `npm run test:workflow` empty the test database (the
// workflow test then leaves its own fixtures, users *@workflow.test), so run them before manual testing.
// Usage: npm run build && npm run test:server   (Ctrl+C stops it)
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";

try {
  process.loadEnvFile(".env");
} catch {
  // Variables may already be set.
}
const url = process.env.TEST_DATABASE_URL;
const name = url ? new URL(url).pathname.slice(1) : "";
if (!name.endsWith("_test")) {
  console.error(`Refusing to start: TEST_DATABASE_URL must point to a database whose name ends in _test (got "${name || "nothing"}").`);
  process.exit(1);
}
if (!existsSync(".next/BUILD_ID")) {
  console.error("No production build found. Run `npm run build` first.");
  process.exit(1);
}
const PORT = 3300;
const busy = (() => {
  try {
    return execFileSync("lsof", ["-nP", `-iTCP:${PORT}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
})();
if (busy) {
  console.error(`Port ${PORT} is already in use (PID ${busy}); nothing was started.`);
  process.exit(1);
}
const env = { ...process.env, DATABASE_URL: url };
execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env });
console.log(`\nBAKAAL on the TEST database "${name}": http://localhost:${PORT}  (sign in with a test account; Ctrl+C to stop)\n`);
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], { env, stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.kill("SIGTERM"));
server.on("exit", (code) => process.exit(code ?? 0));

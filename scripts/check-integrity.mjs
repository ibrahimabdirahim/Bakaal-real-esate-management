// Read-only database integrity checks (scripts/check-integrity.sql), run inside a READ ONLY
// transaction so nothing can change. Usage: npm run db:check   (add -- --test for bakaal_test)
import { readFileSync } from "node:fs";
import pg from "pg";

try {
  process.loadEnvFile(".env");
} catch {
  // Variables may already be set.
}
const url = process.argv.includes("--test") ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!url) throw new Error("Database URL not set.");
const client = new pg.Client({ connectionString: url });
await client.connect();
let problems = 0;
try {
  await client.query("BEGIN READ ONLY");
  const { rows } = await client.query(readFileSync("scripts/check-integrity.sql", "utf8").replace(/^--.*$/gm, ""));
  const db = (await client.query("SELECT current_database() AS db")).rows[0].db;
  console.log(`Integrity checks on ${db}:`);
  for (const r of rows) {
    const n = Number(r.problems);
    problems += n;
    console.log(`  ${n === 0 ? "OK  " : "FAIL"} ${r.check}${n ? ` (${n})` : ""}`);
  }
} finally {
  await client.query("ROLLBACK");
  await client.end();
}
console.log(problems === 0 ? "ALL INTEGRITY CHECKS PASSED" : `INTEGRITY PROBLEMS FOUND: ${problems}`);
process.exit(problems === 0 ? 0 : 1);

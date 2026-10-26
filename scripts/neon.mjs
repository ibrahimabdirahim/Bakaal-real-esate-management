// Neon (production) database tools. They read only `.env.neon` (never committed: .gitignore ignores
// .env*), never use or change the local databases in `.env`, and never print a password.
//
//   npm run db:neon:check    read-only: connects with both URLs; reports version, TLS, time zone,
//                            privileges, the btree_gist extension and what the database already holds
//   npm run db:neon:status   read-only: `prisma migrate status` against Neon (direct connection)
//   npm run db:neon:deploy   applies the pending migrations to Neon. Refuses without `-- --confirm`;
//                            run it only with the owner's approval (and a backup plan, see README).
//
// .env.neon holds two Neon connection strings (Neon console → Connect):
//   NEON_DATABASE_URL  the pooled one (host contains "-pooler"): used by the app at runtime
//   NEON_DIRECT_URL    the direct one (no "-pooler"): used by Prisma migrations, which cannot run through the pooler
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import pg from "pg";

const FILE = process.env.NEON_ENV_FILE ?? ".env.neon";
const [command, ...flags] = process.argv.slice(2);
const fail = (message) => {
  console.error(`\n${message}\n`);
  process.exit(1);
};

if (!["check", "status", "deploy"].includes(command)) fail("Usage: node scripts/neon.mjs check | status | deploy --confirm");
if (!existsSync(FILE)) {
  fail(
    [
      `No ${FILE} file. Create it in the project folder (it is git-ignored) with your Neon connection strings:`,
      "",
      '  NEON_DATABASE_URL="postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/DBNAME?sslmode=verify-full"',
      '  NEON_DIRECT_URL="postgresql://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/DBNAME?sslmode=require"',
      "",
      "Copy both from the Neon console (Connect → toggle \"Connection pooling\" on for the first, off for the second).",
      "Do not paste them into chat, e-mail or any committed file.",
    ].join("\n"),
  );
}

const text = readFileSync(FILE, "utf8");
const vars = parseEnv(text);
const secrets = [];

/** Why a variable is missing, when the file has it in a form the .env format does not accept (never shows the value). */
function formatHint(name) {
  const line = text.split(/\r?\n/).findIndex((l) => new RegExp(`^\\s*(export\\s+)?${name}\\b`).test(l));
  if (line < 0) return "";
  const l = text.split(/\r?\n/)[line];
  if (new RegExp(`^\\s*(export\\s+)?${name}\\s*:`).test(l)) return ` Line ${line + 1} uses ":" — write ${name}="…" with an equals sign.`;
  if (new RegExp(`^\\s*(export\\s+)?${name}\\s+=`).test(l)) return ` Line ${line + 1} has a space before "=" — write ${name}="…" with no spaces.`;
  return ` Line ${line + 1} starts with ${name} but could not be read — use ${name}="…" on one line.`;
}

/** Checks one Neon connection string; returns it parsed. */
function neonUrl(name, { pooled }) {
  const value = vars[name];
  if (!value) fail(`${name} is missing from ${FILE}.${formatHint(name)}`);
  let u;
  try {
    u = new URL(value);
  } catch {
    fail(`${name} is not a valid connection string.`);
  }
  if (u.password) secrets.push(u.password, encodeURIComponent(u.password));
  if (!/^postgres(ql)?:$/.test(u.protocol)) fail(`${name} must start with postgresql://`);
  if (!u.hostname.endsWith(".neon.tech")) fail(`${name} must point to a Neon host (*.neon.tech), not "${u.hostname}". The local databases are never used here.`);
  if (pooled && !u.hostname.includes("-pooler")) fail(`${name} must be the pooled connection string (its host contains "-pooler").`);
  if (!pooled && u.hostname.includes("-pooler")) fail(`${name} must be the direct connection string (host without "-pooler"): Prisma migrations cannot run through the pooler.`);
  if (!["require", "verify-full"].includes(u.searchParams.get("sslmode") ?? "")) fail(`${name} must end with ?sslmode=verify-full (or sslmode=require), so the connection is encrypted and the server certificate checked.`);
  if (!u.username || !u.password) fail(`${name} needs the user name and password from the Neon console.`);
  const db = decodeURIComponent(u.pathname.slice(1));
  if (!db) fail(`${name} has no database name.`);
  if (/^bakaal_(dev|test|shadow)$/.test(db)) fail(`${name} uses the local database name "${db}". Use a separate production database name on Neon.`);
  return u;
}

const pooledUrl = neonUrl("NEON_DATABASE_URL", { pooled: true });
const directUrl = neonUrl("NEON_DIRECT_URL", { pooled: false });
if (pooledUrl.hostname.replace("-pooler", "") !== directUrl.hostname) fail("NEON_DATABASE_URL and NEON_DIRECT_URL point to different Neon endpoints. Copy both from the same branch.");
if (pooledUrl.pathname !== directUrl.pathname) fail("NEON_DATABASE_URL and NEON_DIRECT_URL name different databases.");

const hide = (text) => secrets.reduce((t, s) => t.split(s).join("****"), String(text));
const where = (u) => `${decodeURIComponent(u.pathname.slice(1))} on ${u.hostname}`;

/** Read-only look at the database through one connection string. */
async function inspect(u, label, full) {
  // pg already treats sslmode=require as verify-full (encrypted, certificate and host checked); asking for it
  // explicitly gives the same connection without pg's deprecation notice. The file's strings are not changed.
  const target = new URL(u);
  if (target.searchParams.get("sslmode") === "require") target.searchParams.set("sslmode", "verify-full");
  const client = new pg.Client({ connectionString: target.toString(), connectionTimeoutMillis: 20000, query_timeout: 20000 });
  try {
    await client.connect();
    // Encryption as seen from this computer (on Neon the server only sees its own proxy, so pg_stat_ssl says nothing useful).
    const tls = client.connection?.stream?.encrypted === true;
    await client.query("BEGIN READ ONLY");
    const one = async (sql) => (await client.query(sql)).rows[0];
    const info = await one(
      "select current_database() db, current_user usr, current_setting('server_version') version, current_setting('TimeZone') tz, current_setting('server_encoding') enc",
    );
    console.log(`${label}: connected to ${where(u)} as ${info.usr} · PostgreSQL ${info.version} · encoding ${info.enc} · time zone ${info.tz}${tls ? " · encrypted (TLS, certificate verified)" : " · WARNING: not encrypted"}`);
    if (full) {
      const state = await one(`select
          (select count(*)::int from pg_tables where schemaname = 'public') tables,
          to_regclass('public."_prisma_migrations"') is not null has_migrations,
          exists(select 1 from pg_available_extensions where name = 'btree_gist') gist_available,
          exists(select 1 from pg_extension where extname = 'btree_gist') gist_installed,
          has_database_privilege(current_database(), 'CREATE') can_create_db,
          has_schema_privilege('public', 'CREATE') can_create_schema`);
      const applied = state.has_migrations ? Number((await one(`select count(*) n from "_prisma_migrations" where finished_at is not null and rolled_back_at is null`)).n) : 0;
      console.log(`  public schema: ${state.tables} table(s); ${state.has_migrations ? `${applied} migration(s) recorded` : "no migration history (never migrated)"}`);
      console.log(`  btree_gist extension: ${state.gist_installed ? "installed" : state.gist_available ? "available (the first migration installs it)" : "NOT AVAILABLE — the migrations need it"}`);
      console.log(`  privileges: create objects in the database ${state.can_create_db ? "yes" : "NO"}, in schema public ${state.can_create_schema ? "yes" : "NO"}`);
      const problems = [
        !["UTC", "Etc/UTC", "GMT", "Etc/GMT"].includes(info.tz) && `the database time zone is ${info.tz}, not UTC: database defaults (CURRENT_TIMESTAMP) would disagree with the times the app writes (UTC)`,
        !state.gist_available && "btree_gist is not available",
        !(state.can_create_db && state.can_create_schema) && "this user cannot create tables; use the database owner role (e.g. neondb_owner) for migrations",
        info.enc !== "UTF8" && `the encoding is ${info.enc}, not UTF8`,
      ].filter(Boolean);
      for (const p of problems) console.log(`  PROBLEM: ${p}`);
      if (!problems.length) console.log(state.tables === 0 ? "  Ready for the first migration: the database is empty." : `  The database is not empty (${state.tables} tables): run db:neon:status before anything else.`);
    }
    await client.query("ROLLBACK");
  } catch (e) {
    fail(`${label}: could not use ${where(u)}: ${hide(e.message)}`);
  } finally {
    await client.end().catch(() => {});
  }
}

/** Runs the Prisma CLI against Neon's direct connection only (the local .env is not loaded). */
function prisma(args) {
  const env = { ...process.env, BAKAAL_NO_DOTENV: "1", DATABASE_URL: directUrl.toString(), DIRECT_DATABASE_URL: directUrl.toString() };
  delete env.SHADOW_DATABASE_URL;
  delete env.TEST_DATABASE_URL;
  const r = spawnSync("npx", ["prisma", ...args], { env, encoding: "utf8" });
  process.stdout.write(hide(r.stdout ?? ""));
  process.stderr.write(hide(r.stderr ?? ""));
  return r.status ?? 1;
}

if (command === "check") {
  console.log(`Neon check (read-only) using ${FILE}`);
  await inspect(pooledUrl, "Pooled connection (app runtime)", false);
  await inspect(directUrl, "Direct connection (migrations)", true);
} else if (command === "status") {
  process.exit(prisma(["migrate", "status"]));
} else {
  if (!flags.includes("--confirm")) fail("This applies the pending migrations to the Neon production database. Run it only with the owner's approval: npm run db:neon:deploy -- --confirm");
  console.log(`Applying pending migrations to ${where(directUrl)}…`);
  process.exit(prisma(["migrate", "deploy"]));
}

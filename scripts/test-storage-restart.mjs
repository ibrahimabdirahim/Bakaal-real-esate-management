// Documents survive an app restart when stored in an S3-compatible bucket (TEST database only).
// A test bucket runs as its own process; the production build is started, a PDF is uploaded through
// the real upload route, the app is stopped and started again, and the same file must come back.
// Usage: npm run build && npm run test:storage-restart
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import pg from "pg";

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
const PORT = 3410;
const BASE = `http://localhost:${PORT}`;
const KEY = "TESTACCESSKEY";
const PDF = Buffer.from("%PDF-1.4\n% bakaal restart test\n%%EOF\n");
let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`);
  if (!ok) failed++;
};

const bucket = spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./scripts/register.mjs", "scripts/fake-s3-server.mts"], { env: { ...process.env, FAKE_S3_KEY: KEY }, stdio: ["ignore", "pipe", "inherit"] });
const endpoint = await new Promise((resolve, reject) => {
  bucket.stdout.on("data", (d) => {
    const m = /FAKE_S3_ENDPOINT=(\S+)/.exec(String(d));
    if (m) resolve(m[1]);
  });
  bucket.on("exit", () => reject(new Error("The test bucket did not start.")));
});
const appEnv = { ...process.env, DATABASE_URL: url, DOCUMENT_STORAGE: "s3", S3_ENDPOINT: endpoint, S3_BUCKET: "bakaal-test", S3_ACCESS_KEY_ID: KEY, S3_SECRET_ACCESS_KEY: "test-secret", S3_REGION: "auto" };
const startApp = async () => {
  const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], { env: appEnv, stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await fetch(`${BASE}/login`).then((r) => r.ok, () => false)) return app;
  }
  app.kill("SIGTERM");
  throw new Error(`The app did not start on port ${PORT}.`);
};
const stopApp = (app) => new Promise((resolve) => { app.once("exit", resolve); app.kill("SIGTERM"); });

const db = new pg.Client({ connectionString: url });
await db.connect();
const token = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");
let docId = null;
let app = null;
try {
  const admin = (await db.query(`select id from "User" where role = 'ADMIN' and "isActive" order by "createdAt" limit 1`)).rows[0];
  if (!admin) throw new Error("bakaal_test has no active administrator to upload with.");
  await db.query(`insert into "Session"(id,"userId","tokenHash","expiresAt","createdAt") values (gen_random_uuid()::text,$1,$2,now()+interval '15 min',now())`, [admin.id, hash]);
  const headers = { cookie: `bakaal_session=${token}`, origin: BASE };

  app = await startApp();
  const health = await (await fetch(`${BASE}/api/health`)).json();
  check("health check: storage ok in the bucket", health.storage === "ok" && health.storageKind === "s3", JSON.stringify(health));
  const fd = new FormData();
  fd.append("file", new Blob([PDF], { type: "application/pdf" }), "restart-test.pdf");
  fd.append("ownerType", "PARTY");
  fd.append("category", "ID_DOCUMENT");
  const up = await fetch(`${BASE}/api/documents`, { method: "POST", body: fd, headers });
  const body = await up.json();
  docId = body.id ?? null;
  check("upload through the real route", up.status === 201 && !!docId, `${up.status} ${JSON.stringify(body)}`);
  const first = Buffer.from(await (await fetch(`${BASE}/api/documents/${docId}`, { headers })).arrayBuffer());
  check("download before the restart returns the same file", first.equals(PDF));

  await stopApp(app);
  app = null;
  check("the app server stopped", !(await fetch(`${BASE}/login`).then(() => true, () => false)));
  app = await startApp();
  const again = await fetch(`${BASE}/api/documents/${docId}`, { headers });
  const after = Buffer.from(await again.arrayBuffer());
  check("after the restart the same file is still there", again.status === 200 && after.equals(PDF), `${again.status}, ${after.length} bytes`);

  const del = await fetch(`${BASE}/api/documents/${docId}`, { method: "DELETE", headers });
  check("the test upload is removed again (record and file)", del.ok && (await db.query(`select count(*)::int n from "Document" where id = $1`, [docId])).rows[0].n === 0, `${del.status}`);
  docId = null;
} catch (e) {
  check("restart test ran to the end", false, e.message);
} finally {
  if (docId) await db.query(`delete from "Document" where id = $1 and "ownerType" is null`, [docId]).catch(() => {});
  await db.query(`delete from "Session" where "tokenHash" = $1`, [hash]).catch(() => {});
  await db.end();
  if (app) await stopApp(app);
  bucket.kill("SIGTERM");
}
console.log(failed ? `STORAGE RESTART TEST FAILED: ${failed} problem(s)` : "STORAGE RESTART TEST PASSED");
process.exit(failed ? 1 : 0);

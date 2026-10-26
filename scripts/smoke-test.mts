// HTTP smoke test of every page, per role, against a server on the TEST database.
// Creates short-lived sessions for one active staff account per role, never prints
// tokens, and revokes the sessions afterwards. Roles without an account are skipped.
// Usage: npm run build && npm run test:smoke   (scripts/test-smoke.mjs starts the server)
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/server/db";
import { can, ROLES, type Permission, type RoleName } from "@/server/auth/permissions";

// It creates (and revokes) sessions, so it must never write to the development database.
if (!new URL(process.env.DATABASE_URL ?? "postgres://x/none").pathname.endsWith("_test")) {
  throw new Error("The smoke test runs only against the TEST database. Use `npm run test:smoke`.");
}
const BASE = process.env.SMOKE_BASE_URL;
if (!BASE) throw new Error("SMOKE_BASE_URL is not set. Use `npm run test:smoke`, which starts a server on the TEST database.");

const PAGES: { path: string; permission: Permission | null }[] = [
  { path: "/", permission: "dashboard.view" },
  { path: "/units", permission: "units.view" },
  { path: "/units/new", permission: "units.manage" },
  { path: "/accounts", permission: "accounts.view" },
  { path: "/accounts/new", permission: "accounts.manage" },
  { path: "/agreements", permission: "agreements.view" },
  { path: "/agreements?status=ALL", permission: "agreements.view" },
  { path: "/agreements/new", permission: "agreements.manage" },
  { path: "/finance", permission: "invoices.view" },
  { path: "/finance/ledger", permission: "invoices.view" },
  { path: "/billing", permission: "billing.preview" },
  { path: "/invoices", permission: "invoices.view" },
  { path: "/invoices?status=PAST_DUE", permission: "invoices.view" },
  { path: "/invoices?status=DRAFT", permission: "invoices.view" },
  { path: "/invoices/new", permission: "invoices.create_manual" },
  { path: "/payments", permission: "payments.view" },
  { path: "/payments/new", permission: "payments.record" },
  { path: "/expenses", permission: "expenses.view" },
  { path: "/expenses/new", permission: "expenses.submit" },
  { path: "/expenses?status=COSTS&basis=service&from=2026-01-01&to=2026-12-31", permission: "expenses.view" },
  { path: "/expenses?status=PAID&basis=paid&from=2026-01-01&to=2026-12-31", permission: "expenses.view" },
  { path: "/invoices?view=credit-notes", permission: "invoices.view" },
  { path: "/documents", permission: null },
  { path: "/staff", permission: "staff.view" },
  { path: "/staff/new", permission: "staff.manage" },
  { path: "/staff/tasks", permission: "staff.view" },
  { path: "/staff/salaries", permission: "salary.view" },
  { path: "/staff/salary-payments", permission: "salary.view" },
  { path: "/staff/salary-payments?status=SUBMITTED", permission: "salary.view" },
  { path: "/staff/salary-payments/new", permission: "salary.manage" },
  { path: "/maintenance", permission: "workorders.view" },
  { path: "/maintenance/new", permission: "workorders.manage" },
  { path: "/reports/occupancy", permission: "reports.operational" },
  { path: "/reports/rent-roll", permission: "reports.financial" },
  { path: "/reports/arrears", permission: "reports.financial" },
  { path: "/reports/collections", permission: "reports.financial" },
  { path: "/reports/expenses", permission: "reports.financial" },
  { path: "/reports/reconciliation", permission: "reports.financial" },
  { path: "/notices", permission: "notices.view" },
  { path: "/settings", permission: "settings.view" },
  { path: "/settings/users", permission: "users.manage" },
  { path: "/audit", permission: "audit.view" },
  { path: "/account", permission: null },
];

async function detailPages() {
  const [unit, party, agreement, invoice, draft, payment, verified, expense, salary, staff, wo] = await Promise.all([
    db.unit.findFirst(), db.party.findFirst(), db.agreement.findFirst(), db.invoice.findFirst({ where: { status: "ISSUED" } }),
    db.invoice.findFirst({ where: { status: "DRAFT" } }), db.payment.findFirst({ where: { status: "PENDING" } }),
    db.payment.findFirst({ where: { status: "VERIFIED" } }), db.expense.findFirst({ where: { category: { not: "SALARIES" } } }),
    db.expense.findFirst({ where: { category: "SALARIES" } }), db.staffMember.findFirst(), db.workOrder.findFirst(),
  ]);
  // Records that do not exist yet are skipped, so the test also runs on a new database.
  const pages: ({ path: string; permission: Permission; salary?: boolean } | false)[] = [
    !!unit && { path: `/units/${unit.id}`, permission: "units.view" },
    !!party && { path: `/accounts/${party.id}`, permission: "accounts.view" },
    !!party && { path: `/accounts/${party.id}/statement`, permission: "invoices.view" },
    !!agreement && { path: `/agreements/${agreement.id}`, permission: "agreements.view" },
    !!invoice && { path: `/invoices/${invoice.id}`, permission: "invoices.view" },
    !!draft && { path: `/invoices/${draft.id}`, permission: "invoices.view" },
    !!payment && { path: `/payments/${payment.id}`, permission: "payments.view" },
    !!verified && { path: `/payments/${verified.id}`, permission: "payments.view" },
    !!verified && { path: `/payments/${verified.id}/receipt`, permission: "payments.view" },
    !!expense && { path: `/expenses/${expense.id}`, permission: "expenses.view" },
    // Salary payments have their own page; /expenses/<salary> redirects there (checked in the workflow test).
    !!salary && { path: `/staff/salary-payments/${salary.id}`, permission: "salary.view" },
    !!staff && { path: `/staff/${staff.id}`, permission: "staff.view" },
    !!wo && { path: `/maintenance/${wo.id}`, permission: "workorders.view" },
  ];
  return pages.filter((p) => p !== false);
}

const EXPORTS = ["occupancy", "rent-roll", "arrears", "collections", "expenses"];
// (Next embeds its 404 template in every page payload, so missing pages are detected by status code instead.)
const ERROR_MARKERS = ["Application error", "Internal Server Error", "Unhandled Runtime Error", "This page could not be loaded"];

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log(`  FAIL ${msg}`);
};

const users = await db.user.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
if (users.length === 0) throw new Error("No active staff accounts found. Run `npm run user:create-admin` first.");
const details = await detailPages();
const sessionIds: string[] = [];

try {
  for (const role of ROLES) {
    const user = users.find((u) => u.role === role);
    if (!user) continue;
    const token = randomBytes(32).toString("base64url");
    const s = await db.session.create({
      data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
    });
    sessionIds.push(s.id);
    const headers = { cookie: `bakaal_session=${token}` };
    let ok = 0;
    const links = new Set<string>();
    for (const page of [...PAGES, ...details]) {
      const res = await fetch(BASE + page.path, { headers, redirect: "manual" });
      const allowed = page.permission === null || can(role as RoleName, page.permission);
      const salaryHidden = "salary" in page && page.salary && !can(role as RoleName, "salary.view");
      if (allowed && !salaryHidden) {
        const body = res.status === 200 ? await res.text() : "";
        if (res.status !== 200) fail(`${role} ${page.path}: expected 200, got ${res.status} ${res.headers.get("location") ?? ""}`);
        else if (ERROR_MARKERS.some((m) => body.includes(m))) fail(`${role} ${page.path}: error text in page`);
        else ok++;
        for (const m of body.matchAll(/href="(\/[^"#]*)"/g)) {
          const href = m[1].replace(/&amp;/g, "&");
          if (!href.startsWith("/_next") && !href.startsWith("/reports/export") && !href.startsWith("/brand/")) links.add(href);
        }
      } else if (salaryHidden) {
        if (res.status !== 404) fail(`${role} ${page.path}: salary expense should be hidden (got ${res.status})`);
        else ok++;
      } else {
        const loc = res.headers.get("location") ?? "";
        if (!(res.status >= 300 && res.status < 400 && loc.includes("/no-access"))) fail(`${role} ${page.path}: expected redirect to /no-access, got ${res.status} ${loc}`);
        else ok++;
      }
    }
    for (const r of EXPORTS) {
      const res = await fetch(`${BASE}/reports/export/${r}`, { headers });
      const permitted = can(role as RoleName, r === "occupancy" ? "reports.operational" : "reports.financial");
      const expected = permitted ? 200 : 403;
      if (res.status !== expected) fail(`${role} export ${r}: expected ${expected}, got ${res.status}`);
      else ok++;
      if (permitted && !(res.headers.get("content-type") ?? "").includes("text/csv")) fail(`${role} export ${r}: not CSV`);
    }
    // Every link shown to this role must open for this role (no dead ends, no "no access").
    let linkOk = 0;
    for (const href of links) {
      const res = await fetch(BASE + href, { headers, redirect: "manual" });
      const loc = res.headers.get("location") ?? "";
      if (res.status !== 200) fail(`${role} link ${href}: got ${res.status} ${loc}`);
      else linkOk++;
    }
    console.log(`${role.padEnd(11)} ${ok} page checks and ${linkOk}/${links.size} links passed`);
  }
  const anon = await fetch(`${BASE}/payments`, { redirect: "manual" });
  if (!(anon.status >= 300 && anon.status < 400 && (anon.headers.get("location") ?? "").includes("/login"))) fail("anonymous /payments should redirect to /login");
  const forged = await fetch(`${BASE}/payments`, { headers: { cookie: "bakaal_session=forged-token" }, redirect: "manual" });
  if (!(forged.status >= 300 && forged.status < 400 && (forged.headers.get("location") ?? "").includes("/login"))) fail("forged session should redirect to /login");
  const anonExport = await fetch(`${BASE}/reports/export/arrears`, { headers: { cookie: "bakaal_session=forged-token" } });
  if (anonExport.status !== 401) fail(`forged session export should be 401, got ${anonExport.status}`);
} finally {
  await db.session.updateMany({ where: { id: { in: sessionIds } }, data: { revokedAt: new Date() } });
  await db.$disconnect();
}

console.log(failures === 0 ? "SMOKE TEST PASSED" : `SMOKE TEST FAILED: ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);

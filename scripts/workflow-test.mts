// End-to-end workflow test through the real forms and server actions.
// Starts its own server on port 3100 against the TEST database (emptied first), creates
// throw-away staff accounts, and submits forms exactly as a browser without JavaScript
// would. Usage: npm run build && npm run test:workflow
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { resetTestData } from "@/server/testing";
import { addMonths, monthStart, todayISO } from "@/lib/dates";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith("_test")) throw new Error("TEST_DATABASE_URL must point to a *_test database.");
if (process.env.DATABASE_URL !== testUrl) throw new Error("Run via `npm run test:workflow` so the test database is used.");
process.env.BAKAAL_INTEGRATION = "1";

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};

// ---------------------------------------------------------------- fixtures

await resetTestData();
await db.building.create({ data: { name: "Workflow Test Building" } });
const PASSWORD = "workflow-test-password-1";
const passwordHash = await hashPassword(PASSWORD);
for (const role of ["ADMIN", "MANAGER", "FINANCE", "OPERATIONS"] as const) {
  await db.user.create({ data: { email: `${role.toLowerCase()}@workflow.test`, name: `${role} tester`, role, passwordHash } });
}

// ---------------------------------------------------------------- server

const server = spawn("npx", ["next", "start", "-p", String(PORT)], { env: { ...process.env, DATABASE_URL: testUrl }, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${BASE}/login`)).ok) break;
  } catch {
    // not up yet
  }
  await new Promise((r) => setTimeout(r, 500));
}

// ---------------------------------------------------------------- form helpers

function decode(s: string) {
  return s.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'");
}

/** Finds the form containing `marker` and returns its hidden fields. */
function findForm(html: string, marker: string): [string, string][] {
  const forms = html.match(/<form[\s\S]*?<\/form>/g) ?? [];
  const form = forms.find((f) => f.includes(marker));
  if (!form) throw new Error(`No form containing ${marker}`);
  return [...form.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?/g)].map((m) => [decode(m[1]), decode(m[2] ?? "")]);
}

/** The approval form (F61) holding the marker: one confirmation, nothing to type. */
function approvalForm(html: string, marker = 'name="approve"') {
  const form = (html.match(/<form[\s\S]*?<\/form>/g) ?? []).find((f) => f.includes(marker)) ?? "";
  return { form, oneStep: !!form && form.includes("Confirm Approval") && !/<(input|textarea)(?![^>]*type="hidden")[^>]*>/.test(form) && !form.includes("confirmSelf") };
}

async function getPage(path: string, cookie: string) {
  const res = await fetch(BASE + path, { headers: { cookie }, redirect: "manual" });
  return { status: res.status, html: res.status === 200 ? await res.text() : "", location: res.headers.get("location") ?? "" };
}

async function submit(path: string, cookie: string, marker: string, fields: Record<string, string | string[]>, html?: string) {
  const page = html ?? (await getPage(path, cookie)).html;
  const fd = new FormData();
  for (const [k, v] of findForm(page, marker)) fd.append(k, v);
  for (const k of Object.keys(fields)) fd.delete(k); // the given fields replace the form's own values
  for (const [k, v] of Object.entries(fields)) for (const one of Array.isArray(v) ? v : [v]) fd.append(k, one);
  const res = await fetch(BASE + path, { method: "POST", body: fd, headers: { cookie }, redirect: "manual" });
  return { status: res.status, location: res.headers.get("location") ?? "", html: res.status === 200 ? await res.text() : "", setCookie: res.headers.get("set-cookie") ?? "" };
}

async function login(email: string, password = PASSWORD) {
  const r = await submit("/login", "", 'name="email"', { email, password });
  const m = /bakaal_session=([^;]+)/.exec(r.setCookie);
  return { ...r, cookie: m ? `bakaal_session=${m[1]}` : "" };
}

const idFrom = (location: string, prefix: string) => location.split(prefix)[1]?.split(/[?#]/)[0] ?? "";
/** Recording a payment returns to the Payments list (?recorded=<id>); this gives the payment's own page too. */
const recordedPayment = <T extends { location: string }>(r: T) => {
  const id = new URLSearchParams(r.location.split("?")[1] ?? "").get("recorded");
  return { ...r, listLocation: r.location, location: id ? `/payments/${id}` : r.location };
};

// ---------------------------------------------------------------- workflow

try {
  const bad = await login("manager@workflow.test", "wrong-password-123");
  check("wrong password is rejected", !bad.cookie && bad.html.includes("Incorrect e-mail or password"));

  // Failed sign-ins per network address (audit 2026-10-29): 30 failures block that address only.
  const signInPage = (await getPage("/login", "")).html;
  const tryFrom = async (address: string, email: string, password: string) => {
    const fd = new FormData();
    for (const [k, v] of findForm(signInPage, 'name="email"')) fd.append(k, v);
    fd.append("email", email);
    fd.append("password", password);
    const res = await fetch(`${BASE}/login`, { method: "POST", body: fd, headers: { "x-forwarded-for": address }, redirect: "manual" });
    return { status: res.status, html: res.status === 200 ? await res.text() : "" };
  };
  for (let i = 0; i < 30; i++) await tryFrom("203.0.113.9", "nobody@workflow.test", "wrong-password-123");
  const addressBlocked = await tryFrom("203.0.113.9", "manager@workflow.test", PASSWORD);
  const otherAddress = await tryFrom("198.51.100.7", "manager@workflow.test", PASSWORD);
  check(
    "30 failed sign-ins from one network address block that address, even with the right password; another address still signs in",
    addressBlocked.html.includes("Too many failed sign-ins from this network") && otherAddress.status === 303,
    `${addressBlocked.status} / ${otherAddress.status}`,
  );
  const health = await fetch(`${BASE}/api/health`, { redirect: "manual" });
  const healthBody = health.status === 200 ? await health.json() : null;
  check("the health check answers without a session: database ok and the latest migration applied", health.status === 200 && healthBody?.status === "ok" && healthBody?.storage === "ok" && healthBody?.latestMigration === "20261029120000_billed_charges", JSON.stringify(healthBody));

  const manager = await login("manager@workflow.test");
  check("manager signs in", !!manager.cookie && manager.status === 303);
  const finance = (await login("finance@workflow.test")).cookie;
  const ops = (await login("operations@workflow.test")).cookie;
  const admin = (await login("admin@workflow.test")).cookie;
  const M = manager.cookie;

  const unit = await submit("/units/new", M, 'name="unitNumber"', { unitNumber: "W-1", floor: "1", unitType: "Store", notes: "" });
  const unitId = idFrom(unit.location, "/units/");
  check("create unit redirects to the unit", unit.status === 303 && !!unitId, `${unit.status} ${unit.location}`);
  const dup = await submit("/units/new", M, 'name="unitNumber"', { unitNumber: "W-1", floor: "", unitType: "", notes: "" });
  check("duplicate unit number is refused with a message", dup.html.includes("already exists"));
  const dupCase = await submit("/units/new", M, 'name="unitNumber"', { unitNumber: "w-1", floor: "", unitType: "", notes: "" });
  check("a unit number differing only in case is refused", dupCase.html.includes("registered as “W-1”"));
  check("a refused unit keeps what was typed and creates nothing", dupCase.html.includes('value="w-1"') && (await db.unit.count({ where: { unitNumber: { equals: "w-1", mode: "insensitive" } } })) === 1);
  const blankUnit = await submit("/units/new", M, 'name="unitNumber"', { unitNumber: "   ", floor: "", unitType: "", notes: "" });
  check("a blank Unit ID/Name is refused", blankUnit.html.includes("Unit ID/Name is required.") && (await db.unit.count()) === 1);
  const addForm = (await getPage("/units/new", M)).html;
  check(
    "Add Unit: title, the fields, Cancel back to Units and Save Unit; no rent row; occupancy and tax are shown but not submitted",
    addForm.includes(">Add Unit</h1>") && addForm.includes("Enter the unit details for this property.") && addForm.includes(">Save Unit<") && />Cancel</.test(addForm) &&
      addForm.includes('href="/units"') && addForm.includes(">Unit ID/Name") && addForm.includes(">Notes (optional)") && !addForm.includes("Rent Amount") && !addForm.includes("Set in the rental agreement") && addForm.includes("Not set up") &&
      !/name="(rentAmount|taxRate|occupied|billType|billAmount)"/.test(addForm),
  );

  // Building capacity and registration progress.
  const unitsBefore = await getPage("/units", M);
  check("without a capacity the units page shows a setup prompt, not zeros", unitsBefore.html.includes("has not been set") && !unitsBefore.html.includes("Remaining to register"));
  const settingsFields = { name: "Workflow Test Building", address: "" };
  const zeroCap = await submit("/settings", admin, 'name="totalUnits"', { ...settingsFields, totalUnits: "0" });
  check("capacity 0 is refused", zeroCap.html.includes("must be a whole number from 1"));
  const textCap = await submit("/settings", admin, 'name="totalUnits"', { ...settingsFields, totalUnits: "lots" });
  check("non-numeric capacity is refused", textCap.html.includes("must be a whole number from 1") && (await db.building.findFirstOrThrow()).totalUnits === null);
  const setCap = await submit("/settings", admin, 'name="totalUnits"', { ...settingsFields, totalUnits: "5" });
  check("administrator sets the building capacity", setCap.html.includes("Building profile saved"));
  check("the capacity is shown again after reload", (await getPage("/settings", admin)).html.includes('value="5"'));
  await submit("/settings", M, 'name="name"', { ...settingsFields, totalUnits: "99" }, setCap.html);
  check("a manager cannot change the capacity by replaying the form", (await db.building.findFirstOrThrow()).totalUnits === 5);
  const unitsAfter = await getPage("/units", M);
  check(
    "units page shows capacity, registered and remaining",
    unitsAfter.html.includes("Total building units") && unitsAfter.html.includes("1 of 5 units registered (20%)") && unitsAfter.html.includes("Remaining to register"),
  );
  const unit2 = await submit("/units/new", M, 'name="unitNumber"', { unitNumber: "W-2", floor: "", unitType: "", notes: "" });
  const unit2Page = await getPage(unit2.location, M);
  check("after adding a unit the progress is updated immediately", unit2.location.endsWith("?created=1") && unit2Page.html.includes("2 of 5 units registered; 3 remaining to register"));
  check("units page reflects the new count", (await getPage("/units", M)).html.includes("2 of 5 units registered (40%)"));
  const capacityDash = await getPage("/", M);
  check(
    "the dashboard shows the building, unpaid balances, payments with collection rate, occupancy, arrears and more actions",
    // Presence here; the dashboard streams (F68), so the on-screen order is checked in the browser test.
    ["data-building", ">Unpaid Tenant Balance (KES)<", "Collection rate", ">Occupancy<", "Arrears overview (KES)", "More actions", "Recent activity", "Amounts owed, not cash"].every((t) => capacityDash.html.includes(t)),
  );

  // Every account is created with one of the three account types; give the form accounts their own units.
  const start = addMonths(monthStart(todayISO()), -1);
  const wb = await db.building.findFirstOrThrow();
  const spareUnits = await Promise.all(["W-3", "W-4", "W-5", "W-6"].map((unitNumber) => db.unit.create({ data: { buildingId: wb.id, unitNumber } })));
  const [w3, w4, w5, w6] = spareUnits.map((u) => u.id);
  const blankParty = { phone: "", email: "", idNumber: "", notes: "" };
  const tenantForm = (displayName: string, unit: string, extra: Record<string, string> = {}) => ({ ...blankParty, displayName, accountType: "TENANT", unitId: unit, startDate: start, endDate: "", rentAmount: "1,000.00", dueDay: "5", ...extra });
  const ownerForm = (displayName: string, unit: string, extra: Record<string, string> = {}) => ({ ...blankParty, displayName, accountType: "OWNER", unitId: unit, ownerFrom: start, purchaseDate: "", ownershipEvidence: "Sale agreement on file", ...extra });

  const party = await submit("/accounts/new", M, 'name="displayName"', tenantForm("Workflow Tenant", unitId, { email: "bad-email", rentAmount: "20,000.00" }));
  check("invalid e-mail shows a field error", party.html.includes("E-mail address is not valid"));
  const manyErrors = await submit("/accounts/new", M, 'name="displayName"', tenantForm("Many Errors", unitId, { email: "bad-email", rentAmount: "lots", dueDay: "40", startDate: "2026-13-45" }));
  check(
    "one save reports account and agreement field errors together, and saves nothing",
    ["E-mail address is not valid", "Monthly rent must be a positive amount", "Due day must be a whole number from 1 to 28", "Start date must be a valid date"].every((t) => manyErrors.html.includes(t)) &&
      (await db.party.count({ where: { displayName: "Many Errors" } })) === 0,
  );
  const badDates = await submit("/accounts/new", M, 'name="displayName"', tenantForm("Bad Dates", unitId, { endDate: addMonths(start, -2) }));
  check("an end date before the start date is refused, nothing saved", badDates.html.includes("End date cannot be before the start date") && (await db.party.count({ where: { displayName: "Bad Dates" } })) === 0);
  const noUnit = await submit("/accounts/new", M, 'name="displayName"', tenantForm("No Unit", randomUUID()));
  check("a unit that does not exist is refused, nothing saved", noUnit.html.includes("Choose a unit of this building") && (await db.party.count({ where: { displayName: "No Unit" } })) === 0);
  const party2 = await submit("/accounts/new", M, 'name="displayName"', tenantForm("Workflow Tenant", unitId, { rentAmount: "20,000.00" }));
  const partyId = idFrom(party2.location, "/accounts/");
  check("create account", party2.status === 303 && !!partyId);
  check(
    "a Rent-Paying Tenant gets one rental agreement on the chosen unit, and no invoice is created by registering",
    JSON.stringify(await db.agreement.findMany({ where: { partyId }, select: { type: true, unitId: true } })) === JSON.stringify([{ type: "RENTAL", unitId }]) && (await db.invoice.count({ where: { partyId } })) === 0,
  );
  const created = await getPage(party2.location, M);
  check(
    "new account shows a clear confirmation with next steps",
    party2.location.includes("?created=1&billing=") && created.html.includes("Account created successfully") && created.html.includes("Back to Accounts register") && created.html.includes("Add another account"),
  );
  check("the account page is clearly an edit of the existing account", created.html.includes("Edit account details") && created.html.includes("it does not create a new account"));
  check("the confirmation is not repeated on later visits", !(await getPage(`/accounts/${partyId}`, M)).html.includes("Account created successfully"));

  // Text that looks like HTML is stored as typed and shown as text, never run as markup.
  const xssName = `<img src=x onerror="alert(1)">Evil`;
  const xss = await submit("/accounts/new", M, 'name="displayName"', ownerForm(xssName, w3, { notes: "<script>alert(2)</script>" }));
  const xssPage = await getPage(xss.location, M);
  check(
    "HTML in user input is escaped on the account page and in the register",
    xss.status === 303 && !xssPage.html.includes("<img src=x") && !xssPage.html.includes("<script>alert(2)") && xssPage.html.includes("&lt;img") && !(await getPage("/accounts", M)).html.includes("<img src=x"),
  );

  // Account types decide what is created.
  const xssId = idFrom(xss.location, "/accounts/");
  check("a Purchased Unit Owner gets only an ownership record: no rental agreement, no rent", JSON.stringify(await db.agreement.findMany({ where: { partyId: xssId }, select: { type: true, rentAmount: true } })) === JSON.stringify([{ type: "OWNERSHIP", rentAmount: null }]));
  const forgedType = await submit("/accounts/new", M, 'name="displayName"', { ...ownerForm("Forged Type", w6), accountType: "LANDLORD" });
  check("an unknown account type is refused", forgedType.html.includes("Choose an account type") && (await db.party.count({ where: { displayName: "Forged Type" } })) === 0);
  const noEvidence = await submit("/accounts/new", M, 'name="displayName"', ownerForm("No Evidence", w6, { ownershipEvidence: "" }));
  check("an owner without ownership evidence is refused, nothing saved", noEvidence.html.includes("ownership evidence") && (await db.party.count({ where: { displayName: "No Evidence" } })) === 0);
  const managedForm = { ...ownerForm("Managed Owner", w6), accountType: "MANAGED", mgmtStartDate: monthStart(todayISO()), mgmtEndDate: "", managementFee: "4,500.00", mgmtDueDay: "10", charge0Category: "SHARED_CHARGE", charge0Description: "Approved water share", charge0Amount: "800", charge0From: monthStart(todayISO()), charge0To: "" }; // starts this month: not in the earlier billing checks
  const managed = await submit("/accounts/new", M, 'name="displayName"', managedForm);
  const managedAgs = await db.agreement.findMany({ where: { party: { displayName: "Managed Owner" } }, include: { charges: true }, orderBy: { type: "asc" } });
  check(
    "a Purchased Unit Managed by BAKAAL gets ownership + management (agreed fee, shared charge), never rent",
    managed.status === 303 && managedAgs.map((a) => a.type).join() === "OWNERSHIP,MANAGEMENT" && managedAgs.every((a) => a.rentAmount === null) && String(managedAgs[1].managementFeeAmount) === "4500" && managedAgs[1].charges.map((c) => c.category).join() === "SHARED_CHARGE",
    `${managed.status} ${managed.html.match(/role="alert"[^>]*>([\s\S]{0,200})/)?.[1] ?? ""}`,
  );
  check("registering owners and managed owners creates no invoice", (await db.invoice.count({ where: { party: { displayName: { in: ["Managed Owner", xssName] } } } })) === 0);
  check("the register shows each account's type", (await getPage("/accounts?type=MANAGED", M)).html.includes("Managed Owner") && !(await getPage("/accounts?type=MANAGED", M)).html.includes("Workflow Tenant"));

  // Duplicates are refused outright: nothing saved, entered values kept, no way to override.
  const dupFields = ownerForm("Dup Person Again", w5, { phone: "+254 711 222 333" });
  const firstDup = await submit("/accounts/new", M, 'name="displayName"', ownerForm("Dup Person", w4, { phone: "0711222333" }));
  const firstDupId = idFrom(firstDup.location, "/accounts/");
  const blocked = await submit("/accounts/new", M, 'name="displayName"', dupFields);
  check(
    "a duplicate is refused with the matching field and a link to the existing account",
    blocked.status === 200 && blocked.html.includes("This account already exists") && blocked.html.includes(`href="/accounts/${firstDupId}"`) && blocked.html.includes("same phone number"),
  );
  check("the matching field itself is marked", blocked.html.includes("Already used by Dup Person"));
  check("nothing was saved for the refused submission", (await db.party.count({ where: { displayName: "Dup Person Again" } })) === 0);
  check("the entered details are kept after the refusal", blocked.html.includes('value="Dup Person Again"'));
  check(
    "only Check again and Cancel are offered; there is no create-anyway option",
    blocked.html.includes("Check again") && blocked.html.includes(">Cancel<") && !blocked.html.includes("anyway") && !blocked.html.includes("confirmDuplicates"),
  );
  const forgedDup = await submit("/accounts/new", M, 'name="displayName"', { ...dupFields, confirmDuplicates: "1", duplicateIds: firstDupId }, blocked.html);
  check("a forged confirmation from the old form cannot create the duplicate", forgedDup.html.includes("This account already exists") && (await db.party.count({ where: { displayName: "Dup Person Again" } })) === 0);
  const recheck = await submit("/accounts/new", M, 'name="displayName"', dupFields, blocked.html);
  check("checking again with the same details is refused again", recheck.html.includes("This account already exists") && (await db.party.count({ where: { displayName: "Dup Person Again" } })) === 0);
  const corrected = await submit("/accounts/new", M, 'name="displayName"', { ...dupFields, phone: "0711 222 334" }, blocked.html);
  const dupId = idFrom(corrected.location, "/accounts/");
  check("after correcting the phone number the account is created", corrected.status === 303 && !!dupId && dupId !== firstDupId);
  // Two simultaneous submissions of the same person: the contact lock lets exactly one through.
  const raceUnits = await Promise.all(["W-7", "W-8"].map((unitNumber) => db.unit.create({ data: { buildingId: wb.id, unitNumber } })));
  await Promise.all(raceUnits.map((u) => submit("/accounts/new", M, 'name="displayName"', ownerForm("Race Owner", u.id, { phone: "0711 999 000" }))));
  check("two simultaneous submissions of the same account create exactly one", (await db.party.count({ where: { phone: "0711 999 000" } })) === 1);
  const editClash = await submit(`/accounts/${dupId}`, M, 'name="displayName"', { ...dupFields, phone: "0711222333" });
  check("editing an account to another account's phone is refused", editClash.html.includes("These details belong to another account") && (await db.party.findUniqueOrThrow({ where: { id: dupId } })).phone === "0711 222 334");

  // Archiving: only accounts never used for agreements, invoices or payments can be archived. Accounts made
  // with the Add Account form always have an agreement, so this one is recorded directly (test database).
  const archId = (await db.party.create({ data: { displayName: "Archive Me", phone: "0711 222 335" } })).id;
  const noReason = await submit(`/accounts/${archId}`, M, 'name="archiveReason"', { archiveReason: "  " });
  check("archiving needs a reason", noReason.html.includes("Give a reason for archiving"));
  await submit(`/accounts/${archId}`, ops, 'name="archiveReason"', { archiveReason: "Replay" }, noReason.html);
  check("operations cannot archive by replaying the form", (await db.party.findUniqueOrThrow({ where: { id: archId } })).archivedAt === null);
  const archivedRes = await submit(`/accounts/${archId}`, M, 'name="archiveReason"', { archiveReason: "Duplicate of Dup Person" });
  check("manager archives the duplicate", archivedRes.status === 303 && archivedRes.location.endsWith("?archived=1"), `${archivedRes.status} ${archivedRes.location}`);
  const recreate = await submit("/accounts/new", M, 'name="displayName"', ownerForm("Recreated", w6, { phone: "+254711222335" }));
  check("an archived account's details cannot be used for a new account", recreate.html.includes("(archived)") && (await db.party.count({ where: { displayName: "Recreated" } })) === 0);
  const register = await getPage("/accounts", M);
  const registerAll = await getPage("/accounts?archived=1", M);
  check(
    "archived accounts are hidden by default and shown with Show archived",
    !register.html.includes(`href="/accounts/${archId}"`) && registerAll.html.includes(`href="/accounts/${archId}"`) && registerAll.html.includes("Archived"),
  );
  const archivedPage = await getPage(`/accounts/${archId}`, M);
  check(
    "an archived account can be inspected with its reason, without new-transaction actions",
    archivedPage.status === 200 && archivedPage.html.includes("Duplicate of Dup Person") && !archivedPage.html.includes(`/payments/new?partyId=${archId}`) && !archivedPage.html.includes('name="archiveReason"'),
  );
  const payForm = await getPage("/payments/new", M);
  check("archived accounts are not offered for new payments", !payForm.html.includes(`value="${archId}"`) && payForm.html.includes(`value="${partyId}"`));
  const forcedPay = await submit("/payments/new", M, 'name="reference"', { partyId: archId, method: "CASH", reference: "ARCH1", amount: "10", receivedDate: todayISO(), evidenceNote: "" });
  check("a forged payment for an archived account is refused", forcedPay.html.includes("This account is archived"));

  // Permanent deletion (administrators only, typed confirmation) of an account never used.
  const delId = (await db.party.create({ data: { displayName: "Delete Me" } })).id;
  check("a manager sees no delete option", !(await getPage(`/accounts/${delId}`, M)).html.includes("Delete account permanently") && !(await getPage("/accounts", M)).html.includes("#delete-account"));
  const adminAccount = await getPage(`/accounts/${delId}`, admin);
  check("an administrator sees the delete option, clearly marked permanent", adminAccount.html.includes("Delete account permanently") && adminAccount.html.includes("cannot be undone") && (await getPage("/accounts", admin)).html.includes(`aria-label="Actions for ${(await db.party.findUniqueOrThrow({ where: { id: delId } })).displayName}"`));
  const registerActions = (await getPage("/accounts", admin)).html;
  check(
    "every account row ends with an Actions menu: View and Edit, and Archive or Delete only for an account without history",
    registerActions.includes('aria-label="Actions for Workflow Tenant"') && registerActions.includes(`href="/accounts/${delId}#edit"`) && registerActions.includes(`href="/accounts/${delId}#archive"`) &&
      registerActions.includes("it cannot be archived or deleted") && (await getPage(`/accounts/${delId}`, admin)).html.includes('id="edit"'),
  );
  check(
    "deleting asks once with the shared dialog (Delete record? — Cancel / Confirm Delete), with nothing to type",
    adminAccount.html.includes(">Delete record?<") && adminAccount.html.includes(">Confirm Delete<") && adminAccount.html.includes("Are you sure you want to delete this account? This action cannot be undone.") && !adminAccount.html.includes('name="confirmPhrase"') && !adminAccount.html.includes('name="deleteReason"'),
  );
  await submit(`/accounts/${delId}`, M, "Delete account permanently", {}, adminAccount.html);
  check("a manager cannot delete by replaying the administrator's form", (await db.party.count({ where: { id: delId } })) === 1);
  const deletedRes = await submit(`/accounts/${delId}`, admin, "Delete account permanently", {}, adminAccount.html);
  const afterDelete = await getPage(deletedRes.location, admin);
  check(
    "an eligible account is deleted and the register confirms it",
    deletedRes.status === 303 && deletedRes.location.endsWith("/accounts?deleted=1") && afterDelete.html.includes("Account deleted permanently") && !afterDelete.html.includes(`href="/accounts/${delId}"`),
  );
  const oldLink = await getPage(`/accounts/${delId}`, M);
  check("old links to the deleted account explain the deletion instead of failing", oldLink.status === 200 && oldLink.html.includes("Deleted account") && oldLink.html.includes("Permanently deleted account Delete Me"));

  const tenantAg = await db.agreement.findFirst({ where: { partyId } });
  const agreementId = tenantAg?.id ?? "";
  check("the tenant's rental agreement was created with the account", tenantAg?.type === "RENTAL" && String(tenantAg.rentAmount) === "20000" && tenantAg.dueDay === 5 && tenantAg.unitId === unitId);
  check("an account with an agreement cannot be archived, with the reason shown", (await getPage(`/accounts/${partyId}`, M)).html.includes("cannot be archived because it has 1 agreement(s)"));
  check("an account with an agreement cannot be deleted; archiving is recommended", (await getPage(`/accounts/${partyId}`, admin)).html.includes("cannot be deleted because it has 1 agreement(s)"));
  const owner = await submit("/agreements/new", M, 'name="unitId"', {
    type: "OWNERSHIP", unitId, partyId, reference: "", startDate: start, endDate: "", rentAmount: "",
    dueDay: "", graceDays: "", ownershipEvidence: "", purchaseDate: "", lateFeeTerms: "", allocationTerms: "", notes: "",
  });
  check("ownership without evidence is refused", owner.html.includes("ownership evidence"));

  const billingPage = await getPage(`/billing?month=${start}`, M);
  check("manager can preview billing but not issue", billingPage.html.includes("Review only"));
  const billingFinance = await getPage(`/billing?month=${start}`, finance);
  const replay = await submit(`/billing?month=${start}`, ops, " invoice(s) for", {}, billingFinance.html);
  check("operations cannot issue billing by replaying the form (server-side check)", replay.html.includes("permission") || replay.status === 307, `${replay.status}`);
  const issue = await submit(`/billing?month=${start}`, finance, " invoice(s) for", {}, billingFinance.html);
  const runReport = issue.status === 303 ? await getPage(issue.location.replace(BASE, ""), finance) : { html: "" };
  check(
    "finance issues the month's invoice; the run report shows what was created and skipped",
    issue.status === 303 && issue.location.includes("/billing?run=") && runReport.html.includes("Completed: 1 invoice(s) issued") && runReport.html.includes(">Already billed (skipped)<") && runReport.html.includes(">Failed<"),
    `${issue.status} ${issue.location}`,
  );
  const again = await getPage(`/billing?month=${start}`, finance);
  check("re-running the month offers nothing new: the charges are listed as already billed", again.html.includes("Already billed for this month — skipped") && !again.html.includes(">Issue ") && again.html.includes("Nothing new to bill"));
  const invoice = await db.invoice.findFirstOrThrow({ where: { agreementId } });

  const pay = recordedPayment(await submit("/payments/new", M, 'name="reference"', { partyId, method: "MPESA", reference: "wf123abc", amount: "25000", receivedDate: todayISO(), evidenceNote: "" }));
  const paymentId = idFrom(pay.location, "/payments/");
  check("record pending payment", pay.status === 303 && !!paymentId);
  const afterRecord = (await getPage(pay.listLocation.replace(BASE, ""), M)).html;
  check("after recording, the Payments list confirms it and shows it pending verification", afterRecord.includes("WF123ABC") && afterRecord.includes("is pending verification") && afterRecord.includes("Pending verification"));
  const dupPay = await submit("/payments/new", M, 'name="reference"', { partyId, method: "MPESA", reference: "WF123ABC", amount: "1", receivedDate: todayISO(), evidenceNote: "" });
  check("duplicate payment reference is refused", dupPay.html.includes("already been recorded"));
  const verify = await submit(`/payments/${paymentId}`, finance, "Verify and issue receipt", {});
  check("finance verifies the payment", verify.html.includes("Payment verified"));
  // Single-operator (F49): the administrator's Record payment saves it verified, allocated as entered, in one step.
  const oneStepForm = (await getPage(`/payments/new?partyId=${partyId}&invoiceId=${invoice.id}`, admin)).html;
  check("Record payment from an invoice suggests its remaining balance and offers one-step recording", oneStepForm.includes('name="verify" value="1"') && oneStepForm.includes(`For invoice ${invoice.number}`) && oneStepForm.includes(">Record payment<"));
  const oneStep = recordedPayment(await submit("/payments/new", admin, 'name="reference"', { partyId, method: "BANK", reference: "ADMIN-ONE-STEP", amount: "1", receivedDate: todayISO(), evidenceNote: "" }, oneStepForm));
  const oneStepRow = await db.payment.findFirstOrThrow({ where: { reference: "ADMIN-ONE-STEP" } });
  check(
    "the administrator's payment is recorded verified in one step, with a receipt, audited, and shown as such",
    oneStepRow.status === "VERIFIED" && !!oneStepRow.receiptNumber && oneStepRow.verifiedById === oneStepRow.recordedById &&
      (await db.auditEvent.count({ where: { entityId: oneStepRow.id, action: "payment.record_verified" } })) === 1 && (await getPage(oneStep.listLocation.replace(BASE, ""), admin)).html.includes(`(receipt ${oneStepRow.receiptNumber})`),
  );
  await submit(oneStep.location, admin, "Reverse this payment", { reason: "Workflow one-step test entry" }, (await getPage(oneStep.location, admin)).html);
  // A pending payment the administrator recorded (e.g. before F49) is still verified only under the explicit, audited exception.
  const selfPay = recordedPayment(await submit("/payments/new", admin, 'name="reference"', { partyId, method: "CASH", reference: "ADMIN-OWN-2", amount: "100", receivedDate: todayISO(), evidenceNote: "", verify: "" }));
  const selfPayPage = await getPage(selfPay.location, admin);
  const selfPayStatus = async () => (await db.payment.findFirstOrThrow({ where: { reference: "ADMIN-OWN-2" } })).status;
  check(
    "an administrator's own payment offers the audited self-verification exception, naming the other available verifier",
    selfPay.status === 303 && selfPayPage.html.includes("Verify payment (administrator exception)") && selfPayPage.html.includes("1 other active staff member(s) could verify it independently"),
  );
  const plainSelf = await submit(selfPay.location, admin, "Verify and issue receipt", {}, (await getPage(selfPay.location, finance)).html);
  check("posting the normal verify form for one's own payment is still refused", plainSelf.html.includes("someone other than the person who recorded it") && (await selfPayStatus()) === "PENDING");
  const finForged = await submit(selfPay.location, finance, 'name="confirmSelf"', { reason: "Forged exception by finance", confirmSelf: "yes" }, selfPayPage.html);
  check("a finance officer posting the exception form is refused", finForged.html.includes("Only a System Administrator") && (await selfPayStatus()) === "PENDING");
  const shortReason = await submit(selfPay.location, admin, 'name="confirmSelf"', { reason: "ok", confirmSelf: "yes" }, selfPayPage.html);
  const unconfirmed = await submit(selfPay.location, admin, 'name="confirmSelf"', { reason: "Checked the cash book myself" }, selfPayPage.html);
  check("the exception needs a real reason and the confirmation", shortReason.html.includes("at least 10 characters") && unconfirmed.html.includes("Confirm that you have checked") && (await selfPayStatus()) === "PENDING");
  await submit(selfPay.location, admin, 'name="confirmSelf"', { reason: "Checked the cash book entry for KES 100 myself", confirmSelf: "yes" }, selfPayPage.html);
  const selfVerifiedPage = await getPage(selfPay.location, admin);
  const selfPayRow = await db.payment.findFirstOrThrow({ where: { reference: "ADMIN-OWN-2" } });
  check(
    "the administrator verifies their own payment; it is marked self-verified and audited with the other verifier counted",
    selfPayRow.status === "VERIFIED" && selfPayRow.verifiedById === selfPayRow.recordedById && selfVerifiedPage.html.includes("Self-verified") &&
      (await db.auditEvent.count({ where: { entityId: selfPayRow.id, action: "payment.verify_self_exception", after: { path: ["otherActiveVerifiers"], equals: 1 } } })) === 1,
  );
  const reversedOwn = await submit(selfPay.location, admin, "Reverse this payment", { reason: "Test entry, reversed" }, selfVerifiedPage.html);
  check("the administrator reverses it through the reversal workflow (history kept)", reversedOwn.status === 200 && (await selfPayStatus()) === "REVERSED");

  const ownPay = recordedPayment(await submit("/payments/new", admin, 'name="reference"', { partyId, method: "CASH", reference: "ADMIN-OWN-1", amount: "100", receivedDate: todayISO(), evidenceNote: "", verify: "" }));
  const ownPage = await getPage(ownPay.location, admin);
  await submit(ownPay.location, admin, "Reject this payment", { reason: "Test entry, not a real payment" }, ownPage.html);
  check("the administrator's own test payment is rejected and never counts", (await db.payment.findFirstOrThrow({ where: { reference: "ADMIN-OWN-1" } })).status === "REJECTED");
  const over = await submit(`/payments/${paymentId}`, finance, 'name="allocate"', { allocate: "20000.01" });
  check("allocation above the invoice balance is refused", over.html.includes("is more than"));
  const alloc = await submit(`/payments/${paymentId}`, finance, 'name="allocate"', { allocate: "15000" });
  check("partial allocation saved", alloc.html.includes("Allocation saved"));
  const invPage = await getPage(`/invoices/${invoice.id}`, finance);
  check("invoice shows part-paid with 5,000 balance", invPage.html.includes("Part-paid") && invPage.html.includes("KES 5,000.00"));
  const payPage = await getPage(`/payments/${paymentId}`, finance);
  check("unallocated 10,000 stays on the payment", payPage.html.includes("KES 10,000.00"));

  const dash = await getPage("/", finance);
  check("dashboard shows the verified payments this month", dash.html.includes(">Verified payments (net)<") && dash.html.includes("KES 25,000.00"));
  check("dashboard unpaid balance reflects the allocation (5,000 left)", dash.html.includes(">Total outstanding<") && dash.html.includes("KES 5,000.00"));
  const dash12 = await getPage("/?period=12m", finance);
  check("dashboard period filter works", dash12.status === 200 && /aria-current="true"[^>]*>Last 12 months</.test(dash12.html));
  // Billing & Payments workspace: one entry point; tabs on each module; combined ledger.
  const ws = await getPage("/finance", finance);
  check(
    "the workspace overview separates billed, verified, pending and outstanding money; unallocated money shows on Payments",
    ws.status === 200 && ["Billed", "Verified payments", "Pending verification", "Outstanding"].every((t) => ws.html.includes(`>${t}<`)) && ws.html.includes("Create invoice") && ws.html.includes("Record payment") &&
      (await getPage("/payments", finance)).html.includes("Unallocated (for review)"),
  );
  const billingHome = (await getPage("/invoices", finance)).html;
  check(
    "Billing & Payments opens on the current month with the four summary cards and a More actions menu that leads to real operations",
    billingHome.includes(">Billing &amp; Payments<") && billingHome.includes("data-billing-summary") && ["Total tenants", "Total billed", "Paid / credited", "Outstanding balance"].every((t) => billingHome.includes(t)) &&
      billingHome.includes("More actions") && billingHome.includes("&amp;types=RENT") && billingHome.includes("&amp;types=MANAGEMENT_FEE") && billingHome.includes("&amp;choose=1") && billingHome.includes("/api/billing-report?download=1"),
    [">Billing &amp; Payments<", "data-billing-summary", "Total tenants", "Total billed", "Paid / credited", "Outstanding balance", "More actions", "&amp;types=RENT", "&amp;types=MANAGEMENT_FEE", "&amp;choose=1", "/api/billing-report?download=1"].filter((t) => !billingHome.includes(t)).join(" | "),
  );
  const billingCsv = await fetch(`${BASE}/api/billing-report?download=1`, { headers: { cookie: finance } });
  const billingCsvText = (await billingCsv.text()).replace(/^\uFEFF/, "");
  const anonCsv = await fetch(`${BASE}/api/billing-report`, { redirect: "manual" });
  check("the billing report downloads as CSV for finance and is refused without a session", billingCsv.status === 200 && billingCsvText.startsWith("Invoice,Account,Account type") && anonCsv.status !== 200, `${billingCsv.status} ${JSON.stringify(billingCsvText.slice(0, 40))} anon ${anonCsv.status}`);
  const ledgerPage = await getPage("/finance/ledger?from=2000-01-01", finance);
  check("the combined ledger lists the issued invoice and the verified payment", ledgerPage.html.includes(invoice.number ?? "missing") && ledgerPage.html.includes("Verified payment") && ledgerPage.html.includes("Payments not counted"));
  const invTabs = (await getPage("/invoices?period=all", finance)).html;
  const workspaceTabs = (html: string) => [...(html.match(/<nav aria-label="Billing and payments"[\s\S]*?<\/nav>/)?.[0] ?? "").matchAll(/>([^<>]+)<\/a>/g)].map((x) => x[1]);
  check("the workspace has two lists, Invoices and Payments (the overview is a link beside them)", JSON.stringify(workspaceTabs(invTabs)) === JSON.stringify(["Invoices", "Payments", "Billing overview"]), workspaceTabs(invTabs).join(", "));
  check(
    "Invoices keeps credit notes, notices & arrears and billing runs one click away, with Create Invoice, Record Payment and an Actions menu per row",
    ['href="/invoices?view=credit-notes"', 'href="/notices"', 'href="/billing"'].every((t) => invTabs.includes(t)) && invTabs.includes(">Create Invoice<") && invTabs.includes(">Record Payment<") &&
      [">Account<", ">Charges<", ">Invoice date<", ">Due date<", ">Paid<", ">Credits<", ">Outstanding<"].every((t) => invTabs.includes(t)) && invTabs.includes(`aria-label="Actions for ${invoice.number}"`) &&
      invTabs.includes(`href="/payments/new?partyId=${partyId}&amp;invoiceId=${invoice.id}"`) && invTabs.includes("Issued invoices are kept for the record"),
  );
  const overviewPage = (await getPage("/finance", finance)).html;
  check(
    "Overview (the default) shows billed, verified payments, pending verification and outstanding, the monthly chart, collection rate, upcoming billing and recent payments",
    [">Billed<", ">Verified payments<", ">Pending verification<", ">Outstanding<", "Monthly billing vs verified collections", "Collection rate for the period", "Upcoming billing", "Recent payment activity"].every((t) => overviewPage.includes(t)) &&
      overviewPage.includes("WF123ABC") && overviewPage.includes('href="/payments">View all<'),
  );
  check("the amounts owed ledger opens from the overview", (await getPage("/finance", finance)).html.includes('href="/finance/ledger'));
  const opsHome = await getPage("/", ops);
  check("operations staff get Expenses in the sidebar, not the finance workspace", opsHome.html.includes(">Expenses</span>") && !opsHome.html.includes(">Billing &amp; Payments</span>"));
  check("operations cannot open the finance workspace", (await getPage("/finance", ops)).location.includes("/no-access"));
  const opsDash = await getPage("/", ops);
  // Operations may see expense amounts (their role views expenses), but no receivables, collections or payments.
  check(
    "operations dashboard shows no receivables, collections or payments",
    opsDash.status === 200 && !opsDash.html.includes(">Collected<") && !opsDash.html.includes(">Outstanding<") && !opsDash.html.includes("25,000.00") && !opsDash.html.includes("Overdue accounts"),
  );
  const openInv = await getPage("/invoices?status=OPEN", finance);
  check("invoice 'open balance' filter lists the part-paid invoice", openInv.html.includes(invoice.number!));
  const future = await getPage("/invoices?from=2099-01-01", finance);
  check("invoice date filter excludes invoices outside the range", !future.html.includes(invoice.number!));
  const search = await getPage("/payments?q=wf123", finance);
  check("payment search finds the payment by reference", search.html.includes("WF123ABC"));

  const cn = await submit(`/invoices/${invoice.id}`, finance, 'name="reason"', { amount: "6000", reason: "too much" });
  check("credit note above balance is refused", cn.html.includes("cannot exceed"));
  const cn2 = await submit(`/invoices/${invoice.id}`, finance, 'name="reason"', { amount: "1000", reason: "Agreed correction" });
  check("credit note recorded", cn2.html.includes("Credit note CN-"));

  const exp = await submit("/expenses/new", ops, 'name="payee"', {
    category: "CLEANING", payee: "Workflow Cleaners", amount: "3000", description: "Test", servicePeriodStart: "", servicePeriodEnd: "",
    costCentre: "", evidenceNote: "", workOrderId: "", intent: "submit",
  });
  const expenseId = idFrom(exp.location, "/expenses/");
  check("operations submits an expense", exp.status === 303 && !!expenseId);
  const toApprove = (await getPage(`/expenses/${expenseId}`, finance)).html;
  const expApproval = approvalForm(toApprove);
  check(
    "the expense page approves with one popup (Approve expense? / Cancel / Confirm Approval) and asks for no reason",
    expApproval.oneStep && expApproval.form.includes("Approve expense?") && expApproval.form.includes("Are you sure you want to approve this expense?") && expApproval.form.includes(">Cancel<") && !toApprove.includes("administrator exception"),
  );
  const approve = await submit(`/expenses/${expenseId}`, finance, 'name="approve"', {}, toApprove);
  const approvedNow = await db.expense.findUniqueOrThrow({ where: { id: expenseId } });
  check(
    "finance approves it; the page reloads with the success message, approved but not paid",
    approve.status === 303 && approve.location.endsWith(`/expenses/${expenseId}?approved=1`) && approvedNow.status === "APPROVED" && approvedNow.paidAt === null &&
      (await getPage(`/expenses/${expenseId}?approved=1`, finance)).html.includes("Expense approved successfully."),
  );
  const approveAgain = await submit(`/expenses/${expenseId}`, finance, 'name="approve"', {}, toApprove);
  check("approving it a second time (a stale page or double submission) is refused and audited once", approveAgain.status === 200 && approveAgain.html.includes("already been approved") && (await db.auditEvent.count({ where: { entityId: expenseId, action: "expense.approve" } })) === 1);
  check("approving an expense created no invoice", (await db.invoice.count()) === 1);
  const approvedPage = (await getPage(`/expenses/${expenseId}`, finance)).html;
  check("an approved expense asks for the actual payment date before it is marked paid", approvedPage.includes('name="paidDate"') && approvedPage.includes("Approval alone does not mean it was paid"));
  const paidExp = await submit(`/expenses/${expenseId}`, finance, 'name="paidDate"', { paidDate: todayISO(), method: "BANK", reference: "WF-EXP-1" }, approvedPage);
  const paidRow = await db.expense.findUniqueOrThrow({ where: { id: expenseId } });
  check("finance records the payment with its date; only then is the expense paid", paidExp.html.includes("Expense marked as paid") && paidRow.status === "PAID" && paidRow.paidDate?.toISOString().slice(0, 10) === todayISO());
  const overview = (await getPage("/finance", finance)).html;
  check("the Billing & Payments overview keeps to billing and payments (expenses are on the dashboard and in Expenses)", !overview.includes(">Costs approved<") && !overview.includes(">Paid out<") && overview.includes(">Verified payments<"));
  const dashFin = (await getPage("/", finance)).html;
  check(
    "the dashboard's monthly expenses graph separates costs approved from paid out, linked to filtered lists",
    dashFin.includes("Monthly expenses (KES)") && dashFin.includes("Approved, not yet paid:") && dashFin.includes("Paid out this month:") && dashFin.includes("status=PAID&amp;basis=paid"),
  );
  const dashAdmin = (await getPage("/", admin)).html;
  const dashLinks = [
    ["occupied units", 'href="/units?occupancy=OCCUPIED"'],
    ["vacant units", 'href="/units?occupancy=VACANT"'],
    ["outstanding from earlier months", "/invoices?status=OPEN&amp;to="],
    ["total outstanding", 'href="/invoices?status=OPEN&amp;period=all"'],
    ["unallocated verified payments", 'href="/payments?unallocated=1"'],
    ["the period's billed amount", "/invoices?from="],
    ["the period's verified payments", "/payments?status=VERIFIED&amp;from="],
    ["pending verification", 'href="/payments?status=PENDING"'],
    ["the arrears bands", "/reports?report=arrears&amp;bucket="],
    ["past-due invoices", 'href="/invoices?status=PAST_DUE&amp;period=all"'],
    ["Run monthly billing", 'href="/billing"'],
    ["Add unit", 'href="/units/new"'],
    ["Prepare reminders", 'href="/notices"'],
    ["Record payment", 'href="/payments/new"'],
    ["Today and This week periods", 'href="/?period=today"'],
  ];
  const buildingCard = /<a(?=[^>]*href="\/units")(?=[^>]*data-building)[^>]*>/.test(dashAdmin);
  const missingLinks = [...(buildingCard ? [] : ["the building card opens the unit register"]), ...dashLinks.filter(([, t]) => !dashAdmin.includes(t)).map(([n]) => n)];
  check("every dashboard figure and action links to its list or workflow", missingLinks.length === 0, missingLinks.join(", "));
  check("the dashboard's explanatory paragraph is gone and the arrears panel names the accounts owing most", !dashAdmin.includes("Unpaid balances and arrears are amounts owed") && (dashAdmin.includes("data-top-arrears") || !dashAdmin.includes("past due ·")));
  const dashOps = (await getPage("/", ops)).html;
  check("a role without financial access gets no financial figures or links to them", !dashOps.includes("Unpaid Tenant Balance") && !dashOps.includes('href="/payments?unallocated=1"') && !dashOps.includes('href="/billing"'));
  const unallocatedPage = await getPage("/payments?unallocated=1", finance);
  check("the unallocated-payments link opens the payments with money not yet applied", unallocatedPage.status === 200 && unallocatedPage.html.includes("money not yet applied to any invoice"));
  const occupiedUnits = await getPage("/units?occupancy=OCCUPIED", admin);
  check("the occupied-units link opens the unit register filtered to occupied units", occupiedUnits.status === 200 && occupiedUnits.html.includes('value="OCCUPIED" selected'));
  const customFrom = monthStart(todayISO());
  const customDash = (await getPage(`/?period=custom&from=${customFrom}&to=${todayISO()}`, finance)).html;
  check(
    "the dashboard's date range opens a start/end form and a custom range is applied (labelled Custom range, links keep the range)",
    customDash.includes('aria-label="Choose a date range"') && customDash.includes('name="from"') && customDash.includes('value="custom"') && customDash.includes(">Custom range") &&
      customDash.includes(`/finance?period=custom&amp;from=${customFrom}&amp;to=${todayISO()}`),
  );
  const backwards = (await getPage(`/?period=custom&from=${todayISO()}&to=${customFrom === todayISO() ? "2000-01-01" : customFrom}`, finance)).html;
  check("a start date after the end date is refused with a message; this month is shown instead", backwards.includes("The start date is after the end date") && backwards.includes("Showing this month instead"));
  const customFinance = (await getPage(`/finance?period=custom&from=${customFrom}&to=${todayISO()}`, finance)).html;
  check("Billing & Payments uses the same custom range", customFinance.includes("Custom range ·"));
  const paidList = (await getPage(`/expenses?status=PAID&basis=paid&from=${monthStart(todayISO())}&to=${todayISO()}`, finance)).html;
  check("the paid-out link lists the expense paid this month", paidList.includes("Workflow Cleaners"));

  // An administrator's own expense (F61): the same one-step approval; rejecting needs a reason.
  const adminExp = await submit("/expenses/new", admin, 'name="payee"', {
    category: "OTHER", payee: "Admin Own Supplies", amount: "500", description: "Test", servicePeriodStart: "", servicePeriodEnd: "",
    costCentre: "", evidenceNote: "", workOrderId: "", intent: "submit",
  });
  const adminExpPath = `/expenses/${idFrom(adminExp.location, "/expenses/")}`;
  const adminExpPage = await getPage(adminExpPath, admin);
  const adminExpRow = async () => db.expense.findFirstOrThrow({ where: { payee: "Admin Own Supplies" } });
  check("an administrator's own expense shows the same one-step Approve, with no exception form or reason", adminExp.status === 303 && approvalForm(adminExpPage.html).oneStep && !adminExpPage.html.includes("administrator exception") && !adminExpPage.html.includes('name="confirmSelf"'));
  const rejectNoReason = await submit(adminExpPath, admin, 'name="reason"', { reason: "" }, adminExpPage.html);
  check("rejecting without a reason is refused and changes nothing", rejectNoReason.html.includes("A reason is required to reject") && (await adminExpRow()).status === "SUBMITTED");
  const ownReject = await submit(adminExpPath, admin, 'name="reason"', { reason: "Bought by mistake; returned to the shop" }, adminExpPage.html);
  const rejectedRow = await adminExpRow();
  check(
    "the administrator rejects their own expense; the reason is the decision reason and it is audited as their own",
    ownReject.html.includes("Expense rejected") && rejectedRow.status === "REJECTED" && rejectedRow.decisionReason === "Bought by mistake; returned to the shop" &&
      (await db.auditEvent.count({ where: { entityId: rejectedRow.id, action: "expense.reject", after: { path: ["ownRecord"], equals: true } } })) === 1 &&
      (await getPage(adminExpPath, admin)).html.includes("Rejected by the person who created or submitted it"),
  );
  const ownApproveExp = await submit("/expenses/new", admin, 'name="payee"', {
    category: "OTHER", payee: "Admin Own Approved", amount: "700", description: "Test", servicePeriodStart: "", servicePeriodEnd: "",
    costCentre: "", evidenceNote: "", workOrderId: "", intent: "submit",
  });
  const ownApprovePath = `/expenses/${idFrom(ownApproveExp.location, "/expenses/")}`;
  const ownApproved = await submit(ownApprovePath, admin, 'name="approve"', {});
  check(
    "the administrator approves their own expense in one step, audited as their own",
    ownApproved.status === 303 && (await db.expense.findFirstOrThrow({ where: { payee: "Admin Own Approved" } })).status === "APPROVED" &&
      (await db.auditEvent.count({ where: { action: "expense.approve", summary: { contains: "own expense" }, after: { path: ["ownRecord"], equals: true } } })) >= 1,
  );
  const opsExp = await submit("/expenses/new", ops, 'name="payee"', {
    category: "CLEANING", payee: "Workflow List Approval", amount: "900", description: "Test", servicePeriodStart: "", servicePeriodEnd: "",
    costCentre: "", evidenceNote: "", workOrderId: "", intent: "submit",
  });
  const pendingExpenses = (await getPage("/expenses?status=SUBMITTED", finance)).html;
  check("a submitted expense has Approve (one popup) and Reject in its Actions menu", opsExp.status === 303 && approvalForm(pendingExpenses, 'name="returnTo" value="/expenses?status=SUBMITTED"').oneStep && pendingExpenses.includes(">Reject<"));
  const listApproved = await submit("/expenses?status=SUBMITTED", finance, 'name="returnTo" value="/expenses?status=SUBMITTED"', {}, pendingExpenses);
  check(
    "approving from the list returns to the same filtered list with the success message",
    listApproved.status === 303 && listApproved.location.endsWith("/expenses?status=SUBMITTED&approved=1") && (await db.expense.findFirstOrThrow({ where: { payee: "Workflow List Approval" } })).status === "APPROVED" &&
      (await getPage("/expenses?status=SUBMITTED&approved=1", finance)).html.includes("Expense approved successfully."),
  );
  const opsPending = await submit("/expenses/new", ops, 'name="payee"', {
    category: "CLEANING", payee: "Workflow Not Yours", amount: "100", description: "Test", servicePeriodStart: "", servicePeriodEnd: "",
    costCentre: "", evidenceNote: "", workOrderId: "", intent: "submit",
  });
  const opsPendingPath = `/expenses/${idFrom(opsPending.location, "/expenses/")}`;
  const forgedApproval = await submit(opsPendingPath, M, 'name="approve"', {}, (await getPage(opsPendingPath, finance)).html);
  check(
    "a manager (no approval permission) sees no Approve and posting the approval is refused",
    !approvalForm((await getPage(opsPendingPath, M)).html).form && forgedApproval.status !== 303 && (await db.expense.findFirstOrThrow({ where: { payee: "Workflow Not Yours" } })).status === "SUBMITTED",
  );
  const rejectedPage = (await getPage(adminExpPath, admin)).html;
  check("a rejected expense can no longer be edited; it offers a corrected copy instead", rejectedPage.includes("Record a corrected copy") && !rejectedPage.includes("Correct and resubmit"));
  const copyForm = (await getPage(`/expenses/new?copy=${rejectedRow.id}`, admin)).html;
  check("the corrected copy starts from the rejected expense's details", copyForm.includes(`Corrected copy of rejected expense ${rejectedRow.number}`) && copyForm.includes('value="Admin Own Supplies"'));

  // ---------------------------------------------------------------- staff salary payments
  const financeHome = (await getPage("/staff", finance)).html;
  const sidebarOf = (html: string) => html.match(/<nav aria-label="Main"[\s\S]*?<\/nav>/)?.[0] ?? "";
  const staffTabsOf = (html: string) => html.match(/<nav aria-label="Staff"[\s\S]*?<\/nav>/)?.[0] ?? "";
  check(
    "Staff opens Staff Management with the staff list straight away and the four sections as tabs in the page",
    financeHome.includes(">Staff Management</h1>") && financeHome.includes(">Staff name<") &&
      ["Staff", "Staff Payments", "Salary Management", "Tasks"].every((t) => staffTabsOf(financeHome).includes(`>${t}</a>`)),
  );
  check(
    "Staff & Tasks under Property/Unit is the one sidebar entry for staff; the salary pages are tabs of Staff Management, not sidebar entries",
    sidebarOf(financeHome).split('href="/staff"').length === 2 && ['href="/staff/salaries"', 'href="/staff/salary-payments"', 'href="/staff/tasks"', ">Salary Management<", ">Salary Payments<"].every((t) => !sidebarOf(financeHome).includes(t)) &&
      sidebarOf(financeHome).indexOf(">Property/Unit</span>") < sidebarOf(financeHome).indexOf(">Staff &amp; Tasks</span>"),
  );
  const managerStaff = (await getPage("/staff", M)).html;
  check("a manager sees the Staff list and Tasks tabs but no salary sections", staffTabsOf(managerStaff).includes(">Tasks</a>") && !managerStaff.includes('href="/staff/salary-payments"') && !managerStaff.includes('href="/staff/salaries"') && managerStaff.includes(">Add Staff<"));
  const oldDirectory = await getPage("/staff/directory", M);
  check("the old Staff Directory address still works (redirects to the staff list)", oldDirectory.status === 307 && oldDirectory.location.endsWith("/staff"));
  check("operations and managers cannot open salary pages", (await getPage("/staff/salaries", ops)).location.includes("/no-access") && (await getPage("/staff/salary-payments", M)).location.includes("/no-access"));
  const newStaff = await submit("/staff/new", admin, 'name="fullName"', { fullName: "Workflow Guard", position: "Night guard", phone: "0722 000 111", salaryAmount: "18,000", startDate: "2025-01-01", endDate: "", notes: "" });
  const guardId = new URLSearchParams(newStaff.location.split("?")[1] ?? "").get("created") ?? "";
  const afterCreate = (await getPage(newStaff.location.replace(BASE, ""), admin)).html;
  check("Add Staff returns to the staff list with a confirmation, and the new staff member is listed", newStaff.status === 303 && !!guardId && afterCreate.includes("Workflow Guard was added to the staff list") && afterCreate.includes(`href="/staff/${guardId}"`));
  check("the staff list searches by name and filters by employment status", (await getPage("/staff?q=workflow%20guard", admin)).html.includes("Workflow Guard") && !(await getPage("/staff?q=nobody-like-this", admin)).html.includes("Workflow Guard") && !(await getPage("/staff?status=former", admin)).html.includes("Workflow Guard"));
  check("each row's Actions menu offers View and Edit; Delete is listed as unavailable with the reason (records are kept)", afterCreate.includes(`aria-label="Actions for Workflow Guard"`) && afterCreate.includes(`href="/staff/${guardId}"`) && afterCreate.includes(`href="/staff/${guardId}#edit"`) && afterCreate.includes("Delete staff member") && afterCreate.includes("Staff records are kept for their salaries"));
  const guardPage = (await getPage(`/staff/${guardId}`, admin)).html;
  check("View opens the staff record with its details and the edit form", guardPage.includes("Workflow Guard") && guardPage.includes('id="edit"') && guardPage.includes("0722 000 111"));
  const salaryMonth = todayISO().slice(0, 7);
  const salaryFields = { staffMemberId: guardId, month: salaryMonth, gross: "18,000", allowances: "500.50", deductions: "", notes: "Workflow salary", evidenceNote: "", intent: "submit" };
  const salaryForm = (await getPage("/staff/salary-payments/new", finance)).html;
  check("the record form offers the staff member with their agreed salary and explains that no statutory deductions are calculated", salaryForm.includes("Workflow Guard") && salaryForm.includes("not calculated"));
  const recorded = await submit("/staff/salary-payments/new", finance, 'name="gross"', salaryFields, salaryForm);
  const salaryRow = async () => db.expense.findFirstOrThrow({ where: { category: "SALARIES", staffMemberId: guardId, status: { not: "DRAFT" } } });
  const salaryPath = `/staff/salary-payments/${(await salaryRow()).id}`;
  const recordedList = (await getPage(recorded.location.replace(BASE, ""), finance)).html;
  check(
    "finance records a salary payment; Staff Payments lists it as pending approval with a confirmation (18,000 + 500.50)",
    recorded.status === 303 && recorded.location.includes("/staff/salary-payments?recorded=") && (await salaryRow()).status === "SUBMITTED" && String((await salaryRow()).amount) === "18500.5" &&
      recordedList.includes("is pending approval") && recordedList.includes("KES 18,500.50") && recordedList.includes(">Record Payment<"),
  );
  const dupSalary = await submit("/staff/salary-payments/new", finance, 'name="gross"', salaryFields, salaryForm);
  check("a second salary payment for the same staff member and month is refused", dupSalary.html.includes("already exists") && (await db.expense.count({ where: { category: "SALARIES", staffMemberId: guardId } })) === 1);
  const forgedSalary = await submit("/staff/salary-payments/new", M, 'name="gross"', { ...salaryFields, month: "2026-01" }, salaryForm);
  check("a manager posting the salary form is refused", forgedSalary.status !== 303 && (await db.expense.count({ where: { category: "SALARIES", staffMemberId: guardId } })) === 1);
  const listForAdmin = (await getPage("/staff/salary-payments?status=SUBMITTED", admin)).html;
  check("a pending salary shows Approve and Reject in its row for an approver", listForAdmin.includes(">Approve<") && listForAdmin.includes(`href="${salaryPath}#decide"`));
  const salaryApproval = approvalForm(listForAdmin, 'name="returnTo" value="/staff/salary-payments?status=SUBMITTED"');
  check("the salary Approve uses one popup (Approve salary payment? / Confirm Approval) with nothing to type", salaryApproval.oneStep && salaryApproval.form.includes("Approve salary payment?") && salaryApproval.form.includes("Are you sure you want to approve this salary payment?"));
  const salaryPage = (await getPage(salaryPath, finance)).html;
  check("finance, who recorded it, also sees the one-step Approve on its page (no exception form)", approvalForm(salaryPage).oneStep && !salaryPage.includes("administrator exception") && !salaryPage.includes("another approver must decide"));
  const salaryBefore = await salaryRow();
  const approvedSalary = await submit("/staff/salary-payments?status=SUBMITTED", admin, 'name="returnTo" value="/staff/salary-payments?status=SUBMITTED"', {}, listForAdmin);
  const afterApproval = await salaryRow();
  check(
    "the administrator approves it from the list; it is approved but not marked paid, amounts unchanged, with the success message",
    approvedSalary.status === 303 && approvedSalary.location.endsWith("/staff/salary-payments?status=SUBMITTED&approved=1") && afterApproval.status === "APPROVED" && afterApproval.paidAt === null &&
      String(afterApproval.amount) === String(salaryBefore.amount) && String(afterApproval.salaryDeductions) === String(salaryBefore.salaryDeductions) && afterApproval.staffMemberId === salaryBefore.staffMemberId &&
      (await getPage("/staff/salary-payments?status=SUBMITTED&approved=1", admin)).html.includes("Salary payment approved successfully.") && (await getPage(salaryPath, finance)).html.includes("Approved — not yet paid"),
  );
  check("an approved salary shows Record payment in its row", (await getPage("/staff/salary-payments?status=APPROVED", finance)).html.includes(`href="${salaryPath}#pay"`));
  const salaryPayForm = (await getPage(salaryPath, finance)).html;
  const noMethod = await submit(salaryPath, finance, 'name="paidDate"', { paidDate: todayISO(), method: "", reference: "SALWF1" }, salaryPayForm);
  check("marking paid without choosing Paid by is refused with a message, and nothing changes", noMethod.html.includes("Choose how it was paid.") && (await salaryRow()).status === "APPROVED");
  const paidSalary = await submit(salaryPath, finance, 'name="paidDate"', { paidDate: todayISO(), method: "MPESA", reference: "SALWF1" }, salaryPayForm);
  const afterPay = await salaryRow();
  check(
    "finance records the actual payment; the page reloads with the success message and the record stays paid",
    paidSalary.status === 303 && paidSalary.location.endsWith(`${salaryPath}?paid=1`) && afterPay.status === "PAID" && afterPay.paymentReference === "SALWF1" && afterPay.paymentMethod === "MPESA" && !!afterPay.paidDate &&
      (await getPage(`${salaryPath}?paid=1`, finance)).html.includes("Salary payment marked as paid successfully.") && (await getPage(salaryPath, finance)).html.includes(">Paid<"),
  );
  const payAgain = await submit(salaryPath, finance, 'name="paidDate"', { paidDate: todayISO(), method: "MPESA", reference: "SALWF1" }, salaryPayForm);
  check("submitting the payment again (stale page or double click) is refused and paid once", payAgain.html.includes("already been marked as paid") && (await db.auditEvent.count({ where: { entityId: afterPay.id, action: "salary.pay" } })) === 1);
  const salaryExpenseLink = await getPage(`/expenses/${afterPay.id}`, finance);
  check("the old expense link of a salary opens its salary page", salaryExpenseLink.status === 307 && salaryExpenseLink.location.includes(`/staff/salary-payments/${afterPay.id}`));
  check("a manager cannot open the salary through the expense link either", (await getPage(`/expenses/${afterPay.id}`, M)).status === 404);
  const paidSalaries = (await getPage("/staff/salary-payments?status=PAID", finance)).html;
  check("Staff Payments shows the paid salary with its payment date, method and reference, and only View", paidSalaries.includes("SALWF1") && paidSalaries.includes("M-Pesa") && paidSalaries.includes(`href="${salaryPath}"`) && paidSalaries.includes(">View salary payment<") && !paidSalaries.includes(`href="${salaryPath}#pay"`) && paidSalaries.includes("Submitted, approved, paid and rejected salary payments are kept for the record"));
  // A draft (prepared, never submitted) can be deleted from the list; nothing else can.
  const prevMonth = addMonths(monthStart(todayISO()), -1).slice(0, 7);
  await submit("/staff/salary-payments/new", finance, 'name="gross"', { ...salaryFields, month: prevMonth, intent: "draft" }, salaryForm);
  const draftRow = await db.expense.findFirstOrThrow({ where: { category: "SALARIES", staffMemberId: guardId, status: "DRAFT" } });
  const draftsList = (await getPage("/staff/salary-payments?status=DRAFT", finance)).html;
  const deleted = await submit("/staff/salary-payments", finance, "delete this draft salary payment", {}, draftsList);
  check(
    "a draft salary can be deleted from Staff Payments (audited); paid ones offer no delete",
    deleted.html.includes("Draft deleted") && (await db.expense.count({ where: { id: draftRow.id } })) === 0 &&
      (await db.auditEvent.count({ where: { entityId: draftRow.id, action: "salary.draft_delete" } })) === 1 && !paidSalaries.includes("delete this draft salary payment"),
  );
  const reportHtml = (await getPage(`/reports/expenses?from=${monthStart(todayISO())}&to=${todayISO()}`, finance)).html;
  check("the expense report shows staff salaries separately from running costs", reportHtml.includes("Staff salaries:") && reportHtml.includes("KES 18,500.50") && reportHtml.includes("Building running costs:"));

  const newUser = await submit("/settings/users", admin, 'name="email"', { name: "New Staff", email: "new.staff@workflow.test", role: "AUDITOR" });
  check("admin creates a staff account and sees a one-time password", newUser.html.includes("Temporary password"));
  const opsSettings = await getPage("/settings/users", ops);
  check("operations is redirected away from staff accounts", opsSettings.status === 307 && opsSettings.location.includes("/no-access"));

  const logout = await submit("/", M, "Sign out", {});
  check("sign out redirects to login", logout.status === 303 && logout.location.includes("/login"));
  const afterLogout = await getPage("/units", M);
  check("the old session no longer works", afterLogout.status === 307 && afterLogout.location.includes("/login"));

  // ---------------------------------------------------------------- documents and the combined Add Account form
  const MG = (await login("manager@workflow.test")).cookie; // the earlier manager session was signed out above
  const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");
  const upload = (cookie: string, ownerType: string, category: string, bytes: Uint8Array, name: string, origin: string | null = BASE) => {
    const fd = new FormData();
    fd.append("file", new Blob([bytes as BlobPart]), name);
    fd.append("ownerType", ownerType);
    fd.append("category", category);
    return fetch(`${BASE}/api/documents`, { method: "POST", body: fd, headers: { cookie, ...(origin ? { origin } : {}) } });
  };
  check("an upload without a session is refused", (await upload("", "PARTY", "ID_DOCUMENT", PDF_BYTES, "id.pdf")).status === 401);
  check("an upload from another website is refused", (await upload(MG, "PARTY", "ID_DOCUMENT", PDF_BYTES, "id.pdf", "https://evil.example")).status === 403);
  const fake = await upload(MG, "PARTY", "ID_DOCUMENT", new TextEncoder().encode("<html>not a pdf</html>"), "id.pdf");
  check("a file whose contents are not PDF/JPEG/PNG is refused, whatever its name", fake.status === 400 && (await fake.json()).error.includes("Only PDF, JPEG and PNG"));
  check("operations cannot upload account documents", (await upload(ops, "PARTY", "ID_DOCUMENT", PDF_BYTES, "id.pdf")).status === 403);
  const idDoc = (await (await upload(MG, "PARTY", "ID_DOCUMENT", PDF_BYTES, "national-id.pdf")).json()) as { id: string };
  const signedDoc = (await (await upload(MG, "AGREEMENT", "SIGNED_AGREEMENT", PDF_BYTES, "signed-agreement.pdf")).json()) as { id: string };
  check("account and agreement documents are staged", !!idDoc.id && !!signedDoc.id);

  const w2 = await db.unit.findFirstOrThrow({ where: { unitNumber: "W-2" } });
  const addPage = await getPage("/accounts/new", MG);
  check(
    "Add New Account shows Account Information and Agreement Information with the three types and one Create Account button",
    ["Add New Account", "Account Information", "Agreement Information", "Rent-Paying Tenant", "Purchased Unit Owner", "Purchased Unit Managed by BAKAAL", "Additional Agreement Details (Optional)", "Monthly rent (KES)", "Signed rental agreement", ">Create Account<"].every((t) => addPage.html.includes(t)) &&
      !addPage.html.includes('name="ownershipEvidence"') && !addPage.html.includes('name="managementFee"'),
  );
  const opsTry = await submit("/accounts/new", ops, 'name="displayName"', tenantForm("Ops Tenant", w2.id), addPage.html);
  check("operations cannot create an account by posting the form", opsTry.status !== 303 && (await db.party.count({ where: { displayName: "Ops Tenant" } })) === 0);
  const combined = new FormData();
  for (const [k, v] of findForm(addPage.html, 'name="displayName"')) combined.append(k, v);
  for (const [k, v] of Object.entries({ displayName: "Combined Tenant", phone: "0799 000 111", email: "", idNumber: "A123", notes: "", accountType: "TENANT", unitId: w2.id, startDate: start, endDate: "", rentAmount: "18,500.00", depositAmount: "37,000", dueDay: "5", graceDays: "", reference: "RA-WF-1", lateFeeTerms: "", allocationTerms: "", agreementNotes: "" })) combined.append(k, v);
  combined.append("documentIds", idDoc.id);
  combined.append("agreementDocumentIds", signedDoc.id);
  const created2 = await fetch(`${BASE}/accounts/new`, { method: "POST", body: combined, headers: { cookie: MG }, redirect: "manual" });
  const combinedId = idFrom(created2.headers.get("location") ?? "", "/accounts/");
  const combinedAg = combinedId ? await db.agreement.findFirst({ where: { partyId: combinedId } }) : null;
  const created2Body = created2.status === 200 ? await created2.text() : "";
  check(
    "one submission creates the account and its rental agreement, with the agreed deposit",
    created2.status === 303 && !!combinedAg && combinedAg.unitId === w2.id && combinedAg.reference === "RA-WF-1" && String(combinedAg.rentAmount) === "18500" && String(combinedAg.depositAmount) === "37000",
    `${created2.status} ${created2Body.match(/role="alert"[^>]*>([\s\S]{0,400})/)?.[1]?.replace(/<[^>]+>/g, " ") ?? ""}`,
  );
  if (combinedAg) {
    const agPageHtml = (await getPage(`/agreements/${combinedAg.id}`, MG)).html;
    const acctAgTab = (await getPage(`/accounts/${combinedId}?tab=agreement`, MG)).html;
    check(
      "the agreed deposit shows on the agreement and the account, marked as not invoiced or received, and is not billed",
      agPageHtml.includes("Deposit (agreed)") && agPageHtml.includes("KES 37,000.00") && agPageHtml.includes("agreed, not invoiced or received") && acctAgTab.includes("KES 37,000.00") &&
        (await db.invoiceLine.count({ where: { amount: "37000" } })) === 0,
    );
  }
  check("the Add Account form offers the optional Deposit Amount (KES)", (await getPage("/accounts/new", MG)).html.includes('name="depositAmount"'));
  check(
    "the documents are attached to the account and the agreement",
    (await db.document.count({ where: { id: idDoc.id, ownerType: "PARTY", ownerId: combinedId } })) === 1 && (await db.document.count({ where: { id: signedDoc.id, ownerType: "AGREEMENT", ownerId: combinedAg?.id } })) === 1,
  );
  const docTab = await getPage(`/accounts/${combinedId}?tab=documents`, MG);
  check("the account's Documents tab lists both documents", docTab.html.includes("national-id.pdf") && docTab.html.includes("signed-agreement.pdf"));
  check("the new agreement appears once in the Agreements module", (await db.agreement.count({ where: { partyId: combinedId } })) === 1 && (await getPage("/agreements", MG)).html.includes("Combined Tenant") && (await getPage(`/agreements/${combinedAg?.id}`, MG)).html.includes("RA-WF-1"));
  check("the Rental agreement tab shows the linked agreement", (await getPage(`/accounts/${combinedId}?tab=agreement`, MG)).html.includes("RA-WF-1"));
  const dl = await fetch(`${BASE}/api/documents/${idDoc.id}`, { headers: { cookie: MG } });
  check(
    "an authorised download returns the file privately (no caching, no sniffing)",
    dl.status === 200 && dl.headers.get("content-type") === "application/pdf" && (dl.headers.get("cache-control") ?? "").includes("no-store") && dl.headers.get("x-content-type-options") === "nosniff",
  );
  check("operations cannot download an account's ID document (404)", (await fetch(`${BASE}/api/documents/${idDoc.id}`, { headers: { cookie: ops } })).status === 404);
  check("downloads need a session", (await fetch(`${BASE}/api/documents/${idDoc.id}`)).status === 401);
  const orphanDoc = (await (await upload(MG, "AGREEMENT", "SIGNED_AGREEMENT", PDF_BYTES, "never-linked.pdf")).json()) as { id: string };
  const takenUnit = await submit("/accounts/new", MG, 'name="displayName"', { displayName: "Second Tenant", phone: "", email: "", idNumber: "", notes: "", accountType: "TENANT", unitId: w2.id, startDate: start, endDate: "", rentAmount: "1000", dueDay: "", graceDays: "", reference: "", lateFeeTerms: "", allocationTerms: "", agreementNotes: "", agreementDocumentIds: [orphanDoc.id] }, addPage.html);
  check("a unit already let is refused and no account is left behind", takenUnit.html.includes("already has an agreement") && (await db.party.count({ where: { displayName: "Second Tenant" } })) === 0);
  check("the refused save leaves its uploaded document unlinked", (await db.document.findUniqueOrThrow({ where: { id: orphanDoc.id } })).ownerId === null);
  check("the entered details are kept after a refused save", takenUnit.html.includes('value="Second Tenant"'));
  const navHtml = (await getPage("/", MG)).html;
  check("the Tenants group holds Accounts only (no Agreements entry); agreements still open", /aria-controls="nav-tenants"[\s\S]*?href="\/accounts"[\s\S]*?>Accounts<\/span>/.test(navHtml) && !/href="\/agreements"/.test(sidebarOf(navHtml)) && (await getPage("/agreements", MG)).status === 200);
  const agNav = sidebarOf((await getPage("/agreements", MG)).html);
  check("an agreement page highlights Accounts in the sidebar", /<a\b[^>]*aria-current="page"[^>]*href="\/accounts"|<a\b[^>]*href="\/accounts"[^>]*aria-current="page"/.test(agNav));

  // ---------------------------------------------------------------- authentication and sessions
  const loginPage = await fetch(`${BASE}/login`);
  check(
    "security headers are sent (no framing, no sniffing, referrer policy)",
    loginPage.headers.get("x-frame-options") === "DENY" && loginPage.headers.get("x-content-type-options") === "nosniff" && !!loginPage.headers.get("referrer-policy") && !loginPage.headers.get("x-powered-by"),
  );
  const unknown = await login("nobody@workflow.test", PASSWORD);
  check("an unknown e-mail gets the same generic error as a wrong password", !unknown.cookie && unknown.html.includes("Incorrect e-mail or password"));
  const empty = await submit("/login", "", 'name="email"', { email: "", password: "" });
  check("empty sign-in fields are refused on the server", !/bakaal_session=/.test(empty.setCookie) && empty.html.includes("Enter your e-mail and password"));
  const injected = await login("' OR 1=1 --", "' OR 1=1 --");
  check("SQL-like input is treated as plain text", !injected.cookie && injected.html.includes("Incorrect e-mail or password"));
  const fresh = await login("finance@workflow.test");
  check(
    "the session cookie is HttpOnly, SameSite=Lax, Secure in production and stores no password",
    /HttpOnly/i.test(fresh.setCookie) && /SameSite=Lax/i.test(fresh.setCookie) && /Secure/i.test(fresh.setCookie) && !fresh.setCookie.includes(PASSWORD),
  );
  const tokenRow = await db.session.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
  check("the database stores only a hash of the session token", !fresh.cookie.includes(tokenRow.tokenHash));
  check("a malformed session cookie is treated as signed out", (await getPage("/units", "bakaal_session=%%%; x=1")).location.includes("/login"));

  await db.user.create({ data: { email: "lockme@workflow.test", name: "Lock tester", role: "AUDITOR", passwordHash } });
  for (let i = 0; i < 5; i++) await login("lockme@workflow.test", "wrong-password-123");
  const locked = await login("lockme@workflow.test");
  check("after 5 failed sign-ins the account is locked, even for the right password", !locked.cookie && locked.html.includes("temporarily locked"));

  const finSession = await db.session.findFirstOrThrow({ where: { revokedAt: null, user: { email: "finance@workflow.test" } }, orderBy: { createdAt: "desc" } });
  await db.session.update({ where: { id: finSession.id }, data: { lastSeenAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });
  check("an idle session (over 60 minutes) is refused", (await getPage("/units", fresh.cookie)).location.includes("/login"));
  check("the idle session is revoked in the database", (await db.session.findUniqueOrThrow({ where: { id: finSession.id } })).revokedAt !== null);
  const fresh2 = await login("finance@workflow.test");
  await db.session.updateMany({ where: { revokedAt: null, user: { email: "finance@workflow.test" } }, data: { expiresAt: new Date(Date.now() - 1000) } });
  check("an expired session is refused", (await getPage("/units", fresh2.cookie)).location.includes("/login"));

  const roleTest = await login("operations@workflow.test");
  check("operations cannot open accounts", (await getPage("/accounts", roleTest.cookie)).location.includes("/no-access"));
  await db.user.update({ where: { email: "operations@workflow.test" }, data: { role: "MANAGER" } });
  check("a role change applies to the existing session at once", (await getPage("/accounts", roleTest.cookie)).status === 200);
  await db.user.update({ where: { email: "operations@workflow.test" }, data: { isActive: false } });
  check("deactivating a user ends their session immediately", (await getPage("/accounts", roleTest.cookie)).location.includes("/login"));
  await db.user.update({ where: { email: "operations@workflow.test" }, data: { role: "OPERATIONS", isActive: true } });
  const anonExport = await fetch(`${BASE}/reports/export/arrears`, { redirect: "manual" });
  check("a direct request to a data export without a session is refused", anonExport.status === 401 || (anonExport.status >= 300 && anonExport.status < 400));

  // Maintenance: a work order linked to its unit, assigned, quoted, approved and completed through the real forms.
  const woCreated = await submit("/maintenance/new", MG, 'name="title"', { title: "Leaking kitchen tap", description: "Reported by tenant", unitId, location: "", priority: "HIGH", reportedVia: "Phone" });
  const woPath = woCreated.location.replace(BASE, "");
  const wo = await db.workOrder.findFirstOrThrow({ where: { title: "Leaking kitchen tap" } });
  const woPage = (await getPage(woPath, MG)).html;
  check("a work order is created for the chosen unit and its page links to the unit", woCreated.status === 303 && wo.unitId === unitId && woPage.includes(`href="/units/${unitId}"`));
  const assigned = await submit(woPath, MG, 'name="status"', { status: "ASSIGNED", assignee: "Workflow Plumber", quoteAmount: "1,500", outcome: "", costTreatment: "" }, woPage);
  check("it is assigned with a quote", assigned.html.includes("Work order updated") && (await db.workOrder.findUniqueOrThrow({ where: { id: wo.id } })).status === "ASSIGNED");
  const quotePage = (await getPage(woPath, MG)).html;
  const quoteApproval = approvalForm(quotePage);
  check("the quote is approved with one popup (Approve maintenance request? / Confirm Approval), nothing to type", quoteApproval.oneStep && quoteApproval.form.includes("Approve maintenance request?") && quoteApproval.form.includes("Are you sure you want to approve this maintenance request?"));
  const woList = (await getPage("/maintenance", MG)).html;
  check("the maintenance list offers Approve quote (one popup) and Reject quote in the work order's menu", approvalForm(woList, 'name="returnTo" value="/maintenance"').oneStep && woList.includes(">Approve quote<") && woList.includes(`href="${woPath}#quote"`));
  const opsQuote = await submit(woPath, ops, 'name="approve"', {}, quotePage);
  check("operations staff cannot approve the quote by posting the form", opsQuote.status !== 303 && (await db.workOrder.findUniqueOrThrow({ where: { id: wo.id } })).quoteApproved === null);
  const mgQuote = await submit(woPath, MG, 'name="approve"', {}, quotePage);
  const woAfter = await db.workOrder.findUniqueOrThrow({ where: { id: wo.id } });
  check(
    "the manager approves the quote; the work order stays assigned (not completed) and the page shows the success message",
    mgQuote.status === 303 && mgQuote.location.endsWith(`${woPath}?approved=1`) && woAfter.quoteApproved === true && woAfter.status === "ASSIGNED" && woAfter.closedAt === null &&
      (await getPage(`${woPath}?approved=1`, MG)).html.includes("Maintenance request approved successfully."),
  );
  const skipped = await submit(woPath, MG, 'name="status"', { status: "COMPLETED", assignee: "Workflow Plumber", quoteAmount: "1,500", outcome: "Replaced", costTreatment: "" });
  check("an invalid status jump (assigned → completed) is refused", skipped.html.includes("cannot move from ASSIGNED to COMPLETED") && (await db.workOrder.findUniqueOrThrow({ where: { id: wo.id } })).status === "ASSIGNED");
  await submit(woPath, MG, 'name="status"', { status: "IN_PROGRESS", assignee: "Workflow Plumber", quoteAmount: "1,500", outcome: "", costTreatment: "" });
  await submit(woPath, MG, 'name="status"', { status: "COMPLETED", assignee: "Workflow Plumber", quoteAmount: "1,500", outcome: "Replaced the tap", costTreatment: "Building expense" });
  check(
    "it is completed, audited, and listed on its unit's page",
    (await db.workOrder.findUniqueOrThrow({ where: { id: wo.id } })).status === "COMPLETED" && (await db.auditEvent.count({ where: { entityId: wo.id } })) >= 4 && (await getPage(`/units/${unitId}`, MG)).html.includes(`href="/maintenance/${wo.id}"`),
  );

  // Navigation and the unified lists.
  const adminNav = (await getPage("/", admin)).html;
  // The edit form shows what the unit's agreements say (rent, occupancy, charges) without saving them.
  const letUnit = await db.unit.findFirstOrThrow({ where: { agreements: { some: { type: "RENTAL", status: "ACTIVE", rentAmount: { not: null }, startDate: { lte: new Date() }, endDate: null } } }, include: { agreements: { where: { type: "RENTAL", status: "ACTIVE", endDate: null }, include: { party: true } } } });
  const letPage = (await getPage(`/units/${letUnit.id}`, admin)).html;
  const typeSelect = letPage.match(/<select[^>]*name="unitType"[^>]*>([\s\S]*?)<\/select>/)?.[1] ?? "";
  const selectedType = [...typeSelect.matchAll(/<option([^>]*)>([^<]*)/g)].find((o) => /selected/.test(o[1]))?.[2] ?? "Select unit type";
  check(
    "Edit Unit has no rent row, shows Occupied ticked (read-only) for a let unit, and selects the saved unit type",
    !letPage.includes("Rent Amount") && /<input type="checkbox"(?=[^>]*checked="")(?=[^>]*disabled="")[^>]*>/.test(letPage) && selectedType === (letUnit.unitType ?? "Select unit type"),
    `selected "${selectedType}", saved "${letUnit.unitType}"`,
  );
  const mainNav = adminNav.match(/<nav aria-label="Main"[\s\S]*?<\/nav>/)?.[0] ?? "";
  const topLevel = [...mainNav.matchAll(/<li><(?:a|button)[^>]*>(?:(?!<\/(?:a|button)>)[\s\S])*?<span class="[^"]*">([^<]+)<\/span>/g)].map((x) => x[1]);
  check("the sidebar has exactly seven main entries, in order", JSON.stringify(topLevel) === JSON.stringify(["Dashboard", "Financials", "Tenants", "Property/Unit", "Reports", "Communication", "Settings"]), topLevel.join(", "));
  const groupOf = (key: string) => [...(mainNav.match(new RegExp(`<ul id="nav-${key}"[\\s\\S]*?</ul>`))?.[0] ?? "").matchAll(/href="([^"]+)"/g)].map((x) => x[1]);
  const wantGroups: Record<string, string[]> = {
    financials: ["/invoices", "/expenses"],
    tenants: ["/accounts"],
    property: ["/units", "/maintenance", "/staff"],
    reports: ["/reports", "/documents"],
    communication: ["/notices"],
    settings: ["/settings", "/settings/users", "/audit"],
  };
  for (const [key, hrefs] of Object.entries(wantGroups)) check(`the ${key} group holds its existing pages`, JSON.stringify(groupOf(key)) === JSON.stringify(hrefs), groupOf(key).join(", "));
  // The sidebar's current page(s), whatever the attribute order.
  const currentOf = (nav: string) => [...nav.matchAll(/<a\b[^>]*aria-current="page"[^>]*>/g)].map((x) => x[0].match(/href="([^"]+)"/)?.[1]);
  const allHrefs = [...mainNav.matchAll(/href="([^"]+)"/g)].map((x) => x[1]);
  check("no page appears twice in the sidebar", new Set(allHrefs).size === allHrefs.length, allHrefs.join(", "));
  check("on the dashboard every group is closed; Dashboard is the current page", !/<ul id="nav-[^"]+"(?![^>]*hidden)/.test(mainNav) && JSON.stringify(currentOf(mainNav)) === '["/"]', currentOf(mainNav).join(", "));
  const onSalaries = sidebarOf((await getPage("/staff/salaries", admin)).html);
  check("a salary page highlights Staff & Tasks and opens Property/Unit", /<ul id="nav-property"(?![^>]*hidden)/.test(onSalaries) && JSON.stringify(currentOf(onSalaries)) === '["/staff"]' && /<ul id="nav-financials"[^>]*hidden/.test(onSalaries), `${currentOf(onSalaries).join(", ")} ${onSalaries.match(/<ul id="nav-[a-z]+"[^>]*>/g)?.join(" ")}`);
  const accountsList = (await getPage("/accounts", admin)).html;
  check(
    "Accounts is one list with the three categories as filters, with counts",
    ["Rent-Paying Tenants", "Purchased Unit Owners", "Purchased Units Managed by BAKAAL"].every((t) => accountsList.includes(t)) && accountsList.includes('href="/accounts?type=MANAGED"') && accountsList.includes(">Status / agreement<"),
  );
  check("the Accounts page has Add account and no separate All agreements button", accountsList.includes(">Add account<") && !accountsList.includes("All agreements</a>") && !accountsList.replace(sidebarOf(accountsList), "").includes('href="/agreements"'));
  const managedOwner = await db.party.findFirstOrThrow({ where: { displayName: "Managed Owner" }, include: { agreements: { include: { unit: true } } } });
  const agreementTab = (await getPage(`/accounts/${managedOwner.id}?tab=agreement`, admin)).html;
  check("existing agreements stay reachable from their account, with their status", managedOwner.agreements.every((ag) => agreementTab.includes(`href="/agreements/${ag.id}"`)) && agreementTab.includes("Active"));
  const agPage = (await getPage(`/agreements/${managedOwner.agreements[0].id}`, admin)).html;
  check("an agreement shows its account and unit", agPage.includes(`href="/accounts/${managedOwner.id}"`) && agPage.includes(`unit ${managedOwner.agreements[0].unit.unitNumber}`));
  check("the agreements list still opens for existing links", (await getPage("/agreements", admin)).status === 200);
  const managedOnly = (await getPage("/accounts?type=MANAGED", admin)).html;
  check("choosing a category filters the same list", managedOnly.includes("Managed Owner") && !managedOnly.includes("Workflow Tenant"));
  const payList = (await getPage("/payments", admin)).html;
  check(
    "Payments lists every status with counts, and each row ends with its actions (Edit and Delete disabled, with the reason)",
    ["All payments", "Pending verification", "Verified", "Rejected", "Reversed"].every((t) => payList.includes(t)) && payList.includes('href="/payments?status=REVERSED"') &&
      payList.includes('aria-label="Actions for WF123ABC"') && payList.includes(">Edit payment<") && payList.includes("Payments are not edited") && payList.includes(">Delete payment<") && payList.includes("Payments are never deleted") &&
      payList.includes(">Allocate to invoices</span>") && [">Allocated / unallocated<", ">Invoice(s)<", ">Reference / method / notes<"].every((t) => payList.includes(t)),
  );
  // The register's outstanding balance opens Billing & Payments filtered to that account.
  const registerPage = (await getPage("/accounts", admin)).html;
  check("each account's outstanding balance in the register links to its Billing & Payments view", registerPage.includes(`href="/invoices?partyId=${partyId}"`) && registerPage.includes(">Outstanding<"));
  const filtered = (await getPage(`/invoices?partyId=${partyId}`, admin)).html;
  const filteredPays = (await getPage(`/payments?partyId=${partyId}`, admin)).html;
  check(
    "the filtered view names the account, its balance and both actions, lists only its records, and keeps the account across the tabs",
    filtered.includes(`data-account-banner="${partyId}"`) && filtered.includes(`href="/invoices/new?partyId=${partyId}"`) && filtered.includes(`href="/payments/new?partyId=${partyId}"`) &&
      filtered.includes(`href="/payments?partyId=${partyId}"`) && !filtered.includes("Managed Owner") && filteredPays.includes(`data-account-banner="${partyId}"`) && filteredPays.includes("WF123ABC"),
  );
  // One-click verification from the list (a payment recorded by the manager, verified by the administrator).
  const listPay = recordedPayment(await submit("/payments/new", MG, 'name="reference"', { partyId, method: "CASH", reference: "WF-LIST-1", amount: "50", receivedDate: todayISO(), evidenceNote: "" }));
  const pendingList = (await getPage("/payments?status=PENDING", admin)).html;
  check("a manager's payment stays pending; its row's Actions offer Verify and Reject", pendingList.includes(`href="${listPay.location}#verify"`) && pendingList.includes(`href="${listPay.location}#reject"`));
  const verifiedFromList = await submit(listPay.location, admin, "Verify and issue receipt", {});
  const listRow = await db.payment.findFirstOrThrow({ where: { reference: "WF-LIST-1" } });
  check("Verify opens the payment and verifies it: receipt issued and audited", verifiedFromList.html.includes("Payment verified") && listRow.status === "VERIFIED" && !!listRow.receiptNumber && (await db.auditEvent.count({ where: { entityId: listRow.id, action: "payment.verify" } })) === 1);
  check("Payments are protected: the database refuses deleting one", await db.payment.delete({ where: { id: listRow.id } }).then(() => false, () => true));
  const expList = (await getPage("/expenses", admin)).html;
  check("Expenses is its own section with status filters (awaiting, approved not paid, paid, rejected)", ["Awaiting approval", "Approved, not yet paid", "Paid", "Rejected"].every((t) => expList.includes(t)) && !expList.includes('aria-label="Billing and payments"'));
  // Expenses and Maintenance pages (F53): summary from the records, the listed columns and an Action menu per row.
  const costs = await db.expense.findMany({ where: { status: { in: ["APPROVED", "PAID"] } } });
  const costTotal = costs.reduce((t, e) => t + Math.round(Number(e.amount) * 100), 0);
  const fmtKes = (c: number) => `KES ${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const totalBlock = expList.match(/data-expense-total[\s\S]*?<\/details>/)?.[0] ?? "";
  check(
    "Expenses shows the Summary total of approved and paid costs, then the list with Date, Property (Unit), Category, Status, Amount and Action",
    expList.includes(">Expenses</h1>") && expList.includes("Record and manage property expenses") && expList.includes(">Record Expense<") && totalBlock.includes(fmtKes(costTotal)) &&
      [">Date<", ">Property (Unit)<", ">Category<", ">Status<", ">Amount (KES)<", ">Action<"].every((t) => expList.includes(t)) && /aria-label="Actions for EXP-/.test(expList),
    `${fmtKes(costTotal)} ${totalBlock.slice(0, 300)}`,
  );
  const woPageHtml = (await getPage("/maintenance?status=ALL", admin)).html;
  const woRows = await db.workOrder.groupBy({ by: ["status"], _count: { _all: true } });
  const woOf = (...st: string[]) => woRows.filter((r) => st.includes(r.status)).reduce((t, r) => t + r._count._all, 0);
  const metric = (label: string) => Number(woPageHtml.match(new RegExp(`data-metric="${label}"[^>]*><span[^>]*>(\\d+)<`))?.[1] ?? -1);
  check(
    "Maintenance shows Total, Open, In Progress, Completed and Cancelled counts matching the work orders, and an Action menu per row",
    woPageHtml.includes(">Maintenance</h1>") && woPageHtml.includes(">New Maintenance<") && metric("Total Requests") === woOf("OPEN", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED") &&
      metric("Open") === woOf("OPEN", "ASSIGNED") && metric("In Progress") === woOf("IN_PROGRESS") && metric("Completed") === woOf("COMPLETED") && metric("Cancelled") === woOf("CANCELLED") &&
      [">Title / Issue<", ">Assigned To<", ">Action<"].every((t) => woPageHtml.includes(t)) && /aria-label="Actions for WO-/.test(woPageHtml),
    ["Total Requests", "Open", "In Progress", "Completed", "Cancelled"].map((l) => `${l}=${metric(l)}`).join(" "),
  );

  // Actions menus on every list of saved records (F54).
  const unitsList = (await getPage("/units", admin)).html;
  const opsUnits = (await getPage("/units", ops)).html;
  check(
    "Units: each row's Actions offer View, Edit, Retire and New agreement; Delete is unavailable (units are kept); operations get View only",
    /aria-label="Actions for unit W-1"/.test(unitsList) && unitsList.includes(">Retire unit<") && unitsList.includes("Units are kept for their agreements") && /href="\/units\/[^"#]+#edit"/.test(unitsList) &&
      /aria-label="Actions for unit W-1"/.test(opsUnits) && !opsUnits.includes(">Edit unit<"),
  );
  const agList = (await getPage("/agreements", MG)).html;
  check("Agreements: View, charges, End and Cancel; terms not edited and agreements not deleted, with the reasons", agList.includes(">End agreement<") && agList.includes(">Add or end a charge<") && agList.includes("Agreement terms are fixed once saved") && /href="\/agreements\/[^"#]+#end"/.test(agList));
  await submit("/staff/tasks", MG, "Create task", { title: "Workflow menu task", staffMemberId: "", dueDate: "", notes: "" });
  const taskList = (await getPage("/staff/tasks", MG)).html;
  check("Tasks: each open task's Actions offer Mark done and Cancel task (confirmed); tasks are not deleted", taskList.includes(">Mark done<") && taskList.includes(">Cancel task<") && taskList.includes("Tasks are closed (done or cancelled), not deleted"));
  const docList = (await getPage("/documents", MG)).html;
  check("Documents: View, Download and the record they belong to; removal happens on that record", /aria-label="Actions for national-id\.pdf"/.test(docList) && docList.includes(">Download<") && docList.includes("Done on the record it belongs to"));
  const cnList = (await getPage("/invoices?view=credit-notes", admin)).html;
  check("Credit notes: View invoice and account; never edited or deleted", cnList.includes("Credit notes are fixed once recorded") && /aria-label="Actions for CN-/.test(cnList));

  // Reports module (F55): report list, filters, results, downloads and permissions.
  const reportsHome = (await getPage("/reports", admin)).html;
  check(
    "Reports lists the seven reports (Tenant Statement selected), with Filters, Submit and the more reports",
    ["Tenant Statement", "Property Statement", "Arrears Report", "Expenses Report", "Month on Month Report", "Year on Year Report", "Property Grouping Report"].every((t) => reportsHome.includes(`>${t}<`)) &&
      /aria-current="page"[^>]*>Tenant Statement</.test(reportsHome) && reportsHome.includes(">Submit<") && reportsHome.includes("Set the filters and press Submit") && reportsHome.includes('href="/documents"'),
    [">Submit<", "Set the filters", 'href="/documents"', "Tenant Statement"].map((t) => `${t}:${reportsHome.includes(t)}`).join(" ") + ` cur=${/aria-current="page"[^>]*>Tenant Statement</.test(reportsHome)}`,
  );
  const arrearsRun = (await getPage("/reports?report=arrears&run=1", admin)).html;
  check("the Arrears Report runs as at today, with its totals and invoice rows, and offers PDF and Excel", arrearsRun.includes('data-report-results="arrears"') && arrearsRun.includes(">Unpaid invoices<") && arrearsRun.includes('data-download="pdf"') && arrearsRun.includes('data-download="xlsx"'));
  const badRange = (await getPage(`/reports?report=expenses&run=1&from=${todayISO()}&to=2020-01-01`, admin)).html;
  check("an end date before the start date is refused with a clear message", badRange.includes("The start date is after the end date"));
  const pdfRes = await fetch(`${BASE}/reports/download?report=arrears&format=pdf`, { headers: { cookie: admin } });
  const pdfBytes = Buffer.from(await pdfRes.arrayBuffer());
  const xlsxRes = await fetch(`${BASE}/reports/download?report=expenses&format=xlsx&from=2020-01-01&to=${todayISO()}`, { headers: { cookie: admin } });
  const xlsxBytes = Buffer.from(await xlsxRes.arrayBuffer());
  check(
    "Download PDF and Download Excel return real files (and are audited)",
    pdfRes.status === 200 && pdfRes.headers.get("content-type") === "application/pdf" && pdfBytes.subarray(0, 5).toString() === "%PDF-" &&
      xlsxRes.status === 200 && xlsxRes.headers.get("content-type")?.includes("spreadsheetml") === true && xlsxBytes.readUInt32LE(0) === 0x04034b50 &&
      (await db.auditEvent.count({ where: { action: "report.export", entityId: { in: ["arrears", "expenses"] }, occurredAt: { gte: new Date(Date.now() - 60_000) } } })) >= 2,
  );
  const opsDownload = await fetch(`${BASE}/reports/download?report=arrears&format=pdf`, { headers: { cookie: ops }, redirect: "manual" });
  const mgrReports = (await getPage("/reports", MG)).html;
  check("roles without financial reports get no file and no financial report (only the operational ones)", opsDownload.status === 403 && !mgrReports.includes(">Arrears Report<") && mgrReports.includes('href="/reports/occupancy"'), `${opsDownload.status} ${mgrReports.includes(">Arrears Report<")} ${mgrReports.includes('href="/reports/occupancy"')} ${mgrReports.length}`);

  // Exports carry the same figures as their reports (collections: receipts and reversals, each on its date).
  const csv = await (await fetch(`${BASE}/reports/export/collections?from=2000-01-01&to=${todayISO()}`, { headers: { cookie: admin } })).text();
  const [csvHead, ...csvRows] = csv.trim().split(/\r?\n/).map((l) => l.split(","));
  const amountCol = csvHead.indexOf("Amount");
  const csvTotal = csvRows.reduce((t, r) => t + Math.round(Number(r[amountCol].replace(/"/g, "")) * 100), 0);
  const received = await db.payment.findMany({ where: { status: { in: ["VERIFIED", "REVERSED"] } } });
  const expectedNet = received.reduce((t, p) => t + Math.round(Number(p.amount) * 100) * (p.status === "REVERSED" ? 0 : 1), 0);
  check("the collections CSV adds up to verified receipts less reversals, with a reversal row", csvTotal === expectedNet && csvRows.some((r) => r.includes("Reversal")), `${csvTotal} vs ${expectedNet}`);

  // Credit notes view and the Documents index.
  const cnView = (await getPage("/invoices?view=credit-notes", admin)).html; // the finance session was ended by the sign-in checks above
  const cnRow = await db.creditNote.findFirstOrThrow();
  check(
    "the invoices list has a credit-notes view listing the existing credit notes with their invoice",
    cnView.includes(cnRow.number) && cnView.includes("Agreed correction") && cnView.includes("No money is paid out"),
    `${cnRow.number}:${cnView.includes(cnRow.number)} reason:${cnView.includes("Agreed correction")} note:${cnView.includes("No money is paid out")} len:${cnView.length}`,
  );
  check("operations cannot open the credit-notes view", (await getPage("/invoices?view=credit-notes", ops)).location.includes("/no-access"));
  const docsForManager = (await getPage("/documents", MG)).html;
  check("the Documents page lists documents with their record for a manager", docsForManager.includes("national-id.pdf") && docsForManager.includes("signed-agreement.pdf") && docsForManager.includes("Combined Tenant"));
  const docsForOps = await getPage("/documents", ops);
  check("operations can open Documents but sees no account documents", docsForOps.status === 200 && !docsForOps.html.includes("national-id.pdf") && !docsForOps.html.includes("signed-agreement.pdf"));
  check("the Documents page searches by record", (await getPage("/documents?q=combined", MG)).html.includes("national-id.pdf") && !(await getPage("/documents?q=nothing-matches-this", MG)).html.includes("national-id.pdf"));
  check("Documents opens from Reports", (await getPage("/reports", admin)).html.includes('href="/documents"'));

  // Single-operator (F49): the administrator's Create invoice issues it in one step and adds it to the balance once.
  const balanceBefore = (await db.invoice.findMany({ where: { partyId, status: "ISSUED" } })).length;
  const oneStepInvoice = await submit("/invoices/new", admin, 'name="lineDescription"', { partyId, unitId, agreementId: "", dueDate: todayISO(), notes: "", lineCategory: "OTHER", lineDescription: "One-step gate remote", lineAmount: "300" });
  const issuedNow = await db.invoice.findFirstOrThrow({ where: { lines: { some: { description: "One-step gate remote" } } } });
  check(
    "Create invoice (administrator) issues it at once: numbered, audited, no review step, counted once",
    oneStepInvoice.status === 303 && issuedNow.status === "ISSUED" && !!issuedNow.number && issuedNow.issuedById === issuedNow.createdById &&
      (await db.invoice.count({ where: { partyId, status: "ISSUED" } })) === balanceBefore + 1 && (await db.auditEvent.count({ where: { entityId: issuedNow.id, action: "invoice.issue_manual" } })) === 1,
  );
  const createForm = (await getPage(`/invoices/new?partyId=${partyId}`, admin)).html;
  check("the Create invoice form for an administrator issues on save and shows the invoice date", createForm.includes(">Create and issue invoice<") && createForm.includes("Invoice date: today"));
  check("a manager's Create invoice still saves a draft for review", (await getPage("/invoices/new", MG)).html.includes(">Save draft for review<"));
  // A draft the administrator created (e.g. before F49): issued only under the audited exception.
  const ownDraft = await submit("/invoices/new", admin, 'name="lineDescription"', { partyId, unitId, agreementId: "", dueDate: todayISO(), notes: "", lineCategory: "OTHER", lineDescription: "Replacement key", lineAmount: "750", issue: "" });
  const ownDraftPath = ownDraft.location.replace(BASE, "");
  const ownDraftPage = await getPage(ownDraftPath, admin);
  check("an administrator's own draft invoice offers the audited self-approval exception", ownDraft.status === 303 && ownDraftPage.html.includes("Issue invoice (administrator exception)"));
  const ownIssue = await submit(ownDraftPath, admin, 'name="confirmSelf"', { reason: "Reviewed against the key register and agreement", confirmSelf: "yes" }, ownDraftPage.html);
  const ownInvoice = await db.invoice.findFirstOrThrow({ where: { lines: { some: { description: "Replacement key" } } } });
  check(
    "the administrator issues it; it gets a number, is marked on the invoice and audited",
    ownIssue.html.includes("Invoice reviewed and issued") && ownInvoice.status === "ISSUED" && !!ownInvoice.number && ownInvoice.issuedById === ownInvoice.createdById &&
      (await getPage(ownDraftPath, admin)).html.includes("Drafted and issued by the same person") && (await db.auditEvent.count({ where: { entityId: ownInvoice.id, action: "invoice.issue_self_exception" } })) === 1,
  );

  const audit = await db.auditEvent.count({ where: { action: { in: ["billing.issue", "payment.verify", "payment.allocate", "credit_note.create", "expense.approve", "user.create"] }, occurredAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } } });
  check("each financial action was audited", audit >= 6, String(audit));
} catch (e) {
  failures++;
  console.log("FAIL unexpected error:", e);
} finally {
  server.kill("SIGTERM");
  await db.$disconnect();
}
if (/Unexpected action error|Error:/.test(serverLog)) console.log("Server log contained errors:\n" + serverLog.split("\n").filter((l) => /error/i.test(l)).slice(0, 10).join("\n"));
console.log(failures === 0 ? "WORKFLOW TEST PASSED" : `WORKFLOW TEST FAILED: ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);

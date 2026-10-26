// Reports module (F55): every report from real records, reconciled with the existing services,
// date-exact (as-at dates, month and year ends), permission-checked, and the PDF and Excel files
// carrying the same rows and totals as the screen.
import { beforeEach, describe, expect, it } from "vitest";
import { inflateRawSync, inflateSync } from "node:zlib";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { createAccount, createUnit } from "@/server/services/property";
import { issueBilling } from "@/server/services/billing";
import { allocatePayment, createCreditNote, recordPayment, reversePayment } from "@/server/services/finance";
import { createExpense, createWorkOrder, decideExpense } from "@/server/services/operations";
import { accountStatement, arrearsReport, collectionsReport } from "@/server/services/reports";
import { runReport, type ReportKey, type ReportParams } from "@/server/reports/catalog";
import { reportPdf } from "@/server/reports/pdf";
import { reportXlsx } from "@/server/reports/xlsx";
import type { ReportDoc } from "@/lib/report-doc";
import { addDays, addMonths, monthStart, todayISO } from "@/lib/dates";
import { sumCents } from "@/lib/money";

assertTestDatabase();

const admin = actor("ADMIN");
const manager = actor("MANAGER");
const finance = actor("FINANCE");
const today = todayISO();
const thisMonth = monthStart(today);
const m1 = addMonths(thisMonth, -2); // two months ago
const m2 = addMonths(thisMonth, -1); // last month
const docs = { account: [], agreement: [], management: [] };

beforeEach(async () => {
  await resetTestData();
  await db.building.create({ data: { name: "Report Tower" } });
});

async function setup() {
  const [u1, u2, u3] = [await createUnit(admin, { unitNumber: "R1", floor: null, unitType: null, notes: null }), await createUnit(admin, { unitNumber: "R2", floor: null, unitType: null, notes: null }), await createUnit(admin, { unitNumber: "R3", floor: null, unitType: null, notes: null })];
  const tenancy = (rent: number) => ({ startDate: m1, endDate: null, rentAmount: rent, dueDay: 5, graceDays: null, reference: null, lateFeeTerms: null, allocationTerms: null, notes: null });
  const a = await createAccount(manager, { party: { displayName: "Alpha Tenant", phone: "0700 400 001", email: null, idNumber: null, notes: null }, accountType: "TENANT", unitId: u1.id, tenancy: tenancy(1000000), documents: docs });
  const b = await createAccount(manager, { party: { displayName: "Beta Tenant", phone: "0700 400 002", email: null, idNumber: null, notes: null }, accountType: "TENANT", unitId: u2.id, tenancy: tenancy(500000), documents: docs });
  await issueBilling(finance, m1);
  await issueBilling(finance, m2);
  const inv = async (partyId: string, period: string) => db.invoice.findFirstOrThrow({ where: { partyId, periodStart: new Date(`${period}T00:00:00Z`) } });
  // Alpha: pays 6,000 on the first invoice (allocated), 2,000 unallocated, a bounced 1,000; a credit of 500 on the second.
  const p1 = await recordPayment(manager, { partyId: a.party.id, method: "MPESA", reference: "R-1", amount: 600000, receivedDate: today, evidenceNote: null }, {});
  const pv = await recordPayment(finance, { partyId: a.party.id, method: "BANK", reference: "R-2", amount: 200000, receivedDate: today, evidenceNote: null }, { verify: true });
  const bounced = await recordPayment(finance, { partyId: a.party.id, method: "BANK", reference: "R-3", amount: 100000, receivedDate: today, evidenceNote: null }, { verify: true });
  await reversePayment(finance, bounced.id, "Bounced");
  const { verifyPayment } = await import("@/server/services/finance");
  await verifyPayment(finance, p1.id);
  await allocatePayment(finance, p1.id, [{ invoiceId: (await inv(a.party.id, m1)).id, amount: 600000 }]);
  await createCreditNote(finance, (await inv(a.party.id, m2)).id, 50000, "Agreed water correction");
  // Expenses: one for unit R1 via a work order (approved), one building-wide (paid would need payment; approved), one draft, one rejected.
  const wo = await createWorkOrder(manager, { title: "Tap", description: null, unitId: u1.id, location: null, priority: "LOW", reportedVia: null });
  const ops = actor("OPERATIONS");
  const e1 = await createExpense(ops, { category: "REPAIRS", payee: "Plumber", description: "Tap", amount: 150000, servicePeriodStart: null, servicePeriodEnd: null, costCentre: null, evidenceNote: null, workOrderId: wo.id, staffMemberId: null }, true);
  const e2 = await createExpense(ops, { category: "CLEANING", payee: "Cleaner", description: "Stairs", amount: 80000, servicePeriodStart: null, servicePeriodEnd: null, costCentre: null, evidenceNote: null, workOrderId: null, staffMemberId: null }, true);
  await createExpense(ops, { category: "CLEANING", payee: "Draft", description: "Not counted", amount: 99900, servicePeriodStart: null, servicePeriodEnd: null, costCentre: null, evidenceNote: null, workOrderId: null, staffMemberId: null }, false);
  const e4 = await createExpense(ops, { category: "SECURITY", payee: "Guard", description: "Rejected", amount: 70000, servicePeriodStart: null, servicePeriodEnd: null, costCentre: null, evidenceNote: null, workOrderId: null, staffMemberId: null }, true);
  await decideExpense(finance, e1.id, "APPROVED", null);
  await decideExpense(finance, e2.id, "APPROVED", null);
  await decideExpense(finance, e4.id, "REJECTED", "No");
  return { a, b, u1, u2, u3, pv, inv };
}

/**
 * An invoice issued on a past date (billing runs issue today, even for past months). Created as a
 * draft with its line, then issued — the same states the services use — with the earlier dates.
 */
async function pastInvoice(partyId: string, unitId: string, agreementId: string, issueDate: string, dueDate: string, amount: number, number: string) {
  const building = await db.building.findFirstOrThrow();
  const d = await db.invoice.create({ data: { buildingId: building.id, partyId, unitId, agreementId, kind: "MANUAL", status: "DRAFT", total: (amount / 100).toFixed(2), dueDate: new Date(`${dueDate}T00:00:00Z`), createdById: finance.id, lines: { create: [{ category: "OTHER", description: "Past charge", amount: (amount / 100).toFixed(2), sourceType: "MANUAL" }] } } });
  return db.invoice.update({ where: { id: d.id }, data: { status: "ISSUED", number, issueDate: new Date(`${issueDate}T00:00:00Z`), issuedById: finance.id, issuedAt: new Date(`${issueDate}T09:00:00Z`) } });
}

const doc = async (key: ReportKey, p: ReportParams, who = finance) => {
  const r = await runReport(who, key, p);
  if (!("doc" in r)) throw new Error(JSON.stringify(r));
  return r.doc;
};
const section = (d: ReportDoc, title: string) => d.sections.find((s) => s.title.startsWith(title))!;
const summary = (d: ReportDoc, label: string) => d.summary.find((s) => s.label.startsWith(label))!.value;

describe("Tenant Statement", () => {
  it("runs from the opening balance to the closing balance, the same as the account statement, with unallocated money apart", async () => {
    const { a } = await setup();
    const from = m2;
    const d = await doc("tenant", { partyId: a.party.id, from, to: today });
    const st = await accountStatement(finance, a.party.id, from, today);
    expect([summary(d, "Opening balance"), summary(d, "Closing balance")]).toEqual([st.opening, st.closing]);
    expect(st.opening + st.charges - st.payments - st.credits + st.reversals).toBe(st.closing);
    const rows = section(d, "Statement").rows;
    expect(rows.at(-1)!.balance).toBe(st.closing);
    // Closing = outstanding on invoices − unallocated payments.
    expect(summary(d, "Closing balance")).toBe((summary(d, "Outstanding on invoices") as number) - (summary(d, "Unallocated payments") as number));
    expect(summary(d, "Unallocated payments")).toBe(200000);
    const pays = section(d, "Payments received").rows;
    expect(pays.find((p) => String(p.reference).startsWith("R-2"))).toMatchObject({ allocated: 0, unallocated: 200000 });
    expect(pays.find((p) => String(p.reference).startsWith("R-3"))!.status).toMatch(/^Reversed/);
  });

  it("asks for an account, and rejects an end date before the start", async () => {
    await setup();
    expect(await runReport(finance, "tenant", {})).toEqual({ needs: expect.stringMatching(/Choose a tenant/) });
    const p = (await db.party.findFirstOrThrow()).id;
    expect(await runReport(finance, "tenant", { partyId: p, from: today, to: m1 })).toEqual({ error: expect.stringMatching(/start date is after the end date/) });
  });
});

describe("Arrears Report", () => {
  it("matches the arrears report today invoice by invoice, and uses the chosen as-at date for balances and days overdue", async () => {
    const { a, inv } = await setup();
    const now = await doc("arrears", {});
    const old = await arrearsReport(finance);
    expect(summary(now, "Outstanding")).toBe(old.grandTotal);
    expect(section(now, "Unpaid invoices").rows.map((r) => [r.number, r.balance]).sort()).toEqual(old.invoices.map((i) => [i.number, i.balance]).sort());
    // An invoice issued in the past, paid today: unpaid as at yesterday, paid as at today.
    const past = await pastInvoice(a.party.id, a.agreement.unitId, a.agreement.id, m1, addDays(m1, 9), 300000, "INV-PAST-0001");
    const pay = await recordPayment(finance, { partyId: a.party.id, method: "CASH", reference: "R-PAST", amount: 300000, receivedDate: today, evidenceNote: null }, { verify: true, allocations: [{ invoiceId: past.id, amount: 100000 }] });
    expect(pay.status).toBe("VERIFIED");
    const row = async (asOf: string) => section(await doc("arrears", { asOf, partyId: a.party.id }), "Unpaid invoices").rows.find((r) => r.number === "INV-PAST-0001");
    expect([(await row(addDays(today, -1)))!.paid, (await row(addDays(today, -1)))!.balance]).toEqual([0, 300000]);
    expect([(await row(today))!.paid, (await row(today))!.balance]).toEqual([100000, 200000]);
    // Days overdue at the boundary: on the due date 0 (not yet due), the next day 1; before issue it is not listed.
    const due = addDays(m1, 9);
    expect([(await row(due))!.days, (await row(due))!.status, (await row(addDays(due, 1)))!.days]).toEqual([0, "Not yet due", 1]);
    expect(await row(addDays(m1, -1))).toBeUndefined();
    void inv;
    // Before anything was issued there is nothing in arrears.
    expect(section(await doc("arrears", { asOf: addDays(m1, -40) }), "Unpaid invoices").rows).toEqual([]);
    // As at today it still matches the arrears report after the extra invoice and payment.
    expect(summary(await doc("arrears", {}), "Outstanding")).toBe((await arrearsReport(finance)).grandTotal);
  });
});

describe("Expenses Report", () => {
  it("counts only approved and paid costs by default, by category and unit; other statuses only when chosen", async () => {
    const { u1 } = await setup();
    const d = await doc("expenses", { from: thisMonth, to: today });
    expect(section(d, "Expenses").rows.map((r) => r.amount as number).sort((x, y) => x - y)).toEqual([80000, 150000]);
    expect(summary(d, "Costs")).toBe(230000);
    expect(section(d, "By category").rows).toEqual(expect.arrayContaining([{ k: "Cleaning", count: 1, total: 80000 }, { k: "Repairs", count: 1, total: 150000 }]));
    expect(section(d, "By property").rows).toEqual(expect.arrayContaining([{ k: "R1", count: 1, total: 150000 }, { k: "Building", count: 1, total: 80000 }]));
    expect(section(await doc("expenses", { from: thisMonth, to: today, unitId: u1.id }), "Expenses").rows.map((r) => r.amount)).toEqual([150000]);
    expect(section(await doc("expenses", { from: thisMonth, to: today, status: "ALL" }), "Expenses").rows).toHaveLength(4);
    expect(section(await doc("expenses", { from: thisMonth, to: today, status: "REJECTED" }), "Expenses").rows.map((r) => r.amount)).toEqual([70000]);
  });
});

describe("Month on Month and Year on Year", () => {
  it("bills each invoice in its billing month and reports received money exactly as the collections report", async () => {
    await setup();
    const year = Number(today.slice(0, 4));
    const d = await doc("month", { year: String(year) });
    const rows = section(d, "Months").rows;
    const row = (month: string) => rows[Number(month.slice(5, 7)) - 1];
    if (m1.slice(0, 4) === String(year)) expect(row(m1).billed).toBe(1500000);
    const col = await collectionsReport(finance, thisMonth, today);
    expect(row(thisMonth).received).toBe(col.total); // receipts less the reversal, as the collections report
    expect(rows.length).toBe(Number(today.slice(5, 7))); // no future months
    expect(section(d, "Months").totals!.billed).toBe(sumCents(rows.map((r) => r.billed as number)));
  });

  it("labels the year in progress, compares the same span last year, and shows N/A against a zero base", async () => {
    await setup();
    const year = Number(today.slice(0, 4));
    const d = await doc("year", { year: String(year), years: "2" });
    const years = section(d, "Calendar years").rows;
    expect(years.at(-1)!.year).toMatch(new RegExp(`^${year} \\(to `));
    expect(years.at(-1)!.billedPct).toBeNull(); // nothing billed the year before: N/A, not Infinity
    expect(section(d, "Same period compared").rows.find((r) => r.measure === "Billed")!.before).toBe(0);
  });
});

describe("Property Statement and Grouping", () => {
  it("groups by unit with the occupancy rules, and a unit's statement agrees with its invoices", async () => {
    const { u1, u3 } = await setup();
    const g = await doc("grouping", { from: m1, to: today });
    const units = section(g, "Units").rows;
    expect(units.map((u) => [u.unit, u.status])).toEqual([["R1", "Occupied"], ["R2", "Occupied"], ["R3", "Vacant"]]);
    expect(section(g, "Property").rows[0]).toMatchObject({ units: 3, occupied: 2, vacant: 1, billed: 3000000 });
    expect(section(g, "Units").totals!.outstanding).toBe(summary(await doc("arrears", {}), "Outstanding"));
    const ps = await doc("property", { unitId: u1.id, from: m1, to: today });
    expect(summary(ps, "Billed")).toBe(2000000);
    expect(summary(ps, "Payments applied")).toBe(600000);
    expect(summary(ps, "Credits")).toBe(50000);
    expect(summary(ps, "Outstanding at the end")).toBe(2000000 - 600000 - 50000);
    expect(summary(ps, "Expenses recorded")).toBe(150000);
    expect(section(await doc("property", { unitId: u3.id, from: m1, to: today }), "Agreements").rows).toEqual([]);
  });
});

describe("permissions and files", () => {
  it("refuses roles without financial reports, and the PDF and Excel carry the same rows and totals as the screen", async () => {
    const { a } = await setup();
    await expect(runReport(actor("OPERATIONS"), "arrears", {})).rejects.toThrow(/permission/);
    await expect(runReport(manager, "tenant", { partyId: a.party.id })).rejects.toThrow(/permission/);
    const d = await doc("arrears", {});
    // PDF: a valid file whose text includes each invoice and the total.
    const pdf = reportPdf(d);
    expect(pdf.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
    const text = [...pdf.toString("latin1").matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((m) => inflateSync(Buffer.from(m[1], "latin1")).toString("latin1")).join("\n");
    const decoded = [...text.matchAll(/<([0-9a-f]+)> Tj/g)].map((m) => Buffer.from(m[1], "hex").toString("latin1")).join("|");
    for (const r of section(d, "Unpaid invoices").rows) expect(decoded).toContain(String(r.number));
    expect(decoded).toContain(`KES ${((summary(d, "Outstanding") as number) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    expect(decoded).toMatch(/Page 1 of \d+/);
    // Excel: the sheet holds the same remaining amounts as numbers, and text never as a formula.
    const xlsx = reportXlsx(d);
    const sheet = unzipEntry(xlsx, "xl/worksheets/sheet1.xml");
    const balances = section(d, "Unpaid invoices").rows.map((r) => ((r.balance as number) / 100).toFixed(2));
    for (const b of balances) expect(sheet).toContain(`<v>${b}</v>`);
    expect(sheet).not.toContain("<f>");
  });
});

/** Reads one file out of a ZIP (the .xlsx container). */
function unzipEntry(zip: Buffer, name: string): string {
  let i = 0;
  while (zip.readUInt32LE(i) === 0x04034b50) {
    const size = zip.readUInt32LE(i + 18);
    const nameLen = zip.readUInt16LE(i + 26);
    const extra = zip.readUInt16LE(i + 28);
    const n = zip.subarray(i + 30, i + 30 + nameLen).toString("utf8");
    const data = zip.subarray(i + 30 + nameLen + extra, i + 30 + nameLen + extra + size);
    if (n === name) return inflateRawSync(data).toString("utf8");
    i += 30 + nameLen + extra + size;
  }
  throw new Error(`${name} not found`);
}


// Expenses and Maintenance pages (F53): deleting a draft expense, and the work-order summary counts.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { createExpense, createWorkOrder, decideExpense, deleteDraftExpense, listExpenses, listWorkOrders, updateWorkOrder, workOrderCounts } from "@/server/services/operations";
import { createUnit } from "@/server/services/property";

assertTestDatabase();

const admin = actor("ADMIN");
const manager = actor("MANAGER");
const finance = actor("FINANCE");
const operations = actor("OPERATIONS");
const expense = (description: string) => ({ category: "CLEANING" as const, payee: "Cleaner", description, amount: 250000, servicePeriodStart: null, servicePeriodEnd: null, costCentre: null, evidenceNote: null, workOrderId: null, staffMemberId: null });

beforeEach(async () => {
  await resetTestData();
  await db.building.create({ data: { name: "Ops Building" } });
});

describe("deleting a draft expense", () => {
  it("lets its creator or an approver delete a draft (audited), and keeps anything submitted", async () => {
    const own = await createExpense(operations, expense("Own draft"), false);
    const other = await createExpense(operations, expense("Someone's draft"), false);
    const submitted = await createExpense(operations, expense("Submitted"), true);
    await expect(deleteDraftExpense(manager, own.id)).rejects.toThrow(/Only the person who created/); // a manager may submit but not approve
    await deleteDraftExpense(operations, own.id);
    await deleteDraftExpense(finance, other.id); // an approver may tidy up drafts
    await expect(deleteDraftExpense(operations, submitted.id)).rejects.toThrow(/kept for the record/);
    await decideExpense(finance, submitted.id, "REJECTED", "Duplicate");
    await expect(deleteDraftExpense(finance, submitted.id)).rejects.toThrow(/kept for the record/);
    expect((await db.expense.findMany()).map((e) => e.description)).toEqual(["Submitted"]);
    // The audit log is append-only (never reset between tests): count this test's two deletions only.
    expect(await db.auditEvent.count({ where: { action: "expense.draft_delete", entityId: { in: [own.id, other.id] } } })).toBe(2);
    await expect(deleteDraftExpense(actor("AUDITOR"), submitted.id)).rejects.toThrow(/permission/);
  });

  it("lists each expense with the unit of its linked work order", async () => {
    const unit = await createUnit(admin, { unitNumber: "E1", floor: null, unitType: null, notes: null });
    const w = await createWorkOrder(manager, { title: "Tap", description: null, unitId: unit.id, location: null, priority: "LOW", reportedVia: null });
    await createExpense(operations, { ...expense("Tap repair"), category: "REPAIRS", workOrderId: w.id }, true);
    const [row] = await listExpenses(finance);
    expect(row.workOrder).toMatchObject({ id: w.id, unit: { unitNumber: "E1" } });
  });
});

describe("maintenance summary", () => {
  it("counts every work order once by status, whatever the list shows, and completing one changes no money", async () => {
    const unit = await createUnit(admin, { unitNumber: "W1", floor: null, unitType: null, notes: null });
    const make = (title: string) => createWorkOrder(manager, { title, description: null, unitId: unit.id, location: null, priority: "MEDIUM", reportedVia: null });
    const [a, b, c, d, e] = [await make("A"), await make("B"), await make("C"), await make("D"), await make("E")];
    const step = (id: string, status: "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED", more: { outcome?: string; costTreatment?: string } = {}) =>
      updateWorkOrder(manager, id, { status, assignee: "Plumber", quoteAmount: null, outcome: more.outcome ?? null, costTreatment: more.costTreatment ?? null });
    await step(b.id, "ASSIGNED");
    await step(c.id, "IN_PROGRESS");
    await step(d.id, "IN_PROGRESS");
    await step(d.id, "COMPLETED", { outcome: "Fixed", costTreatment: "No cost" });
    await step(e.id, "CANCELLED");
    expect(await workOrderCounts(operations)).toEqual({ total: 5, open: 1, assigned: 1, inProgress: 1, completed: 1, cancelled: 1 });
    expect((await listWorkOrders(operations, "NOT_STARTED")).map((w) => w.id).sort()).toEqual([a.id, b.id].sort());
    expect((await listWorkOrders(operations, "ALL")).length).toBe(5); // closed ones stay in the history
    expect([await db.expense.count(), await db.payment.count(), await db.invoice.count()]).toEqual([0, 0, 0]);
    await expect(workOrderCounts(actor("AUDITOR"))).resolves.toMatchObject({ total: 5 }); // read-only roles see maintenance
  });
});

import { describe, expect, it } from "vitest";
import { APPROVALS, APPROVE_LABEL, approvedReturn, currentListPath } from "./approval";

describe("approval confirmation", () => {
  it("uses the agreed wording for each module", () => {
    expect(APPROVE_LABEL).toBe("Confirm Approval");
    expect(APPROVALS.maintenance).toEqual({ title: "Approve maintenance request?", message: "Are you sure you want to approve this maintenance request?", success: "Maintenance request approved successfully." });
    expect(APPROVALS.expense).toEqual({ title: "Approve expense?", message: "Are you sure you want to approve this expense?", success: "Expense approved successfully." });
    expect(APPROVALS.salary).toEqual({ title: "Approve salary payment?", message: "Are you sure you want to approve this salary payment?", success: "Salary payment approved successfully." });
  });

  it("returns to the page the approval came from, keeping its filters", () => {
    expect(approvedReturn("/expenses?status=SUBMITTED&page=2", "/expenses")).toBe("/expenses?status=SUBMITTED&page=2&approved=1");
    expect(approvedReturn("/expenses/abc", "/expenses")).toBe("/expenses/abc?approved=1");
    expect(approvedReturn("/expenses?approved=1", "/expenses")).toBe("/expenses?approved=1");
  });

  it("never leaves the module or the site", () => {
    for (const bad of ["https://evil.example/expenses", "//evil.example/expenses", "/\\evil.example", "/invoices", "/expenses-other", null, undefined, ""]) {
      expect(approvedReturn(bad, "/expenses")).toBe("/expenses?approved=1");
    }
  });

  it("builds the list's own address for the return, without earlier result flags", () => {
    expect(currentListPath("/expenses", { status: "SUBMITTED", page: "2", approved: "1", deleted: "1", empty: "" })).toBe("/expenses?status=SUBMITTED&page=2");
    expect(currentListPath("/maintenance", {})).toBe("/maintenance");
  });
});

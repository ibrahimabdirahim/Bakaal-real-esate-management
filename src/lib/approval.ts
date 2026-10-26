// The one approval confirmation (F61), shared by Maintenance, Expenses and Salary payments: one popup
// (Cancel / Confirm Approval), nothing to type, and a success message on the page it returns to.
export const APPROVE_LABEL = "Confirm Approval";

export const APPROVALS = {
  maintenance: {
    title: "Approve maintenance request?",
    message: "Are you sure you want to approve this maintenance request?",
    success: "Maintenance request approved successfully.",
  },
  expense: {
    title: "Approve expense?",
    message: "Are you sure you want to approve this expense?",
    success: "Expense approved successfully.",
  },
  salary: {
    title: "Approve salary payment?",
    message: "Are you sure you want to approve this salary payment?",
    success: "Salary payment approved successfully.",
  },
} as const;

export type ApprovalKind = keyof typeof APPROVALS;

/**
 * Where to go after an approval: the page it was made from (`returnTo`, with its filters) when that is
 * a path under `base`, otherwise `base`; with `approved=1` added so the page shows the success message.
 */
export function approvedReturn(returnTo: unknown, base: string): string {
  const path = typeof returnTo === "string" && returnTo.startsWith(base) && !/[\\]|^\/\//.test(returnTo) ? returnTo : base;
  const url = new URL(path, "http://local");
  const rest = url.pathname.slice(base.length);
  if (url.origin !== "http://local" || (rest !== "" && !rest.startsWith("/"))) return `${base}?approved=1`;
  url.searchParams.set("approved", "1");
  return `${url.pathname}${url.search}`;
}

/** The list page as it is now (filters and page kept, earlier result flags dropped), for `returnTo`. */
export function currentListPath(base: string, sp: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v !== "" && k !== "approved" && k !== "deleted") q.set(k, v);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

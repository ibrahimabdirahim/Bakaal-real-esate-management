// Role → permission bundles, based on the five roles in the approved prototype.
// The final role matrix is unresolved (DECISIONS.md C17); this is the provisional
// default, kept in one place so it can be changed without touching feature code.

export const ROLES = ["ADMIN", "MANAGER", "FINANCE", "OPERATIONS", "AUDITOR"] as const;
export type RoleName = (typeof ROLES)[number];

export const ROLE_LABELS: Record<RoleName, string> = {
  ADMIN: "System administrator",
  MANAGER: "Building manager",
  FINANCE: "Finance officer",
  OPERATIONS: "Operations staff",
  AUDITOR: "Read-only auditor",
};

export const PERMISSIONS = [
  "dashboard.view",
  "units.view",
  "units.manage",
  "accounts.view",
  "accounts.manage",
  "accounts.view_sensitive",
  "accounts.delete", // permanent deletion of never-used accounts: administrators only
  "agreements.view",
  "agreements.manage",
  "billing.preview",
  "billing.issue",
  "invoices.view",
  "invoices.create_manual",
  "invoices.issue_manual",
  "credits.create",
  "payments.view",
  "payments.record",
  "payments.verify",
  "payments.allocate",
  "payments.reverse",
  "expenses.view",
  "expenses.submit",
  "expenses.approve",
  "expenses.pay",
  "staff.view",
  "staff.manage",
  "salary.view",
  "salary.manage",
  "tasks.manage",
  "workorders.view",
  "workorders.manage",
  "workorders.approve_quote",
  "reports.operational",
  "reports.financial",
  "notices.view",
  "settings.view",
  "settings.manage",
  "policies.approve",
  "users.manage",
  "audit.view",
  // Completing one's own payment, expense or manual invoice under the audited exception
  // (see services/self-approval.ts). Administrators only, through ALL below.
  "approvals.self_exception",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS];

const READ_ONLY: Permission[] = [
  "dashboard.view", "units.view", "accounts.view", "agreements.view", "invoices.view", "payments.view",
  "expenses.view", "staff.view", "workorders.view", "reports.operational", "reports.financial", "notices.view", "settings.view",
];

export const ROLE_PERMISSIONS: Record<RoleName, readonly Permission[]> = {
  ADMIN: ALL,
  MANAGER: [
    "dashboard.view", "units.view", "units.manage", "accounts.view", "accounts.manage", "accounts.view_sensitive",
    "agreements.view", "agreements.manage", "billing.preview", "invoices.view", "invoices.create_manual",
    "payments.view", "payments.record", "expenses.view", "expenses.submit", "staff.view", "staff.manage", "tasks.manage",
    "workorders.view", "workorders.manage", "workorders.approve_quote", "reports.operational", "notices.view", "settings.view",
  ],
  FINANCE: [
    "dashboard.view", "units.view", "accounts.view", "accounts.view_sensitive", "agreements.view",
    "billing.preview", "billing.issue", "invoices.view", "invoices.create_manual", "invoices.issue_manual", "credits.create",
    "payments.view", "payments.record", "payments.verify", "payments.allocate", "payments.reverse",
    "expenses.view", "expenses.submit", "expenses.approve", "expenses.pay", "staff.view", "salary.view", "salary.manage",
    "workorders.view", "reports.operational", "reports.financial", "notices.view", "settings.view",
  ],
  OPERATIONS: ["dashboard.view", "units.view", "expenses.view", "expenses.submit", "staff.view", "tasks.manage", "workorders.view", "workorders.manage"],
  AUDITOR: [...READ_ONLY, "audit.view"],
};

export function can(role: RoleName, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

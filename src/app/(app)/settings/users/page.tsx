import { requirePage } from "@/server/auth/session";
import { listUsers } from "@/server/services/admin";
import { ROLE_LABELS, ROLE_PERMISSIONS, ROLES, type Permission } from "@/server/auth/permissions";
import { Check, Minus } from "lucide-react";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ActionForm, Select, SubmitButton, TextInput } from "@/components/forms";
import { formatDateTime } from "@/lib/dates";
import { createUserAction, resetPasswordAction, updateUserAction } from "../actions";
import { ShieldCheck } from "lucide-react";

export const metadata = { title: "Staff accounts" };

const PERMISSION_GROUPS: { title: string; items: [Permission, string][] }[] = [
  { title: "Property", items: [["units.view", "View units"], ["units.manage", "Add and edit units"], ["accounts.view", "View accounts"], ["accounts.manage", "Add and edit accounts"], ["accounts.view_sensitive", "See ID numbers"], ["agreements.view", "View agreements"], ["agreements.manage", "Create, end and cancel agreements"]] },
  { title: "Billing and invoices", items: [["billing.preview", "Preview billing runs"], ["billing.issue", "Issue monthly invoices"], ["invoices.view", "View invoices and balances"], ["invoices.create_manual", "Draft manual invoices"], ["invoices.issue_manual", "Review and issue manual invoices"], ["credits.create", "Record credit notes"]] },
  { title: "Payments", items: [["payments.view", "View payments"], ["payments.record", "Record payments"], ["payments.verify", "Verify or reject payments"], ["payments.allocate", "Allocate payments"], ["payments.reverse", "Reverse payments"]] },
  { title: "Expenses, staff and maintenance", items: [["expenses.view", "View expenses"], ["expenses.submit", "Record and submit expenses"], ["expenses.approve", "Approve or reject expenses"], ["expenses.pay", "Mark expenses paid"], ["staff.view", "View service staff"], ["staff.manage", "Manage staff records"], ["salary.view", "See salaries"], ["salary.manage", "Set salaries"], ["tasks.manage", "Manage service tasks"], ["workorders.view", "View work orders"], ["workorders.manage", "Manage work orders"], ["workorders.approve_quote", "Approve quotes"]] },
  { title: "Reports and administration", items: [["dashboard.view", "Dashboard"], ["reports.operational", "Operational reports"], ["reports.financial", "Financial reports and exports"], ["notices.view", "Notices"], ["settings.view", "View settings"], ["settings.manage", "Edit building profile and propose policies"], ["policies.approve", "Approve building policies"], ["users.manage", "Manage staff accounts"], ["audit.view", "View the audit log"]] },
];

const roleOptions = ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

export default async function UsersPage() {
  const actor = await requirePage("users.manage");
  const users = await listUsers(actor);
  const now = new Date();

  return (
    <>
      <PageHeader icon={ShieldCheck} title="Staff accounts and roles" description="Only staff sign in. Every account has one role; permissions are enforced on the server." back={{ href: "/settings", label: "Settings" }} />

      <Card title="Create staff account">
        <ActionForm action={createUserAction}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <TextInput label="Full name" name="name" required />
            <TextInput label="E-mail (sign-in)" name="email" type="email" required />
            <Select label="Role" name="role" required placeholder="Choose a role" options={roleOptions} />
          </div>
          <SubmitButton>Create account</SubmitButton>
        </ActionForm>
      </Card>

      <Card title="Accounts" className="mt-6">
        <div className="space-y-4">
          {users.map((u) => (
            <details key={u.id} className="rounded-xl border border-slate-200 p-4">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{u.name}</span>
                <span className="text-slate-500">{u.email}</span>
                <Badge tone="blue">{ROLE_LABELS[u.role]}</Badge>
                {!u.isActive && <Badge tone="red">Deactivated</Badge>}
                {u.lockedUntil && u.lockedUntil > now && <Badge tone="amber">Locked</Badge>}
                {u.id === actor.id && <Badge>You</Badge>}
                <span className="ml-auto text-xs text-slate-500">Last sign-in: {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "never"}</span>
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-6 lg:grid-cols-2">
                <ActionForm action={updateUserAction.bind(null, u.id)}>
                  <TextInput label="Full name" name={`name`} required defaultValue={u.name} />
                  <Select label="Role" name="role" defaultValue={u.role} options={roleOptions} />
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={u.isActive} /> Account active</label>
                  <SubmitButton variant="secondary">Save</SubmitButton>
                </ActionForm>
                <div>
                  <ActionForm action={resetPasswordAction.bind(null, u.id)}>
                    <p className="text-sm text-slate-600">Generates a new temporary password and signs the user out everywhere.</p>
                    <SubmitButton variant="secondary" confirm={`Reset the password of ${u.email}?`}>Reset password</SubmitButton>
                  </ActionForm>
                </div>
              </div>
            </details>
          ))}
        </div>
      </Card>

      <Card title="Role permissions" description="Provisional matrix based on the five roles in the approved prototype; the final matrix is still an open decision." className="mt-6">
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 uppercase">
                <th className="w-64 py-2 pr-4 font-semibold">Capability</th>
                {ROLES.map((r) => (
                  <th key={r} className="px-2 py-2 text-center font-semibold whitespace-nowrap">{ROLE_LABELS[r]}</th>
                ))}
              </tr>
            </thead>
            {PERMISSION_GROUPS.map((g) => (
              <tbody key={g.title}>
                <tr>
                  <th colSpan={ROLES.length + 1} className="bg-slate-50 px-2 py-1.5 text-left text-xs font-semibold text-navy-900">{g.title}</th>
                </tr>
                {g.items.map(([perm, label]) => (
                  <tr key={perm} className="border-b border-slate-100">
                    <td className="py-1.5 pr-4 text-slate-700">{label}</td>
                    {ROLES.map((r) => (
                      <td key={r} className="px-2 py-1.5 text-center">
                        {ROLE_PERMISSIONS[r].includes(perm) ? <Check className="mx-auto size-4 text-emerald-600" aria-label="Yes" /> : <Minus className="mx-auto size-4 text-slate-300" aria-label="No" />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </Card>
    </>
  );
}

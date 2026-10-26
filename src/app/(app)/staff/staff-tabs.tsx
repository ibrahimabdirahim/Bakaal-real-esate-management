import Link from "next/link";
import type { Actor } from "@/server/auth/actor";
import { can, type Permission } from "@/server/auth/permissions";

/** The Staff workspace: one sidebar button, these sections inside the page (same look as the Billing & Payments tabs). */
const TABS: { key: string; href: string; label: string; permission: Permission }[] = [
  { key: "staff", href: "/staff", label: "Staff", permission: "staff.view" },
  { key: "payments", href: "/staff/salary-payments", label: "Staff Payments", permission: "salary.view" },
  { key: "salaries", href: "/staff/salaries", label: "Salary Management", permission: "salary.view" },
  { key: "tasks", href: "/staff/tasks", label: "Tasks", permission: "staff.view" },
];

export function StaffTabs({ actor, current }: { actor: Actor; current: string }) {
  const tabs = TABS.filter((t) => can(actor.role, t.permission));
  return (
    <nav aria-label="Staff" className="no-print -mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={current === t.key ? "page" : undefined}
          className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap ${current === t.key ? "border-primary-600 text-primary-700" : "border-transparent text-muted hover:border-slate-300 hover:text-ink"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

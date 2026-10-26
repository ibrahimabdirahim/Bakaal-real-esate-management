import Link from "next/link";
import type { Actor } from "@/server/auth/actor";
import { can, type Permission } from "@/server/auth/permissions";
import { FilterPills } from "@/components/ui";

/**
 * The Billing & Payments workspace (F49): two lists, Invoices and Payments, each with its own records
 * and actions. Billing runs, credit notes and notices stay one click away from Invoices; the overview
 * (monthly chart, upcoming billing, ledger) is a link beside the tabs. An account filter (?partyId=)
 * is kept when switching tabs.
 */
const TABS: { key: string; href: string; label: string; permission: Permission[] }[] = [
  { key: "billing", href: "/invoices", label: "Invoices", permission: ["invoices.view"] },
  { key: "payments", href: "/payments", label: "Payments", permission: ["payments.view"] },
];

export function FinanceTabs({ actor, current, partyId }: { actor: Actor; current?: string; partyId?: string }) {
  const tabs = TABS.filter((t) => t.permission.every((p) => can(actor.role, p)));
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Billing and payments" className="no-print -mx-4 mb-6 flex items-center gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={partyId ? `${t.href}?partyId=${encodeURIComponent(partyId)}` : t.href}
          aria-current={current === t.key ? "page" : undefined}
          className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap ${current === t.key ? "border-primary-600 text-primary-700" : "border-transparent text-muted hover:border-slate-300 hover:text-ink"}`}
        >
          {t.label}
        </Link>
      ))}
      <Link href="/finance" aria-current={current === "overview" ? "page" : undefined} className={`ml-auto shrink-0 px-2 py-2.5 text-xs font-medium whitespace-nowrap ${current === "overview" ? "text-primary-700" : "text-muted hover:text-ink"}`}>
        Billing overview
      </Link>
    </nav>
  );
}

/** Within the Billing tab: its existing pages, one click apart (credit notes, notices and runs keep their own pages). */
const BILLING_SECTIONS: { key: string; href: string; label: string; permission: Permission }[] = [
  { key: "invoices", href: "/invoices", label: "Invoices", permission: "invoices.view" },
  { key: "credit-notes", href: "/invoices?view=credit-notes", label: "Credit notes", permission: "invoices.view" },
  { key: "notices", href: "/notices", label: "Notices & arrears", permission: "notices.view" },
  { key: "runs", href: "/billing", label: "Billing runs", permission: "billing.preview" },
];

export function BillingSections({ actor, current }: { actor: Actor; current: string }) {
  return (
    <FilterPills
      label="Billing sections"
      items={BILLING_SECTIONS.filter((x) => can(actor.role, x.permission)).map((x) => ({ href: x.href, label: x.label, current: x.key === current }))}
    />
  );
}

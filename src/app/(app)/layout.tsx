import { requireActor } from "@/server/auth/session";
import { can, ROLE_LABELS, type Permission } from "@/server/auth/permissions";
import { findBuilding } from "@/server/services/common";
import { logoutAction } from "@/app/login/actions";
import { AppChrome, Breadcrumbs, type NavGroup } from "./nav-links";
import { BrandLogo } from "@/components/brand";

type Perm = { /** Shown when the role has any of these; omitted = every signed-in user. */ permission?: Permission | Permission[] };
type NavItem = NavGroup["links"][number] & Perm;

// Seven main entries (owner request, F45). Each child is an existing page with its own server-side check;
// a page appears once. `also` lists addresses that belong to that entry (tabs and sub-pages).
const NAV: (Omit<NavGroup, "links"> & Perm & { links: NavItem[] })[] = [
  { key: "dashboard", label: "Dashboard", icon: "dashboard", href: "/", permission: "dashboard.view", links: [] },
  {
    key: "financials",
    label: "Financials",
    icon: "financials",
    links: [
      { href: "/invoices", label: "Billing & Payments", also: ["/finance", "/billing", "/payments"], permission: "invoices.view" },
      { href: "/expenses", label: "Expenses", permission: "expenses.view" },
    ],
  },
  {
    key: "tenants",
    label: "Tenants",
    icon: "accounts",
    links: [
      // Agreements are created with the account (Add account) and managed from each account and unit;
      // the /agreements pages stay (links, history, renewals) and count as Accounts here (F50).
      { href: "/accounts", label: "Accounts", also: ["/agreements"], permission: "accounts.view" },
    ],
  },
  {
    key: "property",
    label: "Property/Unit",
    icon: "units",
    links: [
      { href: "/units", label: "Units", permission: "units.view" },
      // Work orders are the Maintenance page.
      { href: "/maintenance", label: "Maintenance", permission: "workorders.view" },
      // The one staff entry (F51): Staff Management, with Staff, Staff Payments, Salary Management and Tasks as its tabs (by permission).
      { href: "/staff", label: "Staff & Tasks", permission: "staff.view" },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    icon: "reports",
    links: [
      { href: "/reports", label: "All reports", permission: ["reports.operational", "reports.financial"] },
      // Every user may search the documents they are allowed to see.
      { href: "/documents", label: "Documents" },
    ],
  },
  {
    key: "communication",
    label: "Communication",
    icon: "communication",
    // One page: arrears notices with reminder text (the system sends nothing itself).
    links: [{ href: "/notices", label: "Notices & reminders", permission: "notices.view" }],
  },
  {
    key: "settings",
    label: "Settings",
    icon: "settings",
    links: [
      { href: "/settings", label: "System Settings", permission: "settings.view" },
      { href: "/settings/users", label: "User Management", permission: "users.manage" },
      { href: "/audit", label: "Audit Log", permission: "audit.view" },
    ],
  },
];

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const actor = await requireActor();
  const building = await findBuilding();
  const allowed = ({ permission }: Perm) => !permission || (Array.isArray(permission) ? permission : [permission]).some((p) => can(actor.role, p));
  const groups: NavGroup[] = NAV.filter(allowed)
    .map(({ permission: _p, ...g }) => ({ ...g, links: g.links.filter(allowed).map(({ permission: _q, ...l }) => l) }))
    .filter((g) => g.href || g.links.length > 0);

  return (
    <div className="min-h-screen">
      <AppChrome groups={groups} user={{ name: actor.name, role: ROLE_LABELS[actor.role] }} logout={logoutAction} />
      <div className="app-main flex min-h-screen flex-col pt-14 transition-[padding] lg:pl-60">
        <div className="no-print flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line bg-white px-4 py-2.5 sm:px-8">
          <Breadcrumbs />
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
            {building ? (
              <span className="truncate">{building.name}</span>
            ) : (
              <span className="text-amber-800">No building set up yet</span>
            )}
          </div>
        </div>
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-8">{children}</main>
        {/* The one footer of every signed-in page: after all page content (the main area grows to fill short
            pages), never fixed over content, and left out of printouts. Sign-in and print views have their own layouts. */}
        <footer className="no-print flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 px-4 py-4 text-center text-xs sm:px-8">
          <BrandLogo width={22} decorative className="rounded" />
          <a href="https://bakaal-real-esate-management.onrender.com/" className="font-medium text-slate-600 hover:text-primary-700 hover:underline">
            BKL Development Limited
          </a>
          <span className="text-slate-400">{`© ${new Date().getFullYear()} BAKAAL Real Estate Management`}</span>
        </footer>
      </div>
    </div>
  );
}

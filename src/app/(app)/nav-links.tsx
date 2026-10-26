"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  FileSignature,
  FileText,
  FolderOpen,
  History,
  Landmark,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Settings,
  UserCog,
  UserRound,
  Users,
  Wallet,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { BrandLogo } from "@/components/brand";

export const NAV_ICONS = {
  dashboard: LayoutDashboard,
  units: Building2,
  accounts: Users,
  agreements: FileSignature,
  billing: CalendarClock,
  invoices: FileText,
  payments: Wallet,
  expenses: Receipt,
  staff: UserCog,
  maintenance: Wrench,
  notices: Bell,
  reports: BarChart3,
  documents: FolderOpen,
  audit: History,
  settings: Settings,
  financials: Landmark,
  communication: MessageSquare,
} satisfies Record<string, LucideIcon>;

/** A main sidebar entry: a direct page (`href`, e.g. Dashboard) or a group that expands to its pages. */
export type NavGroup = {
  key: string;
  label: string;
  icon: keyof typeof NAV_ICONS;
  href?: string;
  links: { href: string; label: string; /** Other addresses that belong to this page (its tabs and sub-pages). */ also?: string[] }[];
};

/** Spinner shown on a navigation link while its page is loading. */
function PendingIndicator() {
  const { pending } = useLinkStatus();
  return pending ? <Loader2 className="ml-auto size-4 shrink-0 animate-spin text-white/70" aria-label="Loading" /> : null;
}

const within = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

/** The sidebar page for an address: the most specific match, so /settings/users is User Management, not System Settings. */
function activeHref(groups: NavGroup[], pathname: string) {
  let best: { href: string; length: number } | null = null;
  for (const g of groups) {
    for (const l of g.href ? [{ href: g.href, label: g.label }] : g.links) {
      for (const prefix of [l.href, ...("also" in l ? (l.also ?? []) : [])]) {
        if (within(pathname, prefix) && (!best || prefix.length > best.length)) best = { href: l.href, length: prefix.length };
      }
    }
  }
  return best?.href ?? null;
}

const itemClass = (active: boolean, collapsed: boolean) =>
  `flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition ${collapsed ? "justify-center" : ""} ${
    active ? "bg-primary-600 font-medium text-white shadow-sm shadow-primary-600/30" : "text-slate-200/90 hover:bg-white/8 hover:text-white"
  }`;

function NavList({ groups, collapsed = false, onNavigate, onExpand }: { groups: NavGroup[]; collapsed?: boolean; onNavigate?: () => void; onExpand?: () => void }) {
  const pathname = usePathname();
  const active = activeHref(groups, pathname);
  const activeGroup = groups.find((g) => g.links.some((l) => l.href === active))?.key ?? null;
  const [open, setOpen] = useState<Set<string>>(() => new Set(activeGroup ? [activeGroup] : []));
  // Opening a child page (also from a link elsewhere) expands its group.
  const [shownFor, setShownFor] = useState(activeGroup);
  if (activeGroup !== shownFor) {
    setShownFor(activeGroup);
    if (activeGroup && !open.has(activeGroup)) setOpen(new Set(open).add(activeGroup));
  }
  const toggle = (key: string) => {
    if (collapsed) {
      onExpand?.(); // icon-only sidebar: widen it and show the group
      setOpen(new Set(open).add(key));
      return;
    }
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpen(next);
  };

  return (
    <nav aria-label="Main" className="px-3 py-4">
      <ul className="space-y-1">
        {groups.map((g) => {
          const Icon = NAV_ICONS[g.icon];
          if (g.href) {
            const isActive = active === g.href;
            return (
              <li key={g.key}>
                <Link href={g.href} onClick={onNavigate} title={collapsed ? g.label : undefined} aria-current={isActive ? "page" : undefined} className={itemClass(isActive, collapsed)}>
                  <Icon className="size-[18px] shrink-0" aria-hidden />
                  <span className={collapsed ? "sr-only" : ""}>{g.label}</span>
                  {!collapsed && <PendingIndicator />}
                </Link>
              </li>
            );
          }
          const expanded = open.has(g.key) && !collapsed;
          const holdsActive = activeGroup === g.key;
          return (
            <li key={g.key}>
              <button
                type="button"
                onClick={() => toggle(g.key)}
                aria-expanded={expanded}
                aria-controls={`nav-${g.key}`}
                title={collapsed ? g.label : undefined}
                className={
                  collapsed && holdsActive
                    ? itemClass(true, true)
                    : `flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition ${collapsed ? "justify-center" : ""} ${
                        holdsActive ? "bg-white/8 font-medium text-white" : "text-slate-200/90 hover:bg-white/8 hover:text-white"
                      }`
                }
              >
                <Icon className="size-[18px] shrink-0" aria-hidden />
                <span className={collapsed ? "sr-only" : "flex-1 text-left"}>{g.label}</span>
                {!collapsed && <ChevronDown className={`size-4 shrink-0 text-slate-400 transition ${expanded ? "rotate-180" : ""}`} aria-hidden />}
              </button>
              <ul id={`nav-${g.key}`} hidden={!expanded} className="mt-1 ml-[1.35rem] space-y-0.5 border-l border-white/10 pl-2.5">
                {g.links.map((l) => {
                  const isActive = active === l.href;
                  return (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        onClick={onNavigate}
                        aria-current={isActive ? "page" : undefined}
                        className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] transition ${
                          isActive ? "bg-primary-600 font-medium text-white shadow-sm shadow-primary-600/30" : "text-slate-300 hover:bg-white/8 hover:text-white"
                        }`}
                      >
                        <span>{l.label}</span>
                        <PendingIndicator />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const SIDEBAR_KEY = "bakaal.sidebar";

/**
 * Application chrome matching the approved prototype: full-width navy top bar with the
 * logo and wordmark, compact navy sidebar (collapsible on desktop), drawer on small screens.
 */
export function AppChrome({
  groups,
  user,
  logout,
}: {
  groups: NavGroup[];
  user: { name: string; role: string };
  logout: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Restore the desktop sidebar preference (browser-only convenience; safe if storage is blocked).
  useEffect(() => {
    let saved = false;
    try {
      saved = localStorage.getItem(SIDEBAR_KEY) === "collapsed";
    } catch {
      // ignore
    }
    if (saved) {
      document.documentElement.dataset.sidebar = "collapsed";
      queueMicrotask(() => setCollapsed(true));
    }
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    document.documentElement.dataset.sidebar = next ? "collapsed" : "expanded";
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? "collapsed" : "expanded");
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [drawer]);

  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <>
      {/* Top bar */}
      <header className="no-print fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 bg-navy-900 px-3 text-white shadow-sm sm:px-5">
        <button type="button" onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer} aria-controls="mobile-nav" className="rounded-lg p-2 hover:bg-white/10 lg:hidden">
          <Menu className="size-5" aria-hidden />
        </button>
        <button type="button" onClick={toggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="hidden rounded-lg p-2 hover:bg-white/10 lg:block">
          <Menu className="size-5" aria-hidden />
        </button>
        <Link href="/" className="flex min-w-0 items-center gap-3" aria-label="Bakaal — dashboard">
          <BrandLogo width={50} priority className="rounded-md" />
          <span className="text-xl font-extrabold tracking-wide">BAKAAL</span>
          <span className="hidden h-6 w-px bg-white/25 md:block" aria-hidden />
          <span className="hidden text-[13px] font-medium tracking-wide text-slate-200 md:block">REAL ESTATE MANAGEMENT</span>
        </Link>
        <details className="group relative ml-auto">
          <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/10 [&::-webkit-details-marker]:hidden">
            <span className="flex size-8 items-center justify-center rounded-full bg-slate-200 text-[13px] font-semibold text-navy-900" aria-hidden>
              {initials}
            </span>
            <span className="hidden text-left sm:block">
              <span className="block text-sm leading-tight font-medium">{user.name}</span>
              <span className="block text-[11px] leading-tight text-slate-300">{user.role}</span>
            </span>
            <ChevronDown className="size-4 text-slate-300 transition group-open:rotate-180" aria-hidden />
          </summary>
          <div className="absolute right-0 z-50 mt-2 w-60 rounded-xl border border-line bg-white p-1.5 text-ink shadow-lg">
            <div className="border-b border-line px-3 py-2">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs text-muted">{user.role}</p>
            </div>
            <Link href="/account" className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-surface">
              <UserRound className="size-4" aria-hidden /> My account
            </Link>
            <form action={logout}>
              <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50">
                <LogOut className="size-4" aria-hidden /> Sign out
              </button>
            </form>
          </div>
        </details>
      </header>

      {/* Desktop sidebar */}
      <aside className={`no-print fixed top-14 bottom-0 left-0 z-30 hidden flex-col overflow-y-auto bg-navy-800 transition-[width] lg:flex ${collapsed ? "w-[4.5rem]" : "w-60"}`}>
        <NavList groups={groups} collapsed={collapsed} onExpand={() => collapsed && toggleCollapsed()} />
        <button
          type="button"
          onClick={toggleCollapsed}
          className={`mx-3 mt-auto mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-300 hover:bg-white/8 hover:text-white ${collapsed ? "justify-center" : ""}`}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : undefined}
        >
          {collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
          {!collapsed && "Collapse menu"}
        </button>
      </aside>

      {/* Drawer for phones and tablets */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation" id="mobile-nav">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-navy-950/50" onClick={() => setDrawer(false)} />
          <div key={pathname} className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-navy-800 shadow-xl">
            <div className="flex items-center justify-between bg-navy-900 px-4 py-3">
              <span className="flex items-center gap-2.5 text-white">
                <BrandLogo width={44} className="rounded-md" />
                <span className="text-lg font-extrabold tracking-wide">BAKAAL</span>
              </span>
              <button type="button" onClick={() => setDrawer(false)} className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10" aria-label="Close menu">
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <NavList groups={groups} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}
    </>
  );
}

const SEGMENT_LABELS: Record<string, string> = {
  units: "Units",
  accounts: "Accounts",
  agreements: "Agreements",
  billing: "Billing runs",
  invoices: "Invoices",
  payments: "Payments",
  finance: "Billing & Payments",
  ledger: "Amounts owed ledger",
  expenses: "Expenses",
  staff: "Staff",
  tasks: "Service tasks",
  salaries: "Salary management",
  "salary-payments": "Staff payments",
  maintenance: "Maintenance",
  reports: "Reports",
  occupancy: "Occupancy",
  "rent-roll": "Rent roll",
  arrears: "Arrears ageing",
  collections: "Collections",
  reconciliation: "Balances owed check",
  documents: "Documents",
  notices: "Messages",
  settings: "Settings",
  users: "Staff accounts",
  audit: "Audit log",
  account: "My account",
  new: "New",
  statement: "Statement",
  receipt: "Receipt",
};

/** Breadcrumbs derived from the current address (record ids are shown as "Details"). */
export function Breadcrumbs() {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);
  const crumbs = [{ href: "/", label: "Dashboard" }];
  // Agreements live under Accounts in the navigation (F50).
  if (parts[0] === "agreements") crumbs.push({ href: "/accounts", label: "Accounts" });
  parts.forEach((p, i) => {
    const label = parts[i - 1] === "reports" && p === "expenses" ? "Expense report" : (SEGMENT_LABELS[p] ?? "Details");
    crumbs.push({ href: `/${parts.slice(0, i + 1).join("/")}`, label });
  });
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
        {crumbs.map((c, i) => (
          <li key={c.href} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3 text-slate-400" aria-hidden />}
            {i === crumbs.length - 1 ? (
              <span aria-current="page" className="font-medium text-navy-700">
                {c.label}
              </span>
            ) : (
              <Link href={c.href} className="underline-offset-2 hover:text-primary-600 hover:underline">
                {c.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

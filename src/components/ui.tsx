import Link from "next/link";
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Inbox, Minus, Plus, type LucideIcon } from "lucide-react";
import { formatMoney, type Cents } from "@/lib/money";

// ---------------------------------------------------------------- layout

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  /** Kept for compatibility; the prototype's page headers show no icon. */
  icon?: LucideIcon;
}) {
  return (
    <div className="mb-6">
      {back && (
        <Link href={back.href} className="no-print mb-2 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-primary-600">
          <ChevronLeft className="size-4" aria-hidden /> {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[1.75rem] leading-tight font-bold tracking-tight text-ink">{title}</h1>
          {description && <div className="mt-1 max-w-3xl text-sm text-muted">{description}</div>}
        </div>
        {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({
  title,
  description,
  children,
  actions,
  className = "",
  padded = true,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  padded?: boolean;
  /** For links to this card, e.g. "#edit". */
  id?: string;
}) {
  return (
    <section id={id} className={`print-plain rounded-[var(--radius-card)] border border-line bg-white shadow-[var(--shadow-card)] ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-5 py-3.5">
          <div>
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {actions && <div className="no-print flex max-w-full min-w-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={padded ? "p-5" : ""}>{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------- figures

const STAT_TONES = {
  blue: { bar: "border-l-accent-blue", icon: "text-accent-blue" },
  green: { bar: "border-l-accent-green", icon: "text-accent-green" },
  amber: { bar: "border-l-accent-amber", icon: "text-accent-amber" },
  red: { bar: "border-l-accent-red", icon: "text-accent-red" },
  slate: { bar: "border-l-slate-400", icon: "text-slate-500" },
  brand: { bar: "border-l-brand-400", icon: "text-brand-600" },
} as const;

/** KPI card in the prototype's style: coloured left accent, coloured icon, label, large value. */
export function Stat({
  label,
  value,
  tone = "blue",
  href,
  hint,
  icon: Icon,
  compact = false,
  children,
}: {
  label: string;
  value: ReactNode;
  tone?: keyof typeof STAT_TONES;
  href?: string;
  hint?: ReactNode;
  icon?: LucideIcon;
  compact?: boolean;
  children?: ReactNode;
}) {
  const t = STAT_TONES[tone];
  const body = (
    <div
      className={`print-plain flex h-full items-center gap-4 rounded-[var(--radius-card)] border border-l-4 border-line bg-white shadow-[var(--shadow-card)] transition ${t.bar} ${compact ? "px-4 py-3" : "px-5 py-4"} ${
        href ? "hover:shadow-md" : ""
      }`}
    >
      {Icon && <Icon className={`shrink-0 ${compact ? "size-6" : "size-9"} ${t.icon}`} strokeWidth={1.75} aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className={`font-medium text-ink ${compact ? "text-xs" : "text-[13px]"}`}>{label}</p>
        <p className={`font-bold tracking-tight whitespace-nowrap text-ink tabular-nums ${compact ? "text-lg" : "text-[1.4rem] leading-tight 2xl:text-[1.55rem]"}`}>{value}</p>
        {hint && <p className="mt-0.5 truncate text-xs text-muted">{hint}</p>}
        {children}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-[var(--radius-card)]">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Money({ cents, currency = "KES", className = "" }: { cents: Cents | null | undefined; currency?: string; className?: string }) {
  if (cents == null) return <span className="text-slate-400">—</span>;
  return <span className={`tabular-nums whitespace-nowrap ${cents < 0 ? "text-red-700" : ""} ${className}`}>{formatMoney(cents, currency)}</span>;
}

// ---------------------------------------------------------------- badges

const BADGE_TONES = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  blue: "bg-primary-50 text-primary-700 ring-primary-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/25",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  slate: "bg-slate-100 text-slate-600 ring-slate-500/20",
  purple: "bg-violet-50 text-violet-700 ring-violet-600/20",
} as const;
const DOT_TONES = { green: "bg-emerald-500", blue: "bg-primary-500", amber: "bg-amber-500", red: "bg-red-500", slate: "bg-slate-400", purple: "bg-violet-500" } as const;
export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${BADGE_TONES[tone]}`}>
      <span className={`size-1.5 rounded-full ${DOT_TONES[tone]}`} aria-hidden />
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- tables

/** Table cell. Cells do not wrap (identifiers stay on one line); pass `wrap` for long text. */
export function Td({ children, className = "", wrap = false, label }: { children?: ReactNode; className?: string; wrap?: boolean; label?: string }) {
  return (
    <td data-label={label} className={`px-3 py-3 align-top first:pl-4 text-slate-700 ${wrap ? "sm:min-w-48" : "sm:whitespace-nowrap"} ${className}`}>
      {children}
    </td>
  );
}

/** Adds each column's heading to its cells so rows can be shown as cards on phones. */
function labelRows(children: ReactNode, labels: string[]): ReactNode {
  return Children.toArray(children).map((row) => {
    if (!isValidElement(row) || row.type !== "tr") return row;
    const tr = row as ReactElement<{ children?: ReactNode }>;
    const cells = Children.toArray(tr.props.children).map((cell, i) =>
      isValidElement(cell) && cell.type === Td ? cloneElement(cell as ReactElement<{ label?: string }>, { label: (cell.props as { label?: string }).label ?? labels[i] ?? "" }) : cell,
    );
    return cloneElement(tr, {}, ...cells);
  });
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  const rows = Children.toArray(children);
  const labels = head.map((h) => (typeof h === "string" ? h : ""));
  return (
    <div className="relative -mx-5 overflow-x-auto px-5 sm:px-0">
      <table className="responsive-table min-w-full text-sm sm:divide-y sm:divide-slate-200">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="bg-slate-50 px-3 py-2.5 text-left first:pl-4 text-xs font-semibold tracking-wide whitespace-nowrap text-slate-500 uppercase first:rounded-l-md last:rounded-r-md">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="sm:divide-y sm:divide-slate-100">
          {rows.length > 0 ? (
            labelRows(rows, labels)
          ) : (
            <tr>
              <td colSpan={head.length} className="px-4 py-2">
                <EmptyState>{empty ?? "Nothing to show yet."}</EmptyState>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyState({ children, icon: Icon = Inbox, action }: { children: ReactNode; icon?: LucideIcon; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="max-w-sm text-sm text-slate-500">{children}</p>
      {action}
    </div>
  );
}

export function Pagination({ page, pages, total, query, path, shown }: { page: number; pages: number; total: number; query: Record<string, string>; path: string; /** Rows on this page: shows "5 of 12 records". */ shown?: number }) {
  const count = shown != null ? `${shown} of ${total} record${total === 1 ? "" : "s"}` : `${total} record(s)`;
  if (pages <= 1) return total > 0 ? <p className="mt-4 text-xs text-slate-500">{count}</p> : null;
  const href = (p: number) => `${path}?${new URLSearchParams({ ...query, page: String(p) })}`;
  const btn = "inline-flex min-w-8 items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50";
  // Page numbers when there are few pages; Previous / Next otherwise.
  const numbers = pages <= 7 ? Array.from({ length: pages }, (_, i) => i + 1) : [];
  return (
    <nav aria-label="Pagination" className="no-print mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="flex flex-wrap gap-1.5">
        {page > 1 && (
          <Link href={href(page - 1)} className={btn} aria-label="Previous page">
            <ChevronLeft className="size-4" aria-hidden />{numbers.length ? null : " Previous"}
          </Link>
        )}
        {numbers.map((n) =>
          n === page ? (
            <span key={n} aria-current="page" className={`${btn} border-primary-600 bg-primary-600 text-white hover:bg-primary-600`}>{n}</span>
          ) : (
            <Link key={n} href={href(n)} className={btn}>{n}</Link>
          ),
        )}
        {page < pages && (
          <Link href={href(page + 1)} className={btn} aria-label="Next page">
            {numbers.length ? null : "Next "}<ChevronRight className="size-4" aria-hidden />
          </Link>
        )}
      </span>
      <span className="text-slate-500">{shown != null ? count : `${count} · page ${page} of ${pages}`}</span>
    </nav>
  );
}

/**
 * A card whose body can be collapsed with the control at its top right (a native details element:
 * no script, keyboard accessible, open by default).
 */
export function CollapsibleCard({ title, children, className = "", id, padded = true }: { title: ReactNode; children: ReactNode; className?: string; id?: string; padded?: boolean }) {
  return (
    <details id={id} open className={`group print-plain rounded-[var(--radius-card)] border border-line bg-white shadow-[var(--shadow-card)] ${className}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-5 py-3.5 group-open:border-b group-open:border-line [&::-webkit-details-marker]:hidden">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        <span className="no-print flex size-6 items-center justify-center rounded text-primary-600 hover:bg-primary-50" aria-hidden>
          <Minus className="hidden size-4 group-open:block" />
          <Plus className="size-4 group-open:hidden" />
        </span>
        <span className="sr-only">Show or hide</span>
      </summary>
      <div className={padded ? "p-5" : ""}>{children}</div>
    </details>
  );
}

// ---------------------------------------------------------------- buttons & misc

const BUTTON_VARIANTS = {
  primary: "bg-primary-600 text-white shadow-sm hover:bg-primary-700",
  secondary: "border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50",
} as const;

export function ButtonLink({ href, children, variant = "primary", icon: Icon }: { href: string; children: ReactNode; variant?: keyof typeof BUTTON_VARIANTS; icon?: LucideIcon }) {
  return (
    <Link href={href} className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium whitespace-nowrap transition ${BUTTON_VARIANTS[variant]}`}>
      {Icon && <Icon className="size-4" aria-hidden />}
      {children}
    </Link>
  );
}

export function DescriptionList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{k}</dt>
          <dd className="mt-1 text-sm break-words text-slate-900">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Notice({ children, tone = "amber" }: { children: ReactNode; tone?: "amber" | "blue" | "red" | "green" }) {
  const styles = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    blue: "border-primary-100 bg-primary-50 text-navy-800",
    red: "border-red-200 bg-red-50 text-red-900",
    green: "border-emerald-200 bg-emerald-50 text-emerald-900",
  }[tone];
  return <div className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

/** A row of filter shortcuts with counts (the same look as the period selector). */
export function FilterPills({ label, items }: { label: string; items: { href: string; label: string; count?: number; current: boolean }[] }) {
  return (
    <nav aria-label={label} className="no-print mb-4 flex flex-wrap gap-1">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.current ? "true" : undefined}
          className={`rounded-md px-2.5 py-1 text-xs font-medium ${i.current ? "bg-primary-600 text-white" : "bg-white text-muted ring-1 ring-line hover:text-ink"}`}
        >
          {i.label}
          {i.count != null && <span className={`ml-1.5 tabular-nums ${i.current ? "text-white/80" : "text-slate-400"}`}>{i.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <form className="no-print mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">{children}</form>;
}

const filterControl = "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none";

export function FilterInput({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="text-sm text-slate-700">
      <span className="block text-xs font-medium text-slate-500">{label}</span>
      <input className={`${filterControl} sm:w-48`} {...rest} />
    </label>
  );
}

export function FilterSelect({ label, options, ...rest }: { label: string; options: { value: string; label: string }[] } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="text-sm text-slate-700">
      <span className="block text-xs font-medium text-slate-500">{label}</span>
      <select className={`${filterControl} sm:w-44`} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterSubmit({ label = "Apply" }: { label?: string }) {
  return (
    <button type="submit" className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
      {label}
    </button>
  );
}

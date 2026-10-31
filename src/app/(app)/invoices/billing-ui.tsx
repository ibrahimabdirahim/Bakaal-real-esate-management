import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, FileText, Plus, type LucideIcon } from "lucide-react";
import { ButtonLink } from "@/components/ui";
import { formatMoney, type Cents } from "@/lib/money";

const TONES = {
  blue: { box: "border-primary-100 bg-primary-50/70", icon: "bg-white text-primary-600" },
  amber: { box: "border-amber-100 bg-amber-50", icon: "bg-white text-amber-600" },
  green: { box: "border-emerald-100 bg-emerald-50", icon: "bg-white text-emerald-600" },
  red: { box: "border-red-100 bg-red-50", icon: "bg-white text-red-500" },
} as const;

/** One Billing & Payments summary card: a tinted card with its icon, label, figure and a short note. */
export function SummaryCard({ label, value, hint, icon: Icon, tone, href }: { label: string; value: string; hint: string; icon: LucideIcon; tone: keyof typeof TONES; href?: string }) {
  const t = TONES[tone];
  const body = (
    <>
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-full shadow-sm ${t.icon}`}>
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="mt-1 block text-xl font-bold text-navy-900 tabular-nums 2xl:text-2xl">{value}</span>
        <span className="mt-1 block text-xs text-slate-600">{hint}</span>
      </span>
    </>
  );
  const box = `flex items-start gap-3 rounded-[var(--radius-card)] border p-4 ${t.box}`;
  return href ? (
    <Link href={href} className={`${box} transition hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:outline-none`}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

/** The invoice list's empty state: what happened, and the way forward for those who may create invoices. */
export function NoInvoices({ createHref, filtered }: { createHref: string | null; filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <FileText className="size-7" aria-hidden />
      </span>
      <p className="mt-2 text-base font-semibold text-ink">No invoices found</p>
      <p className="max-w-sm text-sm text-slate-500">{filtered ? "Try adjusting your filters or create a new invoice." : "No invoices for this billing period yet. Create one, or generate the month's bills from More actions."}</p>
      {createHref && (
        <span className="mt-3">
          <ButtonLink href={createHref} icon={Plus}>Create Invoice</ButtonLink>
        </span>
      )}
    </div>
  );
}

/** A labelled control in the compact filter grid. */
export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block text-sm text-slate-700 ${className}`}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

export const control = "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none";

export function ClearLink({ href }: { href: string }) {
  return <Link href={href} className="px-1 py-2 text-sm font-medium text-primary-600 hover:underline">Clear filters</Link>;
}

/** An amount in a column headed "(KES)": the figure only, right-aligned by its cell. */
export function Amount({ cents }: { cents: Cents }) {
  return <span className={`tabular-nums whitespace-nowrap ${cents < 0 ? "text-red-700" : ""}`}>{formatMoney(cents).replace("KES ", "")}</span>;
}

/** "Showing 1 to 25 of 60 invoices" and the page buttons (previous, numbers, next). */
export function InvoicePager({ page, pages, total, size, shown, query, note }: { page: number; pages: number; total: number; size: number; shown: number; query: Record<string, string>; note?: string }) {
  if (total === 0) return null;
  const first = (page - 1) * size + 1;
  const href = (p: number) => `/invoices?${new URLSearchParams({ ...query, page: String(p) })}`;
  const btn = "inline-flex size-9 items-center justify-center rounded-lg border text-sm font-medium";
  const idle = `${btn} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
  const off = `${btn} border-slate-200 bg-white text-slate-300`;
  const numbers = pages <= 7 ? Array.from({ length: pages }, (_, i) => i + 1) : [page];
  return (
    <nav aria-label="Pagination" className="no-print mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 text-sm">
      <p className="text-slate-500">
        {`Showing ${first} to ${first + shown - 1} of ${total} invoice${total === 1 ? "" : "s"}`}
        {note && <span className="block text-xs text-slate-400 sm:inline sm:before:content-['_·_']">{note}</span>}
      </p>
      <span className="flex items-center gap-1.5">
        {page > 1 ? <Link href={href(page - 1)} className={idle} aria-label="Previous page"><ChevronLeft className="size-4" aria-hidden /></Link> : <span className={off} aria-hidden><ChevronLeft className="size-4" /></span>}
        {numbers.map((n) => (n === page ? <span key={n} aria-current="page" className={`${btn} border-primary-600 bg-primary-600 text-white`}>{n}</span> : <Link key={n} href={href(n)} className={idle}>{n}</Link>))}
        {pages > 7 && <span className="px-1 text-xs text-slate-500">{`of ${pages}`}</span>}
        {page < pages ? <Link href={href(page + 1)} className={idle} aria-label="Next page"><ChevronRight className="size-4" aria-hidden /></Link> : <span className={off} aria-hidden><ChevronRight className="size-4" /></span>}
      </span>
    </nav>
  );
}

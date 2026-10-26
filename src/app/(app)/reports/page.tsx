import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/auth/session";
import { can, type Permission } from "@/server/auth/permissions";
import { EXPENSE_STATUS_FILTERS, REPORT_DEFS, reportFilterOptions, runReport, type FilterKey, type ReportKey } from "@/server/reports/catalog";
import { AGEING_BUCKETS } from "@/server/ledger";
import { CollapsibleCard, Notice, PageHeader } from "@/components/ui";
import { formatCell, formatSummary, type ReportSection } from "@/lib/report-doc";
import { monthStart, todayISO } from "@/lib/dates";
import { EXPENSE_CATEGORY_LABELS } from "../expenses/labels";
import { ReportFilters, type FilterField } from "./report-filters";

export const metadata = { title: "Reports" };

/** The other reports and record lists, kept as they were (each page checks its own permission). */
const MORE: { href: string; title: string; permission: Permission[] }[] = [
  { href: "/reports/occupancy", title: "Occupancy and vacant units", permission: ["reports.operational"] },
  { href: "/reports/rent-roll", title: "Rent roll and owner charges", permission: ["reports.financial"] },
  { href: "/reports/collections", title: "Collections", permission: ["reports.financial"] },
  { href: "/reports/reconciliation", title: "Balances owed check", permission: ["reports.financial"] },
  { href: "/finance/ledger", title: "Amounts owed ledger", permission: ["invoices.view"] },
  { href: "/staff/salary-payments", title: "Salary payments", permission: ["salary.view"] },
  { href: "/documents", title: "Documents", permission: ["accounts.view", "agreements.view", "units.view", "payments.view", "expenses.view", "workorders.view", "staff.manage"] },
];

const ROWS_SHOWN = 200;

/**
 * Reports (F55): choose a report on the left, set its filters, Submit. The results, the PDF and the
 * Excel file come from the same calculation (runReport), so they always agree.
 */
export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const actor = await requireActor();
  const sp = await searchParams;
  const visible = REPORT_DEFS.filter((d) => can(actor.role, d.permission));
  const more = MORE.filter((m) => m.permission.some((p) => can(actor.role, p)));
  if (!visible.length && !can(actor.role, "reports.operational")) redirect("/no-access");
  const def = visible.find((d) => d.key === sp.report) ?? visible[0];
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const today = todayISO();
  const showAll = sp.all === "1";

  // Filter fields for the selected report, with defaults shown (the current month, today, this year).
  const options = def ? await reportFilterOptions(actor) : { parties: [], units: [] };
  const defaults: Partial<Record<FilterKey, string>> = { from: monthStart(today), to: today, asOf: today, year: today.slice(0, 4), years: "3", status: "COSTS" };
  const applied = def ? Object.fromEntries(def.filters.map((f) => [f, str(f) || defaults[f] || ""])) : {};
  const FIELD: Record<FilterKey, FilterField> = {
    partyId: { name: "partyId", label: "Tenant / account", type: "select", options: options.parties, placeholder: def?.key === "tenant" ? "Choose an account" : "All accounts", required: def?.key === "tenant" },
    unitId: { name: "unitId", label: "Property (unit)", type: "select", options: def?.key === "expenses" ? [{ value: "BUILDING", label: "Building-wide (no unit)" }, ...options.units] : options.units, placeholder: def?.key === "property" ? "Choose a unit" : "All units", required: def?.key === "property" },
    from: { name: "from", label: "Start date", type: "date", required: true },
    to: { name: "to", label: "End date", type: "date", required: true },
    asOf: { name: "asOf", label: "As at date", type: "date", required: true },
    year: { name: "year", label: def?.key === "year" ? "Last year shown" : "Year", type: "number", min: 2000, max: 2100, required: true },
    years: { name: "years", label: "Number of years", type: "number", min: 2, max: 10 },
    category: { name: "category", label: "Category", type: "select", options: Object.entries(EXPENSE_CATEGORY_LABELS).filter(([v]) => v !== "SALARIES" || can(actor.role, "salary.view")).map(([value, label]) => ({ value, label })), placeholder: "All categories" },
    status: { name: "status", label: "Status", type: "select", options: Object.entries(EXPENSE_STATUS_FILTERS).filter(([v]) => v !== "COSTS").map(([value, label]) => ({ value, label })), placeholder: EXPENSE_STATUS_FILTERS.COSTS },
    bucket: { name: "bucket", label: "Days overdue", type: "select", options: AGEING_BUCKETS.map((b) => ({ value: b, label: b })), placeholder: "All" },
  };
  // "status" uses an empty value for the default (costs): keep the select and the URL in step.
  if (def?.key === "expenses" && applied.status === "COSTS") applied.status = "";
  const fields = def ? def.filters.map((f) => FIELD[f]) : [];
  const ran = sp.run === "1" || def?.filters.every((f) => !FIELD[f].required || (f !== "partyId" && f !== "unitId"));
  const result = def && ran ? await runReport(actor, def.key as ReportKey, applied) : null;
  const query = new URLSearchParams({ report: def?.key ?? "", ...Object.fromEntries(Object.entries(applied).filter(([, v]) => v)) }).toString();

  return (
    <>
      <PageHeader title="Reports" description="Every report is calculated from the source records when you submit it. Amounts owed are not cash; costs approved are not payments." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label="Reports" className="h-fit rounded-[var(--radius-card)] border border-line bg-white p-2 shadow-[var(--shadow-card)]">
          <ul className="space-y-0.5" data-report-list>
            {visible.map((d) => (
              <li key={d.key}>
                <Link href={`/reports?report=${d.key}`} aria-current={d.key === def?.key ? "page" : undefined} className={`block rounded-md px-3 py-2 text-sm ${d.key === def?.key ? "bg-primary-600 font-medium text-white" : "text-ink hover:bg-surface"}`}>
                  {d.label}
                </Link>
              </li>
            ))}
          </ul>
          {more.length > 0 && (
            <>
              <p className="mt-3 border-t border-line px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">More reports</p>
              <ul className="space-y-0.5">
                {more.map((m) => (
                  <li key={m.href}><Link href={m.href} className="block rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-surface hover:text-ink">{m.title}</Link></li>
                ))}
              </ul>
            </>
          )}
        </nav>

        <div className="min-w-0 space-y-6">
          {!def ? (
            <Notice tone="blue">Your role can open the operational reports listed under More reports.</Notice>
          ) : (
            <>
              <CollapsibleCard title="Filters">
                <p className="mb-4 text-sm text-muted">{def.description}</p>
                <ReportFilters key={query} report={def.key} fields={fields} applied={applied} downloadQuery={query} canDownload={!!result && "doc" in result} />
              </CollapsibleCard>
              <CollapsibleCard title={result && "doc" in result ? result.doc.title : def.label}>
                {!result ? (
                  <p className="text-sm text-muted">Set the filters and press Submit.</p>
                ) : "error" in result ? (
                  <Notice tone="red">{result.error}</Notice>
                ) : "needs" in result ? (
                  <Notice tone="blue">{result.needs}</Notice>
                ) : (
                  <div className="space-y-6" data-report-results={def.key}>
                    <div>
                      <p className="text-sm font-medium text-ink" data-report-period>{result.doc.period}</p>
                      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                        {result.doc.filters.map(([k, v]) => <li key={k}><span className="font-medium text-slate-600">{k}:</span> {v}</li>)}
                        <li>Generated {result.doc.generatedAt}</li>
                      </ul>
                    </div>
                    {result.doc.summary.length > 0 && (
                      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4" data-report-summary>
                        {result.doc.summary.map((s) => (
                          <div key={s.label} className="rounded-lg border border-line bg-surface/50 px-3 py-2.5">
                            <dt className="text-xs text-muted">{s.label}</dt>
                            <dd className="mt-0.5 font-semibold text-navy-900 tabular-nums">{formatSummary(s.value, s.type)}</dd>
                            {s.note && <dd className="text-[11px] text-muted">{s.note}</dd>}
                          </div>
                        ))}
                      </dl>
                    )}
                    {result.doc.sections.map((s) => <SectionTable key={s.title} s={s} showAll={showAll} allHref={`/reports?${query}&run=1&all=1`} />)}
                    {result.doc.notes.map((n) => <p key={n} className="text-xs text-muted">{n}</p>)}
                  </div>
                )}
              </CollapsibleCard>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function SectionTable({ s, showAll, allHref }: { s: ReportSection; showAll: boolean; allHref: string }) {
  const rows = showAll ? s.rows : s.rows.slice(0, ROWS_SHOWN);
  const num = (t: string) => t === "money" || t === "number" || t === "percent";
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-ink">{s.title}</h3>
      {s.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{s.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs text-muted">
              <tr>{s.columns.map((c) => <th key={c.key} scope="col" className={`px-3 py-2 font-medium whitespace-nowrap ${num(c.type) ? "text-right" : ""}`}>{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, i) => (
                <tr key={i}>
                  {s.columns.map((c, j) => {
                    const text = formatCell(r[c.key] ?? null, c.type);
                    return (
                      <td key={c.key} className={`px-3 py-2 ${num(c.type) ? "text-right whitespace-nowrap tabular-nums" : c.type === "date" ? "whitespace-nowrap" : ""}`}>
                        {j === 0 && typeof r._href === "string" ? <Link href={r._href} className="text-primary-600 hover:underline">{text}</Link> : text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {s.totals && (
              <tfoot className="border-t-2 border-line bg-surface/60 font-semibold">
                <tr>{s.columns.map((c) => <td key={c.key} className={`px-3 py-2 ${num(c.type) ? "text-right whitespace-nowrap tabular-nums" : ""}`}>{s.totals![c.key] == null ? "" : formatCell(s.totals![c.key] ?? null, c.type)}</td>)}</tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {s.rows.length > rows.length && <p className="mt-2 text-xs text-muted">{`Showing ${rows.length} of ${s.rows.length} rows. `}<Link href={allHref} className="text-primary-600 hover:underline">Show all</Link> — the downloads always include every row.</p>}
      {s.note && <p className="mt-2 text-xs text-muted">{s.note}</p>}
    </section>
  );
}

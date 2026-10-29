import Link from "next/link";
import { BillingSections, FinanceTabs } from "../finance/finance-tabs";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { getBillingRun, listBillingRuns, outcomeCounts, previewBilling } from "@/server/services/billing";
import { LINE_CATEGORIES, type BillingPreview, type LineCategory } from "@/server/billing/compute";
import { BusinessError } from "@/server/auth/actor";
import { Badge, Card, Money, Notice, PageHeader, Table, Td } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { addMonths, formatDate, formatDateTime, formatMonth, fromDbDate, monthStart, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { AGREEMENT_TYPE_LABELS, CHARGE_CATEGORY_LABELS } from "../agreements/labels";
import { issueBillingAction } from "./actions";
import { CalendarClock, CheckCircle2 } from "lucide-react";

export const metadata = { title: "Billing runs" };

const EXCEPTION_LABELS = {
  PARTIAL_PERIOD: "Part month",
  PARTIAL_CHARGE_PERIOD: "Charge covers part month",
  NO_DUE_DATE: "No due date",
  ALREADY_INVOICED: "Already billed",
} as const;

const control = "mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none";
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []);
const typesLabel = (types: LineCategory[]) => (types.length === 0 || types.length === LINE_CATEGORIES.length ? "All charge types" : types.map((t) => CHARGE_CATEGORY_LABELS[t]).join(", "));

/**
 * Billing runs and bulk billing (F65): choose the month, the charge types and the accounts (all, or
 * chosen ones), preview, then confirm. The preview creates nothing; on confirm the server
 * recalculates and bills only charges not yet billed for the month, then shows the run's report.
 */
export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  const actor = await requirePage("billing.preview");
  const sp = await searchParams;
  const current = monthStart(todayISO());
  const months = Array.from({ length: 24 }, (_, i) => addMonths(current, -i));
  const period = typeof sp.month === "string" && months.includes(sp.month) ? sp.month : current;
  const categories = LINE_CATEGORIES.filter((c) => many(sp.types).includes(c));
  const choose = sp.choose === "1";
  const partyIds = choose ? many(sp.partyId).filter((id) => /^[a-z0-9_-]{1,64}$/i.test(id)) : [];
  const run = typeof sp.run === "string" ? await getBillingRun(actor, sp.run) : null;

  let all: BillingPreview | null = null;
  let preview: BillingPreview | null = null;
  let error: string | null = null;
  try {
    all = await previewBilling(actor, period, { categories });
    preview = choose ? (partyIds.length ? await previewBilling(actor, period, { categories, partyIds }) : null) : all;
  } catch (e) {
    if (e instanceof BusinessError) error = e.message;
    else throw e;
  }
  const runs = await listBillingRuns(actor);
  const canIssue = can(actor.role, "billing.issue");

  // Accounts with an agreement in force this month (for "choose accounts"), each once.
  const accounts = all
    ? [...new Map([...all.invoices, ...all.exceptions, ...all.nothingToBill, ...all.reviews].map((x) => [x.partyId, { id: x.partyId, name: x.partyName, units: new Set<string>() }])).values()]
    : [];
  for (const x of all ? [...all.invoices, ...all.exceptions, ...all.nothingToBill, ...all.reviews] : []) accounts.find((a) => a.id === x.partyId)?.units.add(x.unitNumber);
  accounts.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const counts = preview ? outcomeCounts(preview) : null;
  const held = preview ? preview.exceptions.filter((e) => e.code !== "ALREADY_INVOICED") : [];
  const already = preview ? preview.exceptions.filter((e) => e.code === "ALREADY_INVOICED") : [];
  const eligible = preview ? new Set([...preview.invoices, ...preview.exceptions, ...preview.nothingToBill, ...preview.reviews].map((x) => x.partyId)).size : 0;
  const scopeText = `${formatMonth(period)} · ${typesLabel(categories)} · ${choose ? `${partyIds.length} chosen account(s)` : "all accounts"}`;

  return (
    <>
      <PageHeader
        icon={CalendarClock}
        title="Billing runs"
        description="Bill a month: choose the charge types and the accounts, preview, then confirm. Each recurring charge is billed at most once per month, so running a month again, or another charge type later, never duplicates a charge."
      />
      <FinanceTabs actor={actor} current="billing" />
      <BillingSections actor={actor} current="runs" />

      {run && (
        <Card title="Billing run result" className="mb-6" description={`${formatMonth(fromDbDate(run.periodStart))} · ${typesLabel(run.chargeTypes)} · ${run.partyIds.length ? `${run.partyIds.length} chosen account(s)` : "all accounts"} · ${run.source === "REGISTRATION" ? "first invoice when the account was added" : "billing run"} · ${run.issuedBy}, ${formatDateTime(run.issuedAt)}`}>
          <div role="status" className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{`Completed: ${run.invoiceCount} invoice(s) issued for ${formatMoney(run.totalAmount ?? 0)}. A run is saved completely or not at all, so no invoice failed part-way.`}</span>
          </div>
          <dl className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5" data-run-report>
            {[
              ["Invoices created", run.invoiceCount],
              ["Already billed (skipped)", run.alreadyBilledCount ?? "—"],
              ["No charge of these types", run.notApplicableCount ?? "—"],
              ["Held for review", run.reviewCount ?? run.skippedCount],
              ["Failed", 0],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-lg border border-line bg-surface/50 px-3 py-2">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="font-semibold text-navy-900 tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <Table head={["Invoice", "Account", "Unit", "Amount"]} empty="No invoices.">
            {run.invoices.map((i) => (
              <tr key={i.id}>
                <Td><Link href={`/invoices/${i.id}`} className="font-medium text-primary-600 hover:underline">{i.number}</Link></Td>
                <Td>{i.party.displayName}</Td>
                <Td>{i.unit.unitNumber}</Td>
                <Td><Money cents={i.total} /></Td>
              </tr>
            ))}
          </Table>
          <p className="mt-3 text-sm"><Link href={`/invoices?period=${fromDbDate(run.periodStart)}`} className="text-primary-600 hover:underline">{`Open ${formatMonth(fromDbDate(run.periodStart))} in Billing & Payments`}</Link></p>
        </Card>
      )}

      <Card title="1. What to bill">
        <form method="get" action="/billing" className="space-y-4" aria-label="What to bill">
          <div className="flex flex-wrap items-end gap-6">
            <label className="text-sm text-slate-700">
              <span className="block text-xs font-medium text-slate-500">Billing month</span>
              <select name="month" defaultValue={period} className={control}>
                {months.map((m) => <option key={m} value={m}>{formatMonth(m)}</option>)}
              </select>
            </label>
            <fieldset className="text-sm">
              <legend className="text-xs font-medium text-slate-500">Charge types (none ticked = all)</legend>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-2">
                {LINE_CATEGORIES.map((c) => (
                  <label key={c} className="inline-flex items-center gap-2"><input type="checkbox" name="types" value={c} defaultChecked={categories.includes(c)} className="size-4 rounded border-slate-300" />{CHARGE_CATEGORY_LABELS[c]}</label>
                ))}
              </div>
            </fieldset>
            <fieldset className="text-sm">
              <legend className="text-xs font-medium text-slate-500">Accounts</legend>
              <div className="mt-1.5 flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2"><input type="radio" name="choose" value="" defaultChecked={!choose} className="size-4" />All accounts</label>
                <label className="inline-flex items-center gap-2"><input type="radio" name="choose" value="1" defaultChecked={choose} className="size-4" />Chosen accounts</label>
              </div>
            </fieldset>
          </div>
          {choose && (
            <fieldset className="rounded-lg border border-line p-3">
              <legend className="px-1 text-xs font-medium text-slate-500">{`Accounts with an agreement in force in ${formatMonth(period)}`}</legend>
              {accounts.length === 0 ? (
                <p className="text-sm text-muted">No account has an agreement in force in this month.</p>
              ) : (
                <div className="grid max-h-72 grid-cols-1 gap-x-4 gap-y-1.5 overflow-y-auto text-sm sm:grid-cols-2 lg:grid-cols-3">
                  {accounts.map((a) => (
                    <label key={a.id} className="inline-flex items-center gap-2">
                      <input type="checkbox" name="partyId" value={a.id} defaultChecked={partyIds.includes(a.id)} className="size-4 rounded border-slate-300" />
                      <span>{a.name} <span className="text-xs text-muted">{`· Unit ${[...a.units].join(", ")}`}</span></span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          )}
          <button type="submit" className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700">Preview</button>
        </form>
        {error && <div className="mt-4"><Notice tone="red">{error}</Notice></div>}
      </Card>

      {choose && partyIds.length === 0 && !error && <div className="mt-6"><Notice tone="blue">Tick one or more accounts, then press Preview.</Notice></div>}

      {preview && counts && (
        <Card title="2. Preview — nothing is created until you confirm" description={scopeText} className="mt-6">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6" data-billing-preview>
            {[
              ["Accounts in scope", eligible],
              ["Invoices to create", preview.invoices.length],
              ["Total to bill", formatMoney(counts.total)],
              ["Already billed (skipped)", counts.alreadyBilled],
              ["No charge of these types", counts.notApplicable],
              ["Needs review", counts.review],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-lg border border-line bg-surface/50 px-3 py-2">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="font-semibold text-navy-900 tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          {preview.invoices.length > 0 && canIssue && (
            <div className="mt-4">
              <ActionForm action={issueBillingAction.bind(null, period, { categories, partyIds })}>
                <SubmitButton
                  confirmTitle="Issue invoices?"
                  confirm={`Issue ${preview.invoices.length} invoice(s) totalling ${formatMoney(counts.total)} for ${formatMonth(period)} (${typesLabel(categories).toLowerCase()})? The amounts are recalculated when you confirm. Issued invoices are never edited, only corrected with credit notes.`}
                  confirmLabel="Confirm and issue"
                >
                  {`Issue ${preview.invoices.length} invoice(s) for ${formatMonth(period)}`}
                </SubmitButton>
              </ActionForm>
            </div>
          )}
          {preview.invoices.length > 0 && !canIssue && <p className="mt-4 text-sm text-slate-600">Review only: issuing invoices needs a role that may issue billing (Finance or an administrator).</p>}
          {preview.invoices.length === 0 && <p className="mt-4 text-sm text-slate-600">Nothing new to bill for this choice. The lists below say why.</p>}
        </Card>
      )}

      {preview && preview.invoices.length > 0 && (
        <Card title="New invoices" className="mt-6">
          <Table head={["Unit", "Account", "Charges", "Due date", "Total"]}>
            {preview.invoices.map((i) => (
              <tr key={i.agreementId}>
                <Td>{i.unitNumber}</Td>
                <Td>
                  {i.partyName}
                  <span className="block text-xs text-slate-500">{AGREEMENT_TYPE_LABELS[i.agreementType]}</span>
                </Td>
                <Td wrap>
                  <ul>
                    {i.lines.map((l, k) => (
                      <li key={k} className="flex justify-between gap-4"><span>{CHARGE_CATEGORY_LABELS[l.category]}: {l.description}</span><Money cents={l.amount} /></li>
                    ))}
                  </ul>
                  {i.alreadyBilled.length > 0 && <span className="mt-1 block text-xs text-muted">{`Already billed this month, not repeated: ${i.alreadyBilled.map((b) => b.description).join(", ")}`}</span>}
                </Td>
                <Td>
                  {formatDate(i.dueDate)}
                  {i.dueDateSource === "BUILDING_POLICY" && <span className="block text-xs text-slate-500">from building policy</span>}
                </Td>
                <Td className="font-medium"><Money cents={i.total} /></Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {preview && (held.length > 0 || preview.reviews.length > 0) && (
        <Card title="Needs review — not billed automatically (no rule is invented)" className="mt-6">
          <Table head={["Unit", "Account", "Reason", "What to do"]}>
            {held.map((e) => (
              <tr key={e.agreementId + e.code}>
                <Td>{e.unitNumber}</Td>
                <Td>{e.partyName}</Td>
                <Td><Badge tone="amber">{EXCEPTION_LABELS[e.code]}</Badge></Td>
                <Td wrap className="text-slate-700">{e.message} <Link href={`/agreements/${e.agreementId}`} className="text-primary-600 hover:underline">Open agreement</Link></Td>
              </tr>
            ))}
            {preview.reviews.map((r) => (
              <tr key={`review-${r.agreementId}`}>
                <Td>{r.unitNumber}</Td>
                <Td>{r.partyName}</Td>
                <Td><Badge tone="amber">Missing term</Badge></Td>
                <Td wrap className="text-slate-700">{r.message} <Link href={`/agreements/${r.agreementId}`} className="text-primary-600 hover:underline">Open agreement</Link></Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {preview && already.length > 0 && (
        <Card title="Already billed for this month — skipped" className="mt-6">
          <Table head={["Unit", "Account", "Charges already billed"]}>
            {already.map((e) => (
              <tr key={e.agreementId}>
                <Td>{e.unitNumber}</Td>
                <Td>{e.partyName}</Td>
                <Td wrap className="text-slate-700">{e.message.replace(/ Nothing is billed twice\.$/, "")}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {preview && preview.nothingToBill.length > 0 && (
        <Card title="No charge of the chosen types — not applicable" className="mt-6">
          <p className="text-sm text-slate-600">{preview.nothingToBill.map((n) => `${n.partyName} (Unit ${n.unitNumber})`).join(" · ")}</p>
        </Card>
      )}

      <Card title="Billing run history" className="mt-6">
        <Table head={["Month", "Charge types", "Accounts", "Source", "Issued", "Invoices", "Total", "Already billed", "Held for review", ""]} empty="No billing runs yet.">
          {runs.map((r) => (
            <tr key={r.id}>
              <Td>{formatMonth(fromDbDate(r.periodStart))}</Td>
              <Td wrap>{typesLabel(r.chargeTypes)}</Td>
              <Td>{r.partyIds.length ? `${r.partyIds.length} chosen` : "All"}</Td>
              <Td>{r.source === "REGISTRATION" ? "New account" : "Billing run"}</Td>
              <Td>{formatDateTime(r.issuedAt)}<span className="block text-xs text-muted">{r.issuedBy}</span></Td>
              <Td>{r.invoiceCount}</Td>
              <Td>{r.totalAmount != null ? <Money cents={r.totalAmount} /> : "—"}</Td>
              <Td>{r.alreadyBilledCount ?? "—"}</Td>
              <Td>{r.reviewCount ?? r.skippedCount}</Td>
              <Td className="w-px"><Link href={`/billing?run=${r.id}&month=${fromDbDate(r.periodStart)}`} className="text-sm text-primary-600 hover:underline">Report</Link></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

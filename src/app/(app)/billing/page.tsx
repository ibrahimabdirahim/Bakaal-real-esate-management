import Link from "next/link";
import { BillingSections, FinanceTabs } from "../finance/finance-tabs";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { listBillingRuns, previewBilling } from "@/server/services/billing";
import { BusinessError } from "@/server/auth/actor";
import { Badge, Card, FilterBar, FilterSubmit, Money, Notice, PageHeader, Table, Td } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { addMonths, formatDate, formatDateTime, formatMonth, fromDbDate, monthStart, todayISO } from "@/lib/dates";
import { sumCents } from "@/lib/money";
import { AGREEMENT_TYPE_LABELS, CHARGE_CATEGORY_LABELS } from "../agreements/labels";
import { issueBillingAction } from "./actions";
import { CalendarClock } from "lucide-react";

export const metadata = { title: "Billing runs" };

const EXCEPTION_LABELS = {
  PARTIAL_PERIOD: "Part month",
  PARTIAL_CHARGE_PERIOD: "Charge covers part month",
  NO_DUE_DATE: "No due date",
  ALREADY_INVOICED: "Already invoiced",
} as const;

export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  const actor = await requirePage("billing.preview");
  const sp = await searchParams;
  const current = monthStart(todayISO());
  const months = Array.from({ length: 12 }, (_, i) => addMonths(current, -i));
  const period = typeof sp.month === "string" && months.includes(sp.month) ? sp.month : current;

  let preview = null;
  let error: string | null = null;
  try {
    preview = await previewBilling(actor, period);
  } catch (e) {
    if (e instanceof BusinessError) error = e.message;
    else throw e;
  }
  const runs = await listBillingRuns(actor);
  const canIssue = can(actor.role, "billing.issue");
  const realExceptions = preview?.exceptions.filter((e) => e.code !== "ALREADY_INVOICED") ?? [];
  const alreadyInvoiced = (preview?.exceptions.length ?? 0) - realExceptions.length;

  return (
    <>
      <PageHeader icon={CalendarClock}
        title="Monthly billing run"
        description="Preview the invoices for a month from active agreements and approved charges, review exceptions, then issue. Running the same month again never duplicates invoices."
      />
      <FinanceTabs actor={actor} current="billing" />
      <BillingSections actor={actor} current="runs" />
      <Card>
        <FilterBar>
          <label className="text-sm text-slate-700">
            <span className="block text-xs font-medium text-slate-500">Billing month</span>
            <select name="month" defaultValue={period} className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none">
              {months.map((m) => (
                <option key={m} value={m}>{formatMonth(m)}</option>
              ))}
            </select>
          </label>
          <FilterSubmit />
        </FilterBar>
        {error && <Notice tone="red">{error}</Notice>}
        {preview && (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div><p className="text-xs text-slate-500">Invoices to issue</p><p className="text-xl font-bold">{preview.invoices.length}</p></div>
              <div><p className="text-xs text-slate-500">Total to bill</p><p className="text-xl font-bold"><Money cents={sumCents(preview.invoices.map((i) => i.total))} /></p></div>
              <div><p className="text-xs text-slate-500">Held for review</p><p className="text-xl font-bold">{realExceptions.length}</p></div>
              <div><p className="text-xs text-slate-500">Nothing to bill</p><p className="text-xl font-bold">{preview.nothingToBill.length}</p></div>
            </div>
            {canIssue && preview.invoices.length > 0 && (
              <div className="mt-4">
                <ActionForm action={issueBillingAction.bind(null, period)}>
                  <SubmitButton confirm={`Issue ${preview.invoices.length} invoice(s) for ${formatMonth(period)}? Issued invoices cannot be edited, only corrected with credit notes.`}>
                    Issue {preview.invoices.length} invoice(s) for {formatMonth(period)}
                  </SubmitButton>
                </ActionForm>
              </div>
            )}
            {!canIssue && preview.invoices.length > 0 && <p className="mt-4 text-sm text-slate-600">Review only: issuing invoices requires the finance role.</p>}
          </>
        )}
      </Card>

      {preview && preview.invoices.length > 0 && (
        <Card title={`Preview — ${formatMonth(period)}`} className="mt-6">
          <Table head={["Unit", "Account", "Lines", "Due date", "Total"]}>
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

      {preview && alreadyInvoiced > 0 && (
        <p className="mt-4 text-sm text-slate-600">{alreadyInvoiced} agreement(s) are already invoiced for {formatMonth(period)} and will not be invoiced again.</p>
      )}

      {preview && realExceptions.length > 0 && (
        <Card title="Exceptions — held for review, not invoiced automatically" className="mt-6">
          <Table head={["Unit", "Account", "Reason", "What to do"]}>
            {realExceptions.map((e) => (
              <tr key={e.agreementId + e.code}>
                <Td>{e.unitNumber}</Td>
                <Td>{e.partyName}</Td>
                <Td><Badge tone="amber">{EXCEPTION_LABELS[e.code]}</Badge></Td>
                <Td wrap className="text-slate-700">
                  {e.message} <Link href={`/agreements/${e.agreementId}`} className="text-primary-600 hover:underline">Open agreement</Link>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {preview && preview.reviews.length > 0 && (
        <Card title="Needs review — missing agreed terms (not invented)" className="mt-6">
          <Table head={["Unit", "Account", "What is missing"]}>
            {preview.reviews.map((r) => (
              <tr key={r.agreementId}>
                <Td>{r.unitNumber}</Td>
                <Td>{r.partyName}</Td>
                <Td wrap className="text-slate-700">
                  {r.message} <Link href={`/agreements/${r.agreementId}`} className="text-primary-600 hover:underline">Open agreement</Link>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Card title="Billing run history" className="mt-6">
        <Table head={["Month", "Issued", "Invoices", "Held for review"]} empty="No billing runs yet.">
          {runs.map((r) => (
            <tr key={r.id}>
              <Td>{formatMonth(fromDbDate(r.periodStart))}</Td>
              <Td>{formatDateTime(r.issuedAt)}</Td>
              <Td>{r.invoiceCount}</Td>
              <Td>{r.skippedCount}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

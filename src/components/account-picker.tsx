"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Select } from "@/components/forms";
import { centsToDecimalString, formatMoney, type Cents } from "@/lib/money";
import { formatDate, type ISODate } from "@/lib/dates";
import { chooseUnit, type AccountContext, type ContextUnit } from "@/lib/account-context";

type Option = { value: string; label: string };
type Lookup = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: AccountContext };

const AGREEMENT_LABELS = { RENTAL: "Rental agreement", OWNERSHIP: "Ownership record", MANAGEMENT: "Management agreement" } as const;

/**
 * Loads an account's units and agreed terms on a date (GET /api/accounts/[id]/context). A newer
 * account or date cancels the older request, so a slow reply never overwrites the latest choice.
 */
export function useAccountContext(partyId: string, on: ISODate): Lookup {
  const [lookup, setLookup] = useState<{ key: string; value: Lookup }>({ key: "", value: { status: "idle" } });
  const key = partyId ? `${partyId}|${on}` : "";
  useEffect(() => {
    if (!key) return;
    const ctrl = new AbortController();
    fetch(`/api/accounts/${encodeURIComponent(partyId)}/context?on=${on}`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        setLookup({ key, value: r.ok ? { status: "ready", data: body as AccountContext } : { status: "error", message: body.error ?? "The account's details could not be loaded." } });
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setLookup({ key, value: { status: "error", message: e instanceof Error ? e.message : "The account's details could not be loaded." } });
      });
    return () => ctrl.abort();
  }, [key, partyId, on]);
  if (!key) return { status: "idle" };
  return lookup.key === key ? lookup.value : { status: "loading" };
}

/** The agreed terms of one unit: agreement, rent or management fee, and approved charges listed apart. */
export function UnitTerms({ unit, on, amountsShown }: { unit: ContextUnit; on: ISODate; amountsShown: boolean }) {
  const ag = unit.agreement;
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm" data-unit-terms={unit.unitId}>
      <dt className="text-muted">Agreement</dt>
      <dd className="text-ink">
        {ag ? (
          <>
            <Link href={`/agreements/${ag.id}`} className="text-primary-600 hover:underline">{AGREEMENT_LABELS[ag.type]}</Link>
            {ag.reference ? ` · ${ag.reference}` : ""} · {formatDate(ag.startDate)} – {ag.endDate ? formatDate(ag.endDate) : "open-ended"}
            {!unit.inForce && <span className="text-amber-700">{` · not in force on ${formatDate(on)}`}</span>}
          </>
        ) : (
          "—"
        )}
      </dd>
      {amountsShown && (
        <>
          <dt className="text-muted">Agreed rent</dt>
          <dd className="font-medium text-ink tabular-nums" data-rent>
            {unit.rent ? `${formatMoney(unit.rent.amount)} / month` : <span className="font-normal text-muted">{unit.inForce ? "None — this account pays no rent on this unit" : "No rental agreement in force"}</span>}
          </dd>
          {unit.deposit != null && (
            <>
              <dt className="text-muted">Deposit (agreed)</dt>
              <dd className="text-ink tabular-nums" data-deposit>{formatMoney(unit.deposit)} <span className="text-muted">— agreed, not invoiced or received</span></dd>
            </>
          )}
          {unit.managementFee && (
            <>
              <dt className="text-muted">Management fee</dt>
              <dd className="font-medium text-ink tabular-nums" data-management-fee>
                {unit.managementFee.amount == null ? <span className="font-normal text-amber-700">Not recorded — flagged for review, not billed</span> : `${formatMoney(unit.managementFee.amount)} / month`}
              </dd>
            </>
          )}
          {unit.charges.length > 0 && (
            <>
              <dt className="text-muted">Other charges</dt>
              <dd className="text-ink">{unit.charges.map((c) => `${c.description} ${formatMoney(c.amount)}`).join(" · ")} <span className="text-muted">/ month, billed separately</span></dd>
            </>
          )}
        </>
      )}
    </dl>
  );
}

function LookupStatus({ lookup }: { lookup: Lookup }) {
  if (lookup.status === "loading")
    return (
      <p className="flex items-center gap-2 text-sm text-muted" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Looking up the account&apos;s units and agreements…
      </p>
    );
  if (lookup.status === "error") return <p className="text-sm text-red-700" role="alert">{lookup.message}</p>;
  return null;
}

/**
 * Account and unit for a record that belongs to one account's unit (e.g. a manual invoice). Choosing
 * the account fills in the unit and its agreement when the agreements in force on `on` point to exactly
 * one unit; otherwise it offers only that account's units. Submits partyId, unitId and agreementId;
 * the server checks that they belong together.
 */
export function AccountUnitPicker({ parties, on, defaultPartyId = "", invoiceTotal }: { parties: Option[]; on: ISODate; defaultPartyId?: string; invoiceTotal?: Cents }) {
  const [partyId, setPartyId] = useState(defaultPartyId);
  const [picked, setPicked] = useState<{ partyId: string; unitId: string }>({ partyId: "", unitId: "" });
  const lookup = useAccountContext(partyId, on);
  const data = lookup.status === "ready" ? lookup.data : null;
  const choice = data ? chooseUnit(data) : null;
  // A unit chosen for another account is never kept (stale values are cleared with the account).
  const chosenId = choice?.kind === "one" ? choice.unit.unitId : picked.partyId === partyId ? picked.unitId : "";
  const options = choice?.kind === "many" || choice?.kind === "notInForce" ? choice.units : [];
  const unit = choice?.kind === "one" ? choice.unit : options.find((u) => u.unitId === chosenId) ?? null;

  return (
    <div className="space-y-3" data-account-picker>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <AccountSelect parties={parties} value={partyId} onChange={setPartyId} />
        {choice?.kind === "many" || choice?.kind === "notInForce" ? (
          <Select
            label="Unit"
            name="unitId"
            required
            placeholder={choice.kind === "many" ? "Choose one of this account's units" : "Choose a unit (no agreement in force)"}
            options={options.map((u) => ({ value: u.unitId, label: u.inForce ? `${u.unitNumber}` : `${u.unitNumber} (agreement not in force)` }))}
            value={chosenId}
            onChange={(e) => setPicked({ partyId, unitId: e.target.value })}
            hint={choice.kind === "many" ? "This account has agreements on several units." : `None of this account's agreements is in force on ${formatDate(on)}.`}
          />
        ) : (
          <div>
            <p className="block text-sm font-medium text-slate-700">Unit</p>
            <p className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" data-unit-display>
              {choice?.kind === "one" ? `${choice.unit.unitNumber} (from the account's agreement)` : partyId ? (choice?.kind === "none" ? "No unit: this account has no agreement" : "…") : "Choose an account first"}
            </p>
            {choice?.kind === "one" && <input type="hidden" name="unitId" value={choice.unit.unitId} />}
          </div>
        )}
      </div>
      {unit?.agreement && <input type="hidden" name="agreementId" value={unit.agreement.id} />}
      <LookupStatus lookup={lookup} />
      {choice?.kind === "none" && <p className="text-sm text-amber-800">This account has no agreement on any unit, so there is no unit or rent to fill in. Record its agreement first (Add account or New agreement).</p>}
      {data && (unit || data.balance) && (
        <div className="grid grid-cols-1 gap-x-8 gap-y-3 rounded-lg border border-line bg-surface/60 px-4 py-3 md:grid-cols-2">
          {unit && <UnitTerms unit={unit} on={on} amountsShown={data.amountsShown} />}
          {data.balance && <BalanceLines balance={data.balance} invoiceTotal={invoiceTotal} />}
        </div>
      )}
    </div>
  );
}

/**
 * Account selector with a search box (it narrows the list; the chosen account always stays listed).
 * Submits partyId.
 */
export function AccountSelect({ parties, value, onChange, label = "Account" }: { parties: Option[]; value: string; onChange: (id: string) => void; label?: string }) {
  const [q, setQ] = useState("");
  const shown = q.trim() ? parties.filter((p) => p.value === value || p.label.toLowerCase().includes(q.trim().toLowerCase())) : parties;
  return (
    <div>
      <Select label={label} name="partyId" required placeholder={shown.length ? "Choose an account" : "No account matches the search"} options={shown} value={value} onChange={(e) => onChange(e.target.value)} />
      {parties.length > 8 && (
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search accounts…"
          aria-label={`Search ${label.toLowerCase()}s`}
          className="mt-1.5 block w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none"
        />
      )}
    </div>
  );
}

/** Current balance, and with an invoice being written, that invoice and the balance once it is issued. */
function BalanceLines({ balance, invoiceTotal }: { balance: NonNullable<AccountContext["balance"]>; invoiceTotal?: Cents }) {
  const row = "flex justify-between gap-4";
  return (
    <dl className="space-y-1 text-sm" data-balance>
      <div className={row}><dt className="text-muted">Current outstanding balance</dt><dd className="font-medium text-ink tabular-nums" data-current-balance>{formatMoney(balance.outstanding)}</dd></div>
      {invoiceTotal != null && (
        <>
          <div className={row}><dt className="text-muted">This invoice</dt><dd className="font-medium text-ink tabular-nums" data-invoice-total>{formatMoney(invoiceTotal)}</dd></div>
          <div className={`${row} border-t border-line pt-1`}><dt className="text-muted">Outstanding once issued</dt><dd className="font-semibold text-navy-900 tabular-nums" data-projected-balance>{formatMoney(balance.outstanding + invoiceTotal)}</dd></div>
        </>
      )}
      {balance.unallocated > 0 && <div className={row}><dt className="text-muted">Unallocated payments (not deducted)</dt><dd className="font-medium text-emerald-700 tabular-nums">{formatMoney(balance.unallocated)}</dd></div>}
      <div className={row}><dt className="text-muted">Open invoices</dt><dd className="tabular-nums">{balance.openInvoices.length}</dd></div>
    </dl>
  );
}

/**
 * Read-only summary for records that belong to an account but not to a unit (e.g. a payment): the
 * account's units with agreements in force on `on`, their agreed terms, its balance and open invoices.
 * With `allocate`, each open invoice gets an amount to allocate (submitted as allocInvoiceId/allocAmount).
 */
export function AccountUnitsSummary({ partyId, on, allocate }: { partyId: string; on: ISODate; allocate?: { prefillInvoiceId?: string } }) {
  const lookup = useAccountContext(partyId, on);
  if (!partyId) return null;
  if (lookup.status !== "ready") return <LookupStatus lookup={lookup} />;
  const { data } = lookup;
  const choice = chooseUnit(data);
  const shown = choice.kind === "one" ? [choice.unit] : choice.kind === "many" ? choice.units : [];
  const open = data.balance?.openInvoices ?? [];
  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface/60 px-4 py-3" data-account-summary key={partyId}>
      <div className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">{shown.length === 1 ? `Unit ${shown[0].unitNumber}` : shown.length > 1 ? `${shown.length} units with agreements in force` : "No agreement in force"}</p>
          {shown.map((u) => (
            <div key={u.unitId} className={shown.length > 1 ? "border-t border-line pt-2" : ""}>
              {shown.length > 1 && <p className="text-xs font-semibold text-muted">Unit {u.unitNumber}</p>}
              <UnitTerms unit={u} on={on} amountsShown={data.amountsShown} />
            </div>
          ))}
          {shown.length === 0 && (
            <p className="text-sm text-amber-800">
              {choice.kind === "none" ? "This account has no agreement on any unit." : `None of this account's agreements is in force on ${formatDate(on)}; the payment can still be recorded and allocated to its invoices.`}
            </p>
          )}
        </div>
        {data.balance && <BalanceLines balance={data.balance} />}
      </div>
      {data.balance && (
        <div className="border-t border-line pt-3">
          <p className="mb-2 text-sm font-medium text-ink">{open.length ? "Outstanding invoices" : "No outstanding invoices"}</p>
          {open.length > 0 && (
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full text-sm" data-open-invoices>
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="px-1 py-1 font-medium">Invoice</th>
                    <th className="px-1 py-1 font-medium">Unit</th>
                    <th className="px-1 py-1 font-medium">Due</th>
                    <th className="px-1 py-1 text-right font-medium">Remaining</th>
                    {allocate && <th className="px-1 py-1 text-right font-medium">Allocate now (KES)</th>}
                  </tr>
                </thead>
                <tbody>
                  {open.map((i) => (
                    <tr key={i.id} className="border-t border-line">
                      <td className="px-1 py-1.5"><Link href={`/invoices/${i.id}`} className="text-primary-600 hover:underline">{i.number}</Link></td>
                      <td className="px-1 py-1.5">{i.unitNumber}</td>
                      <td className="px-1 py-1.5">{formatDate(i.dueDate)}</td>
                      <td className="px-1 py-1.5 text-right tabular-nums">{formatMoney(i.balance)}</td>
                      {allocate && (
                        <td className="px-1 py-1.5 text-right">
                          <input type="hidden" name="allocInvoiceId" value={i.id} />
                          <input
                            name="allocAmount"
                            inputMode="decimal"
                            defaultValue={allocate.prefillInvoiceId === i.id ? centsToDecimalString(i.balance) : ""}
                            placeholder="0.00"
                            aria-label={`Amount to allocate to ${i.number}`}
                            className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1 text-right text-sm shadow-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none"
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {allocate && open.length > 0 && <p className="mt-2 text-xs text-muted">Each amount reduces that invoice by exactly that much. Leave blank to keep the money unallocated; it can be allocated later on the payment.</p>}
        </div>
      )}
    </div>
  );
}

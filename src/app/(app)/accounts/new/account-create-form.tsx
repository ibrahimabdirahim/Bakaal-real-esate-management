"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { Building2, ChevronDown, FileSignature, Handshake, Info, KeyRound, Plus, Trash2, UserRound } from "lucide-react";
import { ActionForm, Select, SubmitButton, TextArea, TextInput } from "@/components/forms";
import { DocumentUploader } from "@/components/document-uploader";
import type { ActionState } from "@/server/action";
import { DuplicateError } from "../party-form";

type Option = { value: string; label: string };
type AccountType = "TENANT" | "OWNER" | "MANAGED";

const TYPES: { value: AccountType; title: string; text: string; icon: typeof UserRound }[] = [
  { value: "TENANT", title: "Rent-Paying Tenant", text: "Rental agreement and monthly rent.", icon: KeyRound },
  { value: "OWNER", title: "Purchased Unit Owner", text: "Ownership record only. Never charged rent.", icon: Building2 },
  { value: "MANAGED", title: "Purchased Unit Managed by BAKAAL", text: "Ownership plus a management agreement.", icon: Handshake },
];

const AGREEMENT_SUMMARY: Record<AccountType, string> = {
  TENANT: "Rental agreement: billed monthly from the start date, using only the terms entered here.",
  OWNER: "Ownership record: no rent and no rental agreement. It records the ownership as stated; it is not a verified title deed.",
  MANAGED: "Ownership record and management agreement: BAKAAL bills only the agreed management fee, never rent.",
};

/** Optional fields kept under "Additional Agreement Details", per account type (used to open it when one has an error or value). */
const ADDITIONAL_FIELDS: Record<AccountType, string[]> = {
  TENANT: ["lateFeeTerms", "allocationTerms", "agreementNotes"],
  OWNER: ["ownerDueDay", "ownershipNotes"],
  MANAGED: ["ownershipReference", "ownershipNotes", "mgmtDueDay", "mgmtGraceDays", "mgmtNotes"],
};
/** Charge rows are numbered charge{n}…; the numbers stay stable while rows are added and removed. */
const CHARGE_FIELD = /^charge(\d+)(Category|Description|Amount|From|To)$/;
const MAX_CHARGES = 20;

/** Approved service/shared charges as rows the user adds and removes (nothing is saved until Create Account). */
function ChargeRows({ val, initial }: { val: (k: string) => string; initial: number[] }) {
  const [rows, setRows] = useState<number[]>(initial.length ? initial : [0]);
  return (
    <>
      {rows.map((i, n) => (
        <div key={i} className="grid grid-cols-1 items-end gap-3 border-b border-line pb-3 last:border-0 last:pb-0 sm:grid-cols-[9rem_1fr_9rem] lg:grid-cols-[9rem_1fr_8.5rem_9rem_9rem_auto]">
          <Select
            label={`Charge ${n + 1}`}
            name={`charge${i}Category`}
            defaultValue={val(`charge${i}Category`) || "SERVICE_CHARGE"}
            options={[
              { value: "SERVICE_CHARGE", label: "Service charge" },
              { value: "SHARED_CHARGE", label: "Shared charge" },
            ]}
          />
          <TextInput label="Description" name={`charge${i}Description`} defaultValue={val(`charge${i}Description`)} placeholder="e.g. approved security levy" />
          <TextInput label="Monthly (KES)" name={`charge${i}Amount`} inputMode="decimal" defaultValue={val(`charge${i}Amount`)} />
          <TextInput label="From" name={`charge${i}From`} type="date" defaultValue={val(`charge${i}From`)} />
          <TextInput label="To (optional)" name={`charge${i}To`} type="date" defaultValue={val(`charge${i}To`)} />
          <button
            type="button"
            onClick={() => setRows(rows.filter((r) => r !== i))}
            aria-label={`Remove charge ${n + 1}`}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 shadow-sm hover:bg-red-50 hover:text-red-700"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      ))}
      {rows.length < MAX_CHARGES && (
        <button
          type="button"
          onClick={() => setRows([...rows, Math.max(-1, ...rows) + 1])}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <Plus className="size-4" aria-hidden /> Add charge
        </button>
      )}
    </>
  );
}

function Section({ icon: Icon, title, description, children }: { icon: typeof UserRound; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-white shadow-[var(--shadow-card)]">
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
      </div>
      <div className="space-y-5 p-5">{children}</div>
    </section>
  );
}

/**
 * Collapsed optional fields. Closing it only hides the fields, so entered values are kept and
 * still submitted. It opens itself when the last save reported an error or kept a value inside.
 */
function Collapsible({ title, children, attention, attentionKey }: { title: string; children: React.ReactNode; attention: boolean; attentionKey: unknown }) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<unknown>(null);
  const shown = open || (attention && dismissed !== attentionKey);
  return (
    <details
      className="group rounded-lg border border-line bg-slate-50/60"
      open={shown}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        if (now === shown) return;
        setOpen(now);
        if (!now) setDismissed(attentionKey);
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-slate-700 [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown className="size-4 shrink-0 text-muted transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-4 border-t border-line bg-white px-4 py-4">{children}</div>
    </details>
  );
}

const grid = "grid grid-cols-1 gap-4 sm:grid-cols-2";
const subheading = "col-span-full -mb-1 pt-1 text-xs font-semibold tracking-wide text-muted uppercase";

/**
 * Add Account: Account Information, then the Agreement Information for the chosen account
 * type. One "Create Account" saves the account and its agreement(s), approved charges and
 * documents in one transaction, or nothing (see createAccount).
 */
export function AccountCreateForm({
  action,
  units,
  canEditSensitive,
  maxBytes,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  units: Option[];
  canEditSensitive: boolean;
  maxBytes: number;
}) {
  const [type, setType] = useState<AccountType>("TENANT");
  const [switched, setSwitched] = useState(false);
  const owner = type !== "TENANT";
  return (
    <ActionForm action={action} className="space-y-5">
      {(state) => {
        const v = state?.values;
        const val = (k: string) => v?.[k] ?? "";
        const errors = state?.fieldErrors ?? {};
        const duplicates = state?.duplicates ?? [];
        // Field groups re-mount after a refused save so they show what was submitted; the type's
        // fields also re-mount when the type changes, so values meant for another type are never sent.
        const formKey = v ? JSON.stringify(v) : "new";
        const typeKey = `${type}-${formKey}`;
        const needsAttention = (names: string[]) => names.some((n) => errors[n] || val(n));
        // Charge rows that were submitted (so a refused save shows them again).
        const chargeKeys = [...new Set([...Object.keys(v ?? {}), ...Object.keys(errors)])].filter((k) => CHARGE_FIELD.test(k));
        const chargeRows = [...new Set(chargeKeys.map((k) => Number(k.match(CHARGE_FIELD)![1])))].sort((a, b) => a - b);
        return (
          <>
            <Section icon={UserRound} title="Account Information" description="Each person or company can have only one account.">
              <fieldset>
                <legend className="text-sm font-medium text-slate-700">
                  Account type<span className="text-red-600"> *</span>
                </legend>
                <div className="mt-1.5 grid grid-cols-1 gap-2.5 md:grid-cols-3">
                  {TYPES.map((t) => (
                    <label
                      key={t.value}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-500 ${type === t.value ? "border-primary-500 bg-primary-50/60 ring-1 ring-primary-500" : "border-line hover:border-primary-500/50"}`}
                    >
                      <input
                        type="radio"
                        name="accountType"
                        value={t.value}
                        checked={type === t.value}
                        onChange={() => {
                          setType(t.value);
                          setSwitched(true);
                        }}
                        className="sr-only"
                      />
                      <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${type === t.value ? "bg-primary-600 text-white" : "bg-primary-50 text-primary-600"}`}>
                        <t.icon className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink">{t.title}</span>
                        <span className="block text-xs leading-snug text-muted">{t.text}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div key={`account-${formKey}`} className={grid}>
                <div className="sm:col-span-2">
                  <TextInput label="Full name or registered business name" name="displayName" required defaultValue={val("displayName")} autoComplete="off" />
                </div>
                <TextInput label="Phone number" name="phone" type="tel" defaultValue={val("phone")} placeholder="e.g. 0712 345 678" />
                <TextInput label="E-mail address" name="email" type="email" defaultValue={val("email")} hint="Optional" />
                {canEditSensitive && (
                  <TextInput label="ID / passport or registration number" name="idNumber" defaultValue={val("idNumber")} hint="Sensitive: shown only to roles allowed to see it." />
                )}
              </div>

              <Collapsible title="Additional Account Details (Optional)" attention={needsAttention(["notes"])} attentionKey={state}>
                <div key={`account-more-${formKey}`}>
                  <TextArea label="Account notes" name="notes" defaultValue={val("notes")} />
                </div>
                {/* Not re-mounted, so uploaded files survive a refused save. */}
                <DocumentUploader
                  ownerType="PARTY"
                  maxBytes={maxBytes}
                  slots={[
                    { category: "ID_DOCUMENT", label: owner ? "Owner identification" : "Tenant identification", hint: "National ID, passport or company registration.", multiple: true },
                    { category: "PHOTO", label: owner ? "Owner photograph" : "Tenant / reference photograph", multiple: true },
                    { category: "OTHER", label: "Other supporting documents", multiple: true },
                  ]}
                />
              </Collapsible>
            </Section>

            <Section icon={FileSignature} title="Agreement Information" description="The main details of this account's agreement. It is linked to the new account automatically.">
              <p className="flex items-start gap-2 rounded-lg bg-primary-50/70 px-3 py-2 text-xs text-slate-700">
                <Info className="mt-px size-3.5 shrink-0 text-primary-600" aria-hidden />
                <span>
                  {AGREEMENT_SUMMARY[type]}
                  {switched && " Fields from the previous account type were cleared so they are not saved by mistake; the unit was kept."}
                </span>
              </p>

              {units.length === 0 ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  No units are registered yet. <Link href="/units/new" className="font-medium underline">Add a unit</Link> first: every account type is linked to a unit.
                </p>
              ) : (
                <>
                  <div className={grid}>
                    <Select
                      key={`unit-${formKey}`}
                      label="Unit"
                      name="unitId"
                      required
                      defaultValue={val("unitId")}
                      placeholder="Choose a unit"
                      options={units}
                      hint={type === "TENANT" ? "A unit already let for these dates is refused." : "A unit already recorded as owned for these dates is refused."}
                    />
                    <Fragment key={typeKey}>
                      {type === "TENANT" && (
                        <>
                          <TextInput label="Monthly rent (KES)" name="rentAmount" inputMode="decimal" required placeholder="25,000.00" defaultValue={val("rentAmount")} />
                          <TextInput
                            label="Deposit Amount (KES)"
                            name="depositAmount"
                            inputMode="decimal"
                            placeholder="Optional"
                            defaultValue={val("depositAmount")}
                            hint="Optional: the deposit agreed in the rental agreement. Recorded as an agreed amount only — it is not invoiced and not counted as received."
                          />
                          <TextInput label="Agreement start date" name="startDate" type="date" required defaultValue={val("startDate")} />
                          <TextInput label="Agreement end date" name="endDate" type="date" defaultValue={val("endDate")} hint="Leave empty if open-ended." />
                          <TextInput
                            label="Due day of the month"
                            name="dueDay"
                            inputMode="numeric"
                            placeholder="1–28"
                            defaultValue={val("dueDay")}
                            hint="The agreement's day takes precedence. If empty, the approved building policy applies; without one, billing holds it for review."
                          />
                          <TextInput label="Grace period (days)" name="graceDays" inputMode="numeric" defaultValue={val("graceDays")} hint="Only if the agreement states one; none is assumed." />
                          <TextInput label="Agreement reference" name="reference" defaultValue={val("reference")} placeholder="e.g. contract number" hint="Optional" />
                        </>
                      )}
                      {owner && (
                        <>
                          <TextInput
                            label="Ownership evidence"
                            name="ownershipEvidence"
                            required
                            defaultValue={val("ownershipEvidence")}
                            placeholder="e.g. sale agreement SA-0142"
                            hint="The document the ownership is recorded from. Not a verified title deed."
                          />
                          <TextInput label="Owner from" name="ownerFrom" type="date" required defaultValue={val("ownerFrom")} hint="When the ownership takes effect for the building." />
                          <TextInput label="Purchase date" name="purchaseDate" type="date" defaultValue={val("purchaseDate")} hint="Optional" />
                          {type === "OWNER" && <TextInput label="Ownership reference" name="ownershipReference" defaultValue={val("ownershipReference")} hint="Optional" />}
                        </>
                      )}
                      {type === "MANAGED" && (
                        <>
                          <p className={subheading}>Management agreement</p>
                          <TextInput label="Management start date" name="mgmtStartDate" type="date" required defaultValue={val("mgmtStartDate")} hint="On or after the ownership date." />
                          <TextInput label="Management end date" name="mgmtEndDate" type="date" defaultValue={val("mgmtEndDate")} hint="Leave empty if open-ended." />
                          <TextInput
                            label="Monthly management fee (KES)"
                            name="managementFee"
                            inputMode="decimal"
                            placeholder="5,000.00"
                            defaultValue={val("managementFee")}
                            hint="As agreed. If empty, it is flagged for review and nothing is billed."
                          />
                          <TextInput label="Management agreement reference" name="mgmtReference" defaultValue={val("mgmtReference")} hint="Optional" />
                        </>
                      )}
                    </Fragment>
                  </div>

                  <Collapsible
                    title="Additional Agreement Details (Optional)"
                    attention={needsAttention([...ADDITIONAL_FIELDS[type], ...chargeKeys.filter((f) => !f.endsWith("Category"))])}
                    attentionKey={state}
                  >
                    <div key={`more-${typeKey}`} className={grid}>
                      {type === "TENANT" && (
                        <>
                          <TextArea label="Late-fee terms (recorded only)" name="lateFeeTerms" defaultValue={val("lateFeeTerms")} hint="Late fees are not calculated by the system." />
                          <TextArea label="Payment-allocation terms (recorded only)" name="allocationTerms" defaultValue={val("allocationTerms")} />
                          <div className="sm:col-span-2">
                            <TextArea label="Agreement notes" name="agreementNotes" defaultValue={val("agreementNotes")} />
                          </div>
                        </>
                      )}
                      {type === "OWNER" && (
                        <>
                          <TextInput label="Due day for owner charges" name="ownerDueDay" inputMode="numeric" placeholder="1–28" defaultValue={val("ownerDueDay")} hint="Only needed if approved shared charges are billed." />
                          <div className="sm:col-span-2">
                            <TextArea label="Ownership notes" name="ownershipNotes" defaultValue={val("ownershipNotes")} />
                          </div>
                        </>
                      )}
                      {type === "MANAGED" && (
                        <>
                          <TextInput label="Ownership reference" name="ownershipReference" defaultValue={val("ownershipReference")} />
                          <TextInput label="Due day for the management fee" name="mgmtDueDay" inputMode="numeric" placeholder="1–28" defaultValue={val("mgmtDueDay")} hint="If empty, the approved building policy applies." />
                          <TextInput label="Grace period (days)" name="mgmtGraceDays" inputMode="numeric" defaultValue={val("mgmtGraceDays")} hint="Only if the agreement states one." />
                          <TextArea label="Ownership notes" name="ownershipNotes" defaultValue={val("ownershipNotes")} />
                          <div className="sm:col-span-2">
                            <TextArea label="Management terms and notes" name="mgmtNotes" defaultValue={val("mgmtNotes")} hint="Record the agreed fee basis if it is not a fixed monthly amount." />
                          </div>
                        </>
                      )}
                    </div>

                    <div key={`charges-${formKey}`} className="space-y-3">
                      <div>
                        <p className="text-sm font-medium text-slate-700">{type === "TENANT" ? "Approved service and shared charges" : "Approved shared charges"}</p>
                        <p className="text-xs text-muted">
                          Only charges already approved for this {type === "TENANT" ? "tenancy" : "unit"}; billed separately from {type === "MANAGED" ? "the management fee" : type === "TENANT" ? "rent" : "anything else"}. Add a row for each approved charge; blank rows are ignored.
                        </p>
                      </div>
                      <ChargeRows val={val} initial={chargeRows} />
                    </div>

                    {/* Not re-mounted after a refused save, so uploaded files are kept; a new type starts with its own documents. */}
                    <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">
                      <DocumentUploader
                        key={`agreement-${type}`}
                        ownerType="AGREEMENT"
                        name="agreementDocumentIds"
                        maxBytes={maxBytes}
                        slots={[
                          owner
                            ? { category: "SIGNED_AGREEMENT", label: "Ownership documents", hint: "Sale agreement, title or allocation letter. PDF, JPEG or PNG, stored privately.", multiple: true }
                            : { category: "SIGNED_AGREEMENT", label: "Signed rental agreement", hint: "PDF, JPEG or PNG, stored privately.", multiple: true },
                        ]}
                      />
                      {type === "MANAGED" && (
                        <DocumentUploader ownerType="AGREEMENT" name="managementDocumentIds" maxBytes={maxBytes} slots={[{ category: "SIGNED_AGREEMENT", label: "Signed management agreement", multiple: true }]} />
                      )}
                    </div>
                  </Collapsible>
                </>
              )}
            </Section>

            {duplicates.length > 0 ? (
              <DuplicateError duplicates={duplicates} isEdit={false} cancelHref="/accounts" />
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
                <Link href="/accounts" className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
                  Cancel
                </Link>
                <div className="[&>button]:px-6 [&>button]:py-2.5">
                  <SubmitButton>Create Account</SubmitButton>
                </div>
              </div>
            )}
          </>
        );
      }}
    </ActionForm>
  );
}

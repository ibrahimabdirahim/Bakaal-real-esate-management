"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { ActionForm, SubmitButton, inputClass, useFieldError } from "@/components/forms";
import type { ActionState } from "@/server/action";
import { UNIT_TYPES, matchUnitType } from "@/lib/unit-types";

type Unit = { unitNumber: string; floor: string | null; unitType: string | null; notes: string | null; isActive: boolean };

/**
 * What the unit's agreements say today. Occupancy belongs to agreements (DECISIONS C9, F27), so
 * the form shows it but never saves it; it changes through the agreement. Rent is set only on the agreement.
 */
export type UnitFacts = {
  occupancy: string;
  occupied: boolean;
};

/** One form row: label on the left on wide forms, above the field on narrow ones. */
function Row({ label, htmlFor, name, hint, required, children }: { label: string; htmlFor?: string; name?: string; hint?: ReactNode; required?: boolean; children: ReactNode }) {
  const error = useFieldError(name ?? "");
  const Label = htmlFor ? "label" : "p";
  return (
    <div className="grid grid-cols-1 gap-1.5 @2xl:grid-cols-[12rem_minmax(0,30rem)] @2xl:gap-x-8">
      <Label {...(htmlFor ? { htmlFor } : {})} className="text-sm font-medium text-ink @2xl:pt-2">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </Label>
      <div className="min-w-0">
        {children}
        {hint && !error && <div className="mt-1 text-xs text-muted">{hint}</div>}
        {error && (
          <p className="mt-1 flex items-center gap-1 text-xs text-red-700">
            <AlertCircle className="size-3.5" aria-hidden /> {error}
          </p>
        )}
      </div>
    </div>
  );
}

const field = inputClass.replace("mt-1.5 ", "");
/** A value shown like a field but not editable here. */
const readOnly = "block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600";

export function UnitForm({
  action,
  unit,
  facts,
  cancelHref,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  unit?: Unit;
  facts?: UnitFacts;
  cancelHref: string;
}) {
  return (
    <ActionForm action={action} className="@container">
      {(state) => {
        // After a refused save, show what was submitted rather than the saved values.
        const submitted = state?.values;
        const value = (key: "unitNumber" | "floor" | "unitType" | "notes") => (submitted ? (submitted[key] ?? "") : (unit?.[key] ?? ""));
        const savedType = unit?.unitType ?? null;
        return (
          <div key={submitted ? JSON.stringify(submitted) : "saved"}>
            <div className="space-y-5 py-5">
              <Row label="Unit ID/Name" htmlFor="unitNumber" name="unitNumber" required hint="Unique in the building, e.g. H1, A101 or Shop 01">
                <input id="unitNumber" name="unitNumber" required maxLength={30} defaultValue={value("unitNumber")} placeholder="e.g. H1" aria-invalid={!!state?.fieldErrors?.unitNumber} className={field} />
              </Row>
              <Row label="Floor (optional)" htmlFor="floor" name="floor">
                <input id="floor" name="floor" maxLength={30} defaultValue={value("floor")} placeholder="floor ..." className={field} />
              </Row>
              <Row label="Unit type (optional)" htmlFor="unitType" name="unitType">
                <select id="unitType" name="unitType" defaultValue={submitted ? value("unitType") : (matchUnitType(savedType) ?? savedType ?? "")} className={field}>
                  <option value="">Select unit type</option>
                  {UNIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  {/* A type saved before this list existed: one that matches a listed type selects it (saving stores the listed spelling); any other stays selectable, so saving the unit keeps it. */}
                  {savedType && !matchUnitType(savedType) && <option value={savedType}>{savedType}</option>}
                </select>
              </Row>

              <Row label="Occupancy" hint={facts ? "Follows the unit's agreements; it changes when an agreement starts or ends." : "A new unit is vacant until an agreement is recorded."}>
                <label className="inline-flex items-center gap-2 py-1.5 text-sm text-ink">
                  <input type="checkbox" checked={facts?.occupied ?? false} disabled readOnly className="size-4 rounded border-slate-300" />
                  Occupied
                  {facts && <span className="text-muted">({facts.occupancy})</span>}
                </label>
              </Row>

              <Row label="Tax Rate % (optional)" hint="No tax rates have been approved, so no tax is added to rent or invoices.">
                <p className={readOnly}>Not set up</p>
              </Row>

              <Row label="Notes (optional)" htmlFor="notes" name="notes">
                <textarea id="notes" name="notes" rows={4} maxLength={2000} defaultValue={value("notes")} placeholder="notes ..." className={field} />
              </Row>

              {unit && (
                <Row label="In use">
                  <label className="inline-flex items-center gap-2 py-1.5 text-sm text-ink">
                    <input type="checkbox" name="isActive" defaultChecked={submitted ? submitted.isActive === "on" : unit.isActive} className="size-4 rounded border-slate-300" />
                    Unit is in use (untick to retire it; history is kept)
                  </label>
                </Row>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
              <Link href={cancelHref} className="inline-flex items-center justify-center rounded-lg border border-primary-600 bg-white px-6 py-2 text-sm font-medium text-primary-700 hover:bg-primary-50">
                Cancel
              </Link>
              <SubmitButton>Save Unit</SubmitButton>
            </div>
          </div>
        );
      }}
    </ActionForm>
  );
}

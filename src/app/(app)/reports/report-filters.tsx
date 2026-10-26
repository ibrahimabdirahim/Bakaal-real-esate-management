"use client";

import Form from "next/form";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Download, Loader2, Play } from "lucide-react";
import { inputClass } from "@/components/forms";

type Option = { value: string; label: string };
export type FilterField = { name: string; label: string; type: "date" | "select" | "number"; options?: Option[]; placeholder?: string; required?: boolean; min?: number; max?: number };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 disabled:cursor-wait disabled:opacity-70">
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
      {pending ? "Running…" : "Submit"}
    </button>
  );
}

/**
 * The selected report's filters (F55). Submit reloads the report with them (a GET, so the page can
 * be bookmarked); while running, the button says so. Downloads use the filters of the results shown,
 * so a file always matches the screen: after a change, Submit first.
 */
export function ReportFilters({ report, fields, applied, downloadQuery, canDownload }: { report: string; fields: FilterField[]; applied: Record<string, string>; downloadQuery: string; canDownload: boolean }) {
  const [values, setValues] = useState(applied);
  const changed = fields.some((f) => (values[f.name] ?? "") !== (applied[f.name] ?? ""));
  const dl = "inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50";
  const off = "inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm font-medium text-slate-400";
  return (
    <Form action="/reports" className="space-y-4" data-report-filters>
      <input type="hidden" name="report" value={report} />
      <input type="hidden" name="run" value="1" />
      {fields.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {fields.map((f) => (
            <div key={f.name}>
              <label htmlFor={`f-${f.name}`} className="block text-sm font-medium text-slate-700">
                {f.label}
                {f.required && <span className="text-red-600"> *</span>}
              </label>
              {f.type === "select" ? (
                <select id={`f-${f.name}`} name={f.name} required={f.required} value={values[f.name] ?? ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} className={inputClass}>
                  <option value="">{f.placeholder ?? "All"}</option>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input id={`f-${f.name}`} name={f.name} type={f.type} required={f.required} min={f.min} max={f.max} value={values[f.name] ?? ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} className={inputClass} />
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Submit />
        {canDownload && !changed ? (
          <>
            <a href={`/reports/download?${downloadQuery}&format=pdf`} className={dl} data-download="pdf"><Download className="size-4" aria-hidden /> Download PDF</a>
            <a href={`/reports/download?${downloadQuery}&format=xlsx`} className={dl} data-download="xlsx"><Download className="size-4" aria-hidden /> Download Excel</a>
          </>
        ) : (
          <>
            <span className={off} aria-disabled="true"><Download className="size-4" aria-hidden /> Download PDF</span>
            <span className={off} aria-disabled="true"><Download className="size-4" aria-hidden /> Download Excel</span>
          </>
        )}
        {changed && <span role="status" className="text-sm text-amber-700" data-filters-changed>Filters changed — press Submit to update the results (and the downloads).</span>}
      </div>
    </Form>
  );
}

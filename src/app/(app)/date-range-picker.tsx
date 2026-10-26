"use client";

import { useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { formatDate } from "@/lib/dates";
import { inputClass } from "@/components/forms";

/**
 * The dashboard's date range: shows the period's dates and opens a start/end date form. Apply loads the
 * page with ?period=custom&from=…&to= (an ordinary GET form, so it also works without JavaScript; the
 * server checks the range again). Each date limits the other, so a start after the end cannot be chosen;
 * `max` is today in the building's time zone, from the server.
 */
export function DateRangePicker({
  from,
  to,
  min,
  max,
  action = "/",
  error,
  entered,
}: {
  from: string;
  to: string;
  min: string;
  max: string;
  action?: string;
  error?: string;
  entered?: { from: string; to: string };
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const [start, setStart] = useState(entered?.from ?? from);
  const [end, setEnd] = useState(entered?.to ?? to);
  const field = `${inputClass} mt-1`;
  return (
    <details ref={details} className="relative" open={!!error}>
      <summary
        aria-label={`Date range ${formatDate(from)} to ${formatDate(to)}. Choose dates`}
        className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink shadow-sm hover:bg-surface [&::-webkit-details-marker]:hidden"
      >
        <span className="tabular-nums">{`${formatDate(from)} – ${formatDate(to)}`}</span>
        <CalendarDays className="size-4 text-muted" aria-hidden />
      </summary>
      <form
        action={action}
        method="get"
        aria-label="Choose a date range"
        className="absolute right-0 z-20 mt-1 w-[min(20rem,calc(100vw-2rem))] space-y-3 rounded-lg border border-line bg-white p-4 text-left shadow-lg max-sm:fixed max-sm:inset-x-4 max-sm:w-auto"
      >
        <input type="hidden" name="period" value="custom" />
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-slate-700">
            Start date
            <input type="date" name="from" required min={min} max={end || max} value={start} onChange={(e) => setStart(e.target.value)} className={field} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            End date
            <input type="date" name="to" required min={start || min} max={max} value={end} onChange={(e) => setEnd(e.target.value)} className={field} />
          </label>
        </div>
        {error && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
        <p className="text-xs text-muted">Both days are included. Dates are in Nairobi time (EAT); the latest end date is today.</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setStart(from);
              setEnd(to);
              details.current?.removeAttribute("open");
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button type="submit" className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-primary-700">
            Apply
          </button>
        </div>
      </form>
    </details>
  );
}

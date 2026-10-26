"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

// Shown when a page fails to load. Details stay in the server log; nothing sensitive is shown.
export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto mt-10 max-w-lg rounded-xl border border-red-200 bg-white p-6 text-center shadow-[var(--shadow-card)]">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-red-50 text-red-600">
        <AlertTriangle className="size-6" aria-hidden />
      </span>
      <h1 className="mt-4 text-lg font-semibold text-navy-900">This page could not be loaded</h1>
      <p className="mt-1 text-sm text-slate-600">No changes were made. Try again; if the problem continues, contact a system administrator.</p>
      <button type="button" onClick={reset} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">
        <RotateCcw className="size-4" aria-hidden /> Try again
      </button>
    </div>
  );
}

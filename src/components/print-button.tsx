"use client";

import { Printer } from "lucide-react";

export function PrintButton({ label = "Print / save as PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="no-print inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
      <Printer className="size-4" aria-hidden /> {label}
    </button>
  );
}

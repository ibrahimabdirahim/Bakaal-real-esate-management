import { Download } from "lucide-react";
import { PrintButton } from "@/components/print-button";

/** Print and CSV export buttons for a report page. */
export function ReportActions({ exportHref }: { exportHref: string }) {
  return (
    <>
      <a href={exportHref} className="no-print inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
        <Download className="size-4" aria-hidden /> Export to Excel (CSV)
      </a>
      <PrintButton />
    </>
  );
}

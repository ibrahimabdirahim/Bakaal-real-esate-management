// One report, as the screen, the PDF and the Excel file all show it (F55): computed once on the
// server, then only laid out. Money is in cents, dates are ISO calendar dates (no time zone shift).
import { formatDate, type ISODate } from "@/lib/dates";
import { formatMoney, type Cents } from "@/lib/money";

export type ColumnType = "text" | "date" | "money" | "number" | "percent";
export type Cell = string | number | null;
export type ReportRow = Record<string, Cell>; // "_href": a link for the first column (screen only)

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}

export interface ReportSection {
  title: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals?: ReportRow;
  /** Shown instead of the table when there are no rows. */
  empty: string;
  note?: string;
}

export interface ReportDoc {
  key: string;
  title: string;
  /** e.g. "01 Oct 2026 – 23 Oct 2026" or "As at 23 Oct 2026". */
  period: string;
  filters: [string, string][];
  summary: { label: string; value: Cell; type: ColumnType; note?: string }[];
  sections: ReportSection[];
  notes: string[];
  /** When it was produced, in the building's time zone. */
  generatedAt: string;
}

/** A cell as text: money without the currency (the column says KES), dates as "05 Oct 2026", percent with one decimal. */
export function formatCell(value: Cell, type: ColumnType): string {
  if (value == null || value === "") return "—";
  switch (type) {
    case "money":
      return formatMoney(value as Cents).replace(/^KES\s?/, "").replace(/^-KES\s?/, "-");
    case "date":
      return formatDate(value as ISODate);
    case "percent":
      return `${(Math.round((value as number) * 1000) / 10).toFixed(1)}%`;
    case "number":
      return String(value);
    default:
      return String(value);
  }
}

/** A summary figure: money with KES. */
export function formatSummary(value: Cell, type: ColumnType): string {
  if (value == null) return "N/A";
  return type === "money" ? formatMoney(value as Cents) : formatCell(value, type);
}

// Salary payment arithmetic (pure). Amounts are integer cents.
//
// No payroll rules are approved: there is no automatic PAYE, NSSF, SHIF, housing levy or other
// statutory deduction, and no tax calculation. The user enters the gross salary and any
// allowances and deductions exactly as agreed; the system only adds them up:
//   net payable = gross + allowances − deductions.

import type { Cents } from "@/lib/money";
import { monthEnd, monthStart, type ISODate } from "@/lib/dates";

export interface SalaryAmounts {
  gross: Cents;
  allowances: Cents;
  deductions: Cents;
}

/** The net amount payable, or the reason the amounts cannot be accepted. */
export function netSalary(a: SalaryAmounts): { net: Cents } | { error: string } {
  for (const [label, v] of [["Gross salary", a.gross], ["Allowances", a.allowances], ["Deductions", a.deductions]] as const) {
    if (!Number.isSafeInteger(v) || v < 0) return { error: `${label} must be zero or a positive amount.` };
  }
  if (a.gross <= 0) return { error: "Gross salary must be more than zero." };
  const net = a.gross + a.allowances - a.deductions;
  if (net <= 0) return { error: "Deductions cannot equal or exceed the gross salary plus allowances." };
  return { net };
}

/** A salary period is one calendar month: from its first to its last day. */
export function salaryPeriod(month: ISODate): { start: ISODate; end: ISODate } {
  const start = `${month.slice(0, 7)}-01`;
  return { start, end: monthEnd(start) };
}

/** Whether a staff member was employed for at least part of the month. */
export function employedDuring(staff: { startDate: ISODate | null; endDate: ISODate | null }, month: ISODate) {
  const { start, end } = salaryPeriod(month);
  return (!staff.startDate || staff.startDate <= end) && (!staff.endDate || staff.endDate >= start);
}

/** Salaries can be recorded for the current month or earlier, never for a future month. */
export function isFutureMonth(month: ISODate, today: ISODate) {
  return salaryPeriod(month).start > monthStart(today);
}

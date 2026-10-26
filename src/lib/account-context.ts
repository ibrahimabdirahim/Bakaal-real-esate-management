// What an account's agreements say on a date, per unit: the shape returned by the account lookup
// (server) and the rule that decides when a form may fill in the unit by itself (client and tests).
import type { Cents } from "@/lib/money";
import type { ISODate } from "@/lib/dates";

export type ContextAgreement = {
  id: string;
  type: "RENTAL" | "OWNERSHIP" | "MANAGEMENT";
  status: "ACTIVE" | "ENDED";
  reference: string | null;
  startDate: ISODate;
  endDate: ISODate | null;
  inForce: boolean;
};

export type ContextUnit = {
  unitId: string;
  unitNumber: string;
  /** The account has an agreement on this unit in force on the date. */
  inForce: boolean;
  /**
   * The agreement billing uses for this account and unit (management, else rental, else ownership) in
   * force on the date; with none in force, the latest one (e.g. for a final settlement after it ended).
   */
  agreement: ContextAgreement | null;
  /** Agreed rent of a rental agreement in force on the date; null for owners, managed units and no agreement. */
  rent: { amount: Cents; agreementId: string } | null;
  /** Deposit agreed in that rental agreement (F52), shown for reference; never billed or counted as received. */
  deposit: Cents | null;
  /** Agreed management fee of a management agreement in force (amount null = not recorded, flagged for review). */
  managementFee: { amount: Cents | null; agreementId: string } | null;
  /** Approved recurring charges in force on the date, billed separately from rent or fee. */
  charges: { description: string; category: string; amount: Cents }[];
  agreements: ContextAgreement[];
};

/** The account balance (F49), only for roles that may see invoices: outstanding on issued invoices, unallocated money apart. */
export type ContextBalance = {
  outstanding: Cents;
  unallocated: Cents;
  openInvoices: { id: string; number: string | null; unitNumber: string; periodStart: ISODate | null; issueDate: ISODate | null; dueDate: ISODate | null; total: Cents; paid: Cents; credited: Cents; balance: Cents }[];
};

export type AccountContext = {
  party: { id: string; name: string; archived: boolean };
  on: ISODate;
  /** Amounts are left out (null / empty) for roles that may not see invoices. */
  amountsShown: boolean;
  units: ContextUnit[];
  balance?: ContextBalance | null;
};

export type UnitChoice =
  | { kind: "none" } // the account has no agreement on any unit
  | { kind: "one"; unit: ContextUnit } // exactly one unit with an agreement in force: filled in
  | { kind: "many"; units: ContextUnit[] } // several in force: the user chooses among them
  | { kind: "notInForce"; units: ContextUnit[] }; // agreements exist, none in force on the date: the user chooses

/** Fills in a unit only when the account's agreements in force on the date point to exactly one. */
export function chooseUnit(ctx: Pick<AccountContext, "units">): UnitChoice {
  const live = ctx.units.filter((u) => u.inForce);
  if (live.length === 1) return { kind: "one", unit: live[0] };
  if (live.length > 1) return { kind: "many", units: live };
  return ctx.units.length ? { kind: "notInForce", units: ctx.units } : { kind: "none" };
}

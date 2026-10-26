import type { ISODate } from "@/lib/dates";

export interface AgreementSpan {
  type: "RENTAL" | "OWNERSHIP" | "MANAGEMENT";
  status: "ACTIVE" | "ENDED" | "CANCELLED";
  startDate: ISODate;
  endDate: ISODate | null;
}

export type Occupancy = "VACANT" | "RENTED" | "OWNER_HELD" | "OWNER_MANAGED" | "RENTED_OWNER_UNIT";

export const OCCUPANCY_LABELS: Record<Occupancy, string> = {
  VACANT: "Vacant",
  RENTED: "Rented",
  OWNER_HELD: "Purchased (owner)",
  OWNER_MANAGED: "Purchased (managed by BAKAAL)",
  RENTED_OWNER_UNIT: "Rented (purchased unit)",
};

export function isInForce(a: AgreementSpan, on: ISODate): boolean {
  return a.status !== "CANCELLED" && a.startDate <= on && (a.endDate == null || a.endDate >= on);
}

/** A unit's status on a date, derived from its agreements (never stored separately). */
export function occupancyOn(agreements: AgreementSpan[], on: ISODate): Occupancy {
  const live = agreements.filter((a) => isInForce(a, on));
  const rental = live.some((a) => a.type === "RENTAL");
  const owned = live.some((a) => a.type === "OWNERSHIP");
  const managed = live.some((a) => a.type === "MANAGEMENT");
  if (rental) return owned ? "RENTED_OWNER_UNIT" : "RENTED";
  if (managed) return "OWNER_MANAGED";
  if (owned) return "OWNER_HELD";
  return "VACANT";
}

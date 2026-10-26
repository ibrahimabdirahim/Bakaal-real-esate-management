import type { Occupancy } from "@/server/services/occupancy";

export function occupancyTone(o: Occupancy) {
  return o === "VACANT" ? ("amber" as const) : o === "RENTED" || o === "RENTED_OWNER_UNIT" ? ("green" as const) : ("purple" as const);
}

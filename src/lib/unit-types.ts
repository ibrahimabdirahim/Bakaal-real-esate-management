/** The unit types offered on the unit form, in the order shown. A unit may also have no type. */
export const UNIT_TYPES = ["1 Bedroom", "2 Bedroom", "3 Bedroom", "4 Bedroom", "5 Bedroom", "Shop", "Store"] as const;

export type UnitType = (typeof UNIT_TYPES)[number];

export const isUnitType = (value: string): value is UnitType => (UNIT_TYPES as readonly string[]).includes(value);

/** The listed type a saved one stands for, ignoring case and spacing ("1 bedroom" → "1 Bedroom"), or null. */
export const matchUnitType = (value: string | null): UnitType | null =>
  UNIT_TYPES.find((t) => t.toLowerCase() === value?.trim().replace(/\s+/g, " ").toLowerCase()) ?? null;

/**
 * Why a unit type cannot be saved, or null when it can: blank or one of UNIT_TYPES. A type saved
 * before the list existed (`saved`) may be kept unchanged, so editing such a unit does not lose it.
 */
export function unitTypeProblem(value: string | null, saved: string | null = null): string | null {
  if (value === null || isUnitType(value) || value === saved) return null;
  return `Unit type must be one of: ${UNIT_TYPES.join(", ")} (or left blank).`;
}

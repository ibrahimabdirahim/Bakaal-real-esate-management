// Unit registration progress: how many of the building's physical units have been
// entered in the unit register. This is about data entry, not occupancy — a registered
// unit is vacant until an agreement says otherwise.

export const MAX_BUILDING_UNITS = 10000;

export type RegistrationProgress =
  | { configured: false; registered: number }
  | {
      configured: true;
      capacity: number;
      registered: number;
      /** Units still to enter; never negative (see `overBy`). */
      remaining: number;
      /** Registered units beyond the configured capacity (0 when within it). */
      overBy: number;
      /** registered ÷ capacity as a whole percentage; may exceed 100. */
      percent: number;
    };

export function registrationProgress(capacity: number | null, registered: number): RegistrationProgress {
  if (capacity == null) return { configured: false, registered };
  return {
    configured: true,
    capacity,
    registered,
    remaining: Math.max(capacity - registered, 0),
    overBy: Math.max(registered - capacity, 0),
    percent: Math.floor((registered / capacity) * 100),
  };
}

/** Why a capacity value is not acceptable, or null if it is. */
export function capacityProblem(value: number | null): string | null {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 1 || value > MAX_BUILDING_UNITS) return `Total units must be a whole number from 1 to ${MAX_BUILDING_UNITS}.`;
  return null;
}

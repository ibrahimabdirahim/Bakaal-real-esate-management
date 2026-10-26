import { describe, expect, it } from "vitest";
import { occupancyOn, type AgreementSpan } from "@/server/services/occupancy";

const span = (o: Partial<AgreementSpan>): AgreementSpan => ({ type: "RENTAL", status: "ACTIVE", startDate: "2026-01-01", endDate: null, ...o });

describe("occupancy", () => {
  it("is vacant with no agreement in force", () => {
    expect(occupancyOn([], "2026-11-01")).toBe("VACANT");
    expect(occupancyOn([span({ endDate: "2026-10-31", status: "ENDED" })], "2026-11-01")).toBe("VACANT");
    expect(occupancyOn([span({ status: "CANCELLED" })], "2026-11-01")).toBe("VACANT");
  });

  it("distinguishes rented, owner-held, managed, and rented purchased units", () => {
    expect(occupancyOn([span({})], "2026-11-01")).toBe("RENTED");
    expect(occupancyOn([span({ type: "OWNERSHIP" })], "2026-11-01")).toBe("OWNER_HELD");
    expect(occupancyOn([span({ type: "OWNERSHIP" }), span({ type: "MANAGEMENT" })], "2026-11-01")).toBe("OWNER_MANAGED");
    expect(occupancyOn([span({ type: "OWNERSHIP" }), span({ type: "MANAGEMENT" }), span({})], "2026-11-01")).toBe("RENTED_OWNER_UNIT");
  });

  it("keeps a former occupant's agreement in history without counting it", () => {
    expect(occupancyOn([span({ endDate: "2026-06-30", status: "ENDED" }), span({ startDate: "2026-07-01" })], "2026-05-01")).toBe("RENTED");
  });
});

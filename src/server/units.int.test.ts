import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { PermissionError } from "@/server/auth/actor";
import { getBuildingSettings, saveBuilding } from "@/server/services/admin";
import { createAgreement, createParty, createUnit, listUnits, unitRegistration, updateUnit, type AgreementInput } from "@/server/services/property";
import { dashboard } from "@/server/services/reports";

assertTestDatabase();

const admin = actor("ADMIN");
const manager = actor("MANAGER");
const finance = actor("FINANCE");
const operations = actor("OPERATIONS");
const auditor = actor("AUDITOR");

const unit = (unitNumber: string) => ({ unitNumber, floor: null, unitType: null, notes: null });

const rental: Omit<AgreementInput, "unitId" | "partyId"> = {
  type: "RENTAL", reference: null, startDate: "2026-01-01", endDate: null, rentAmount: 2500000, managementFeeAmount: null,
  dueDay: 5, graceDays: null, purchaseDate: null, ownershipEvidence: null, lateFeeTerms: null, allocationTerms: null, notes: null,
};

describe("building capacity", () => {
  beforeEach(async () => {
    await resetTestData();
  });

  it("shows 'not configured' rather than zeros when no capacity is set", async () => {
    await saveBuilding(admin, { name: "Test Building", address: null });
    await createUnit(manager, unit("A-1"));
    expect(await unitRegistration(auditor)).toEqual({ configured: false, registered: 1, retired: 0 });
  });

  it("returns nothing before a building exists", async () => {
    expect(await unitRegistration(admin)).toBeNull();
  });

  it("rejects zero, negative, fractional and absurd capacities at the service and database", async () => {
    await saveBuilding(admin, { name: "Test Building", address: null });
    for (const bad of [0, -3, 2.5, 10001]) {
      await expect(saveBuilding(admin, { name: "Test Building", address: null, totalUnits: bad })).rejects.toThrow(/whole number from 1/);
    }
    await expect(db.building.updateMany({ data: { totalUnits: 0 } })).rejects.toThrow(); // CHECK constraint
    expect((await getBuildingSettings(admin))?.totalUnits).toBeNull();
  });

  it("persists a valid capacity, keeps it when not submitted, clears it with null, and audits changes", async () => {
    await saveBuilding(admin, { name: "Test Building", address: null, totalUnits: 48 });
    expect((await db.building.findFirstOrThrow()).totalUnits).toBe(48); // fresh read = "after reload"
    await saveBuilding(admin, { name: "Renamed", address: "Nairobi" });
    expect((await getBuildingSettings(auditor))?.totalUnits).toBe(48);
    await saveBuilding(admin, { name: "Renamed", address: "Nairobi", totalUnits: 50 });
    const event = await db.auditEvent.findFirstOrThrow({ where: { action: "building.update" }, orderBy: { id: "desc" } });
    expect(event.before).toMatchObject({ totalUnits: 48 });
    expect(event.after).toMatchObject({ totalUnits: 50 });
    await saveBuilding(admin, { name: "Renamed", address: "Nairobi", totalUnits: null });
    expect((await db.building.findFirstOrThrow()).totalUnits).toBeNull();
  });

  it("allows only administrators to change the capacity", async () => {
    await saveBuilding(admin, { name: "Test Building", address: null, totalUnits: 20 });
    for (const who of [manager, finance, operations, auditor]) {
      await expect(saveBuilding(who, { name: "Test Building", address: null, totalUnits: 99 })).rejects.toBeInstanceOf(PermissionError);
    }
    expect((await db.building.findFirstOrThrow()).totalUnits).toBe(20);
  });

  it("calculates registered, remaining and progress; retired units are not counted", async () => {
    await saveBuilding(admin, { name: "Test Building", address: null, totalUnits: 10 });
    for (const n of ["A-1", "A-2", "A-3", "A-4"]) await createUnit(manager, unit(n));
    const retired = await createUnit(manager, unit("A-5"));
    await updateUnit(manager, retired.id, { ...unit("A-5"), isActive: false });
    expect(await unitRegistration(operations)).toEqual({ configured: true, capacity: 10, registered: 4, remaining: 6, overBy: 0, percent: 40, retired: 1 });
  });

  it("allows registering beyond capacity but reports it instead of a negative remaining count", async () => {
    await saveBuilding(admin, { name: "Test Building", address: null, totalUnits: 2 });
    for (const n of ["A-1", "A-2", "A-3"]) await createUnit(manager, unit(n));
    expect(await unitRegistration(manager)).toMatchObject({ registered: 3, remaining: 0, overBy: 1, percent: 150 });
    // Correction path: an administrator raises the total (or a mistaken unit is retired).
    await saveBuilding(admin, { name: "Test Building", address: null, totalUnits: 3 });
    expect(await unitRegistration(manager)).toMatchObject({ remaining: 0, overBy: 0, percent: 100 });
  });
});

describe("unit numbers", () => {
  beforeEach(async () => {
    await resetTestData();
    await saveBuilding(admin, { name: "Test Building", address: null, totalUnits: 10 });
  });

  it("refuses duplicates in the same building regardless of case or spaces", async () => {
    await createUnit(manager, unit("A-101"));
    await expect(createUnit(manager, unit("A-101"))).rejects.toThrow(/A-101 already exists in this building/);
    await expect(createUnit(manager, unit("a-101"))).rejects.toThrow(/registered as “A-101”/);
    await expect(createUnit(manager, unit(" a-101 "))).rejects.toThrow(/already exists/);
    expect(await db.unit.count()).toBe(1);
  });

  it("refuses renaming a unit to another unit's number, but allows changing its own case", async () => {
    const a = await createUnit(manager, unit("A-1"));
    await createUnit(manager, unit("A-2"));
    await expect(updateUnit(manager, a.id, { ...unit("a-2"), isActive: true })).rejects.toThrow(/already exists/);
    await updateUnit(manager, a.id, { ...unit("a-1"), isActive: true });
    expect((await db.unit.findUniqueOrThrow({ where: { id: a.id } })).unitNumber).toBe("a-1");
  });

  it("refuses a duplicate of a retired unit's number", async () => {
    const old = await createUnit(manager, unit("B-7"));
    await updateUnit(manager, old.id, { ...unit("B-7"), isActive: false });
    await expect(createUnit(manager, unit("b-7"))).rejects.toThrow(/retired unit/);
  });

  it("lets only one of simultaneous same-number submissions through (database index)", async () => {
    const results = await Promise.allSettled(["C-1", "c-1", "C-1 "].map((n) => createUnit(manager, unit(n.trim()))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((x) => x.status === "rejected")) expect(String((r as PromiseRejectedResult).reason)).toMatch(/already exists/);
    const building = await db.building.findFirstOrThrow();
    await expect(db.unit.create({ data: { buildingId: building.id, unitNumber: "C-1".toLowerCase() } })).rejects.toThrow();
  });
});

describe("registration is separate from occupancy", () => {
  beforeEach(async () => {
    await resetTestData();
    await saveBuilding(admin, { name: "Test Building", address: null, totalUnits: 10 });
  });

  it("registered units are vacant until an agreement applies; remaining-to-register is unaffected by lettings", async () => {
    const [u1] = await Promise.all(["A-1", "A-2", "A-3"].map((n) => createUnit(manager, unit(n))));
    let d = await dashboard(finance, "month");
    expect(d).toMatchObject({ totalUnits: 3, occupied: 0, vacant: 3 });
    expect((await listUnits(admin)).every((u) => u.occupancy === "VACANT")).toBe(true);
    expect(await unitRegistration(admin)).toMatchObject({ registered: 3, remaining: 7 });

    const tenant = await createParty(admin, { displayName: "Tenant", phone: null, email: null, idNumber: null, notes: null });
    await createAgreement(manager, { ...rental, unitId: u1.id, partyId: tenant.id });
    d = await dashboard(finance, "month");
    expect(d).toMatchObject({ totalUnits: 3, occupied: 1, vacant: 2 });
    expect(await unitRegistration(admin)).toMatchObject({ registered: 3, remaining: 7 }); // letting a unit does not change registration
  });
});

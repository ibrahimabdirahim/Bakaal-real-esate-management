-- Building capacity: the total physical number of units in the building, entered by an
-- administrator. NULL means "not configured yet"; it is never guessed or defaulted.
ALTER TABLE "Building" ADD COLUMN "totalUnits" INTEGER;
ALTER TABLE "Building" ADD CONSTRAINT "Building_totalUnits_positive" CHECK ("totalUnits" IS NULL OR "totalUnits" > 0);

-- Unit numbers are unique per building regardless of letter case or surrounding spaces
-- ("A-101" and " a-101" are the same unit). The exact-match unique key stays as well.
CREATE UNIQUE INDEX "Unit_buildingId_unitNumber_ci_key" ON "Unit" ("buildingId", lower(btrim("unitNumber")));

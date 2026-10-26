import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { unitRegistration } from "@/server/services/property";
import { Notice } from "@/components/ui";
import { UnitForm } from "../unit-form";
import { createUnitAction } from "../actions";
import { RegistrationProgress } from "../registration-progress";
import { Home } from "lucide-react";

export const metadata = { title: "Add unit" };

export default async function NewUnitPage() {
  const actor = await requirePage("units.manage");
  const registration = await unitRegistration(actor);
  const full = registration?.configured && registration.remaining === 0;
  return (
    <>
      <RegistrationProgress progress={registration} canConfigure={can(actor.role, "settings.manage")} canAddUnits={false} className="mb-6" />
      <section className="rounded-[var(--radius-card)] border border-line bg-white px-5 pb-5 shadow-[var(--shadow-card)] sm:px-6">
        <header className="flex items-center gap-4 border-b border-line py-5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
            <Home className="size-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-navy-900">Add Unit</h1>
            <p className="text-sm text-muted">Enter the unit details for this property.</p>
          </div>
        </header>
        {full && (
          <div className="pt-5">
            <Notice>Every unit in the building&apos;s total is already registered. You can still add this unit, but first check it is not a duplicate; the register will then show it as over capacity.</Notice>
          </div>
        )}
        <UnitForm action={createUnitAction} cancelHref="/units" />
      </section>
    </>
  );
}

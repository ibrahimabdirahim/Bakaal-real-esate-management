import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { findBuilding } from "@/server/services/common";
import { listUnits } from "@/server/services/property";
import { MAX_DOCUMENT_BYTES } from "@/server/storage";
import { OCCUPANCY_LABELS } from "@/server/services/occupancy";
import { Notice, PageHeader } from "@/components/ui";
import { NoBuilding } from "@/components/no-building";
import { createPartyAction } from "../actions";
import { AccountCreateForm } from "./account-create-form";

export const metadata = { title: "Add New Account" };

export default async function NewAccountPage() {
  const actor = await requirePage("accounts.manage");
  if (!(await findBuilding())) return <NoBuilding actor={actor} title="Add New Account" />;
  // Every account type creates an agreement, so both permissions are needed (administrators and building managers).
  const canCreateAgreement = can(actor.role, "agreements.manage");
  const units = canCreateAgreement && can(actor.role, "units.view") ? (await listUnits(actor)).filter((u) => u.isActive) : [];
  // Vacant units first; let units stay selectable for future-dated agreements (overlaps are refused on save).
  units.sort((a, b) => Number(a.occupancy !== "VACANT") - Number(b.occupancy !== "VACANT"));
  return (
    <>
      <PageHeader
        title="Add New Account"
        description="Register the account and its agreement together. Agreements can be viewed and managed later from the account."
        back={{ href: "/accounts", label: "Accounts" }}
      />
      <div className="max-w-4xl">
        {canCreateAgreement ? (
          <AccountCreateForm
            action={createPartyAction}
            units={units.map((u) => ({ value: u.id, label: `${u.unitNumber}${u.unitType ? ` — ${u.unitType}` : ""} (${OCCUPANCY_LABELS[u.occupancy].toLowerCase()})` }))}
            canEditSensitive={can(actor.role, "accounts.view_sensitive")}
            maxBytes={MAX_DOCUMENT_BYTES}
          />
        ) : (
          <Notice>Adding an account also records its agreement, which your role cannot do. Ask a building manager or an administrator.</Notice>
        )}
      </div>
    </>
  );
}

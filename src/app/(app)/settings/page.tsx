import Link from "next/link";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { getBuildingSettings } from "@/server/services/admin";
import { listPolicies } from "@/server/services/billing";
import { userNames } from "@/server/services/finance";
import { Badge, ButtonLink, Card, DescriptionList, Notice, PageHeader, Table, Td } from "@/components/ui";
import { ActionForm, SubmitButton, TextArea, TextInput } from "@/components/forms";
import { formatDate, formatDateTime, fromDbDate } from "@/lib/dates";
import { approvePolicyAction, proposePolicyAction, saveBuildingAction } from "./actions";
import { Settings } from "lucide-react";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const actor = await requirePage("settings.view");
  const building = await getBuildingSettings(actor);
  const policies = building ? await listPolicies(actor) : [];
  const names = await userNames(policies.flatMap((p) => [p.createdById, p.approvedById]));
  const manage = can(actor.role, "settings.manage");

  return (
    <>
      <PageHeader icon={Settings} title="Settings" actions={can(actor.role, "users.manage") ? <ButtonLink href="/settings/users">Staff accounts and roles</ButtonLink> : null} />

      <Card title="Building profile">
        {manage ? (
          <ActionForm action={saveBuildingAction}>
            <TextInput label="Building name" name="name" required defaultValue={building?.name ?? ""} />
            <TextArea label="Address" name="address" defaultValue={building?.address ?? ""} />
            <TextInput
              label="Total units in the building"
              name="totalUnits"
              inputMode="numeric"
              pattern="[0-9]*"
              defaultValue={building?.totalUnits?.toString() ?? ""}
              hint="The physical number of units the building has, whether or not they are registered or let yet. Used to show how many units are still to be added to the unit register. Leave blank if not known."
            />
            <p className="text-xs text-slate-500">Currency: KES. Time zone: Africa/Nairobi (dates such as &quot;today&quot; and month boundaries use this time zone).</p>
            <SubmitButton>{building ? "Save" : "Create building"}</SubmitButton>
          </ActionForm>
        ) : building ? (
          <DescriptionList
            items={[
              ["Name", building.name],
              ["Address", building.address],
              ["Total units in the building", building.totalUnits ?? "Not set"],
              ["Currency", building.currency],
              ["Time zone", building.timezone],
            ]}
          />
        ) : (
          <p className="text-sm text-slate-600">Not set up yet.</p>
        )}
      </Card>

      {building && (
        <Card title="Building-wide billing policies" className="mt-6">
          <Notice tone="blue">
            Approved policy order: the agreement&apos;s own term applies first. A building-wide policy applies only when the agreement is silent, and only once it has been
            explicitly approved and is effective. If neither gives a rule, the item is held for review. Proposing a policy has no effect until it is approved.
          </Notice>
          <div className="mt-4">
            <Table head={["Policy", "Value", "Effective from", "Proposed", "Approval", ...(can(actor.role, "policies.approve") ? [""] : [])]} empty="No building-wide policies. Agreements without a due day are held for review at billing.">
              {policies.map((p) => (
                <tr key={p.id}>
                  <Td>Default due day of the month</Td>
                  <Td>{p.value}</Td>
                  <Td>{formatDate(fromDbDate(p.effectiveFrom))}</Td>
                  <Td>{names.get(p.createdById ?? "") ?? "—"} · {formatDateTime(p.createdAt)}{p.note && <span className="block text-xs text-slate-500">{p.note}</span>}</Td>
                  <Td>{p.approvedAt ? <Badge tone="green">Approved by {names.get(p.approvedById ?? "") ?? "—"}</Badge> : <Badge tone="amber">Proposed — not in effect</Badge>}</Td>
                  {can(actor.role, "policies.approve") && (
                    <Td>
                      {!p.approvedAt && (
                        <ActionForm action={approvePolicyAction.bind(null, p.id)} className="">
                          <SubmitButton variant="secondary" confirm={`Approve default due day ${p.value} from ${fromDbDate(p.effectiveFrom)}? It will apply to every agreement without its own due day.`}>Approve</SubmitButton>
                        </ActionForm>
                      )}
                    </Td>
                  )}
                </tr>
              ))}
            </Table>
          </div>
          {manage && (
            <div className="mt-4 border-t border-slate-200 pt-4">
              <h3 className="mb-2 text-sm font-semibold">Propose a default due day</h3>
              <ActionForm action={proposePolicyAction}>
                <input type="hidden" name="key" value="DEFAULT_DUE_DAY" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <TextInput label="Day of month (1–28)" name="value" inputMode="numeric" required />
                  <TextInput label="Effective from" name="effectiveFrom" type="date" required />
                  <TextInput label="Note / approval reference" name="note" />
                </div>
                <SubmitButton variant="secondary">Propose policy</SubmitButton>
              </ActionForm>
            </div>
          )}
          <p className="mt-4 text-xs text-slate-500">
            Not configurable yet (business rules not approved): grace-period defaults, late fees, shared-expense allocation methods, overpayment treatment, deposits.
            {can(actor.role, "audit.view") && (
              <>
                See <Link href="/audit" className="underline">the audit log</Link> for every policy change.
              </>
            )}
          </p>
        </Card>
      )}
    </>
  );
}

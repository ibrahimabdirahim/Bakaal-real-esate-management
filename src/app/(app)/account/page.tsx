import { requireActor } from "@/server/auth/session";
import { ROLE_LABELS } from "@/server/auth/permissions";
import { Card, DescriptionList, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton, TextInput } from "@/components/forms";
import { changePasswordAction } from "../settings/actions";
import { UserRound } from "lucide-react";

export const metadata = { title: "My account" };

export default async function MyAccountPage() {
  const actor = await requireActor();
  return (
    <>
      <PageHeader icon={UserRound} title="My account" />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Profile">
          <DescriptionList items={[["Name", actor.name], ["E-mail", actor.email], ["Role", ROLE_LABELS[actor.role]]]} />
        </Card>
        <Card title="Change password">
          <ActionForm action={changePasswordAction}>
            <TextInput label="Current password" name="current" type="password" autoComplete="current-password" required />
            <TextInput label="New password" name="next" type="password" autoComplete="new-password" required minLength={12} hint="At least 12 characters." />
            <TextInput label="Repeat new password" name="confirm" type="password" autoComplete="new-password" required />
            <SubmitButton>Change password</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

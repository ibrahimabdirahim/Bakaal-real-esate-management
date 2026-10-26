"use client";

import { ActionForm, DeleteButton, SubmitButton } from "@/components/forms";
import { DocumentUploader, type UploadSlot } from "@/components/document-uploader";
import type { ActionState } from "@/server/action";
import type { DocumentOwnerType } from "@/lib/documents";

type Action = (s: ActionState, f: FormData) => Promise<ActionState>;

export function AddDocumentsForm({ action, ownerType, slots, maxBytes }: { action: Action; ownerType: DocumentOwnerType; slots: UploadSlot[]; maxBytes: number }) {
  return (
    <ActionForm action={action}>
      {(state) => (
        <>
          <DocumentUploader key={state?.values?.saved ?? "new"} ownerType={ownerType} slots={slots} maxBytes={maxBytes} />
          <SubmitButton variant="secondary">Attach documents</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function RemoveDocumentForm({ action, name }: { action: Action; name: string }) {
  // Removal is soft: the file and who removed it stay in the record's history (F31). One confirmation (F57).
  return (
    <ActionForm action={action} className="inline">
      <DeleteButton what={`document “${name}”`}>Remove</DeleteButton>
    </ActionForm>
  );
}

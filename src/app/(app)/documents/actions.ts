"use server";

import { runAction, type ActionState } from "@/server/action";
import { addDocuments, removeDocument, type DocumentOwner } from "@/server/services/documents";

/** Attaches the staged uploads submitted with the form to an existing record. */
export async function addDocumentsAction(ownerType: DocumentOwner, ownerId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const state = await runAction(async (actor) => {
    const ids = form.getAll("documentIds").map(String);
    const added = await addDocuments(actor, ownerType, ownerId, ids);
    return `${added.length} document${added.length === 1 ? "" : "s"} attached.`;
  });
  // A fresh value lets the upload area reset after a successful save.
  return state?.success ? { ...state, values: { saved: String(Date.now()) } } : state;
}

export async function removeDocumentAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    await removeDocument(actor, id, String(form.get("removeReason") ?? "") || null);
    return "Document removed. It is kept in the record's history.";
  });
}

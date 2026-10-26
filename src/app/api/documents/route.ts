import { getActor } from "@/server/auth/session";
import { BusinessError, PermissionError } from "@/server/auth/actor";
import { stageUpload, OWNER_RULES, CATEGORY_LABELS, type DocumentCategory, type DocumentOwner } from "@/server/services/documents";
import { MAX_DOCUMENT_BYTES } from "@/server/storage";
import { isSameOrigin } from "./same-origin";

// Stages one uploaded file (multipart field "file", plus "ownerType" and "category").
// The returned id is submitted with the record's form, which attaches the file.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Request refused." }, { status: 403 });
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Your session has ended. Please sign in again." }, { status: 401 });
  // Refuse oversized bodies before reading them (multipart adds a little overhead).
  if (Number(request.headers.get("content-length") ?? 0) > MAX_DOCUMENT_BYTES + 64 * 1024) {
    return Response.json({ error: `The file is larger than ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB.` }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "The upload could not be read." }, { status: 400 });
  }
  const file = form.get("file");
  const ownerType = String(form.get("ownerType") ?? "") as DocumentOwner;
  const category = String(form.get("category") ?? "") as DocumentCategory;
  if (!(file instanceof File)) return Response.json({ error: "Choose a file to upload." }, { status: 400 });
  if (!(ownerType in OWNER_RULES) || !(category in CATEGORY_LABELS)) return Response.json({ error: "Unknown document type." }, { status: 400 });
  try {
    const doc = await stageUpload(actor, { ownerType, category, fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    return Response.json(doc, { status: 201 });
  } catch (e) {
    if (e instanceof PermissionError) return Response.json({ error: "You do not have permission to add documents here." }, { status: 403 });
    if (e instanceof BusinessError) return Response.json({ error: e.message }, { status: 400 });
    console.error("Document upload failed", e);
    return Response.json({ error: "The file could not be saved. Please try again." }, { status: 500 });
  }
}

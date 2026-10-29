import { getActor } from "@/server/auth/session";
import { errorFields, log } from "@/server/log";
import { BusinessError } from "@/server/auth/actor";
import { discardStaged, documentForDownload } from "@/server/services/documents";
import { isSameOrigin } from "../same-origin";

// Permission-checked download. Unknown and forbidden documents both answer 404, so the
// existence of a document is not revealed. Files are never cached or served publicly.
export async function GET(request: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const actor = await getActor();
  if (!actor) return new Response("Not signed in", { status: 401 });
  const { id } = await ctx.params;
  let doc: Awaited<ReturnType<typeof documentForDownload>>;
  try {
    doc = await documentForDownload(actor, id);
  } catch (e) {
    // The record exists and may be seen, but its file could not be read (storage down, file missing):
    // say so and log it, instead of pretending the document does not exist.
    log("error", "Document download failed", { documentId: id, ...errorFields(e) });
    return new Response("The document could not be loaded right now. Please try again later.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!doc) return new Response("Not found", { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "1";
  const ascii = doc.name.replace(/[^\x20-\x7e]/g, "_");
  return new Response(new Uint8Array(doc.bytes), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Length": String(doc.bytes.byteLength),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}

/** Cancels the actor's own staged upload (removed from a form before saving). */
export async function DELETE(request: Request, ctx: RouteContext<"/api/documents/[id]">) {
  if (!isSameOrigin(request)) return Response.json({ error: "Request refused." }, { status: 403 });
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await ctx.params;
  try {
    await discardStaged(actor, id);
    return new Response(null, { status: 204 });
  } catch (e) {
    return Response.json({ error: e instanceof BusinessError ? e.message : "Could not remove the upload." }, { status: 400 });
  }
}

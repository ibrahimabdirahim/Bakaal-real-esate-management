import { Download, Eye, FileText, ImageIcon, Paperclip } from "lucide-react";
import type { Actor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { listDocuments, OWNER_RULES, type DocumentOwner } from "@/server/services/documents";
import { MAX_DOCUMENT_BYTES } from "@/server/storage";
import { Card, EmptyState } from "@/components/ui";
import type { UploadSlot } from "@/components/document-uploader";
import { CATEGORY_LABELS, formatBytes } from "@/lib/documents";
import { formatDateTime } from "@/lib/dates";
import { addDocumentsAction, removeDocumentAction } from "./actions";
import { AddDocumentsForm, RemoveDocumentForm } from "./document-forms";

/** Documents of one record: list with view/download links, add and remove (by permission). */
export async function DocumentsCard({
  actor,
  ownerType,
  ownerId,
  slots,
  closed = false,
  title = "Documents",
  className = "",
}: {
  actor: Actor;
  ownerType: DocumentOwner;
  ownerId: string;
  slots: UploadSlot[];
  /** No new documents (e.g. an archived account); existing ones stay visible. */
  closed?: boolean;
  title?: string;
  className?: string;
}) {
  if (!can(actor.role, OWNER_RULES[ownerType].view)) return null; // e.g. staff files are for staff managers only
  const { documents, history, canOpenHistory, hidden, canManage } = await listDocuments(actor, ownerType, ownerId);
  const allowed = slots.filter((s) => OWNER_RULES[ownerType].categories.includes(s.category));
  return (
    <Card title={<span className="flex items-center gap-2"><Paperclip className="size-4 text-primary-600" aria-hidden /> {title}</span>} className={className} description="Stored privately. Files open only for staff allowed to see this record.">
      {documents.length === 0 ? (
        <EmptyState icon={Paperclip}>{hidden ? "No documents you have access to." : "No documents attached yet."}</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {documents.map((d) => (
            <li key={d.id} className="py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                  {d.mimeType === "application/pdf" ? <FileText className="size-4" aria-hidden /> : <ImageIcon className="size-4" aria-hidden />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink" title={d.originalName}>{d.originalName}</p>
                  <p className="text-xs text-muted">{`${CATEGORY_LABELS[d.category]} · ${formatBytes(d.sizeBytes)} · ${formatDateTime(d.uploadedAt)}${d.uploadedBy ? ` · ${d.uploadedBy}` : ""}`}</p>
                </div>
                <a href={`/api/documents/${d.id}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-primary-600 hover:bg-primary-50">
                  <Eye className="size-4" aria-hidden /> View
                </a>
                <a href={`/api/documents/${d.id}?download=1`} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-primary-600 hover:bg-primary-50">
                  <Download className="size-4" aria-hidden /> Download
                </a>
              </div>
              {canManage && !closed && (
                <details className="mt-2 ml-12">
                  <summary className="cursor-pointer text-xs text-slate-500 hover:text-red-600">Remove…</summary>
                  <div className="mt-2">
                    <RemoveDocumentForm action={removeDocumentAction.bind(null, d.id)} name={d.originalName} />
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && documents.length > 0 && <p className="mt-2 text-xs text-muted">{`${hidden} restricted document(s) are not shown for your role.`}</p>}
      {history.length > 0 && (
        <details className="mt-4 rounded-lg border border-line px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">{`History: ${history.length} removed or replaced document(s)`}</summary>
          <ul className="mt-2 divide-y divide-line text-sm">
            {history.map((h) => (
              <li key={h.id} className="py-2">
                <p className="text-ink">
                  {canOpenHistory ? (
                    <a href={`/api/documents/${h.id}`} target="_blank" rel="noopener" className="text-primary-600 hover:underline">{h.originalName}</a>
                  ) : (
                    h.originalName
                  )}{" "}
                  <span className="text-xs text-muted">({CATEGORY_LABELS[h.category]})</span>
                </p>
                <p className="text-xs text-muted">{`Added ${formatDateTime(h.uploadedAt)}${h.uploadedBy ? ` by ${h.uploadedBy}` : ""} · removed ${formatDateTime(h.removedAt)}${h.removedBy ? ` by ${h.removedBy}` : ""}${h.removeReason ? ` — “${h.removeReason}”` : ""}`}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
      {canManage && !closed && allowed.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <AddDocumentsForm action={addDocumentsAction.bind(null, ownerType, ownerId)} ownerType={ownerType} slots={allowed} maxBytes={MAX_DOCUMENT_BYTES} />
        </div>
      )}
    </Card>
  );
}

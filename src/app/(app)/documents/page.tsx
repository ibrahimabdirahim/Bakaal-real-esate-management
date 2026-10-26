import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { RowActions } from "@/components/row-actions";
import { requireActor } from "@/server/auth/session";
import { OWNER_LABELS, searchDocuments } from "@/server/services/documents";
import { Card, FilterBar, FilterInput, FilterSelect, FilterSubmit, PageHeader, Pagination, Table, Td } from "@/components/ui";
import { CATEGORY_LABELS, formatBytes, type DocumentCategoryName, type DocumentOwnerType } from "@/lib/documents";
import { formatDateTime } from "@/lib/dates";
import { paginate, queryWithoutPage } from "@/lib/paginate";

export const metadata = { title: "Documents" };

/** Read-only index of the documents the signed-in user may see. Documents are added on their record's page. */
export default async function DocumentsPage({ searchParams }: PageProps<"/documents">) {
  const actor = await requireActor();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const category = typeof sp.category === "string" && sp.category in CATEGORY_LABELS ? (sp.category as DocumentCategoryName) : undefined;
  const ownerType = typeof sp.record === "string" && sp.record in OWNER_LABELS ? (sp.record as DocumentOwnerType) : undefined;
  const all = await searchDocuments(actor, { q: q || undefined, category, ownerType });
  const { items, ...pg } = paginate(all, sp.page);

  return (
    <>
      <PageHeader
        icon={FolderOpen}
        title="Documents"
        description="Every document you are allowed to see, with the record it belongs to. Files are stored privately; add or remove documents on the record's own page."
      />
      <Card>
        <FilterBar>
          <FilterInput label="Search" name="q" defaultValue={q} placeholder="File name, document type or record" />
          <FilterSelect label="Document type" name="category" defaultValue={category ?? ""} options={[{ value: "", label: "All" }, ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))]} />
          <FilterSelect label="Record" name="record" defaultValue={ownerType ?? ""} options={[{ value: "", label: "All" }, ...Object.entries(OWNER_LABELS).map(([value, label]) => ({ value, label }))]} />
          <FilterSubmit />
        </FilterBar>
        <Table head={["Document", "Type", "Belongs to", "Added", "Size", <span key="a" className="sr-only">Actions</span>]} empty="No documents match these filters.">
          {items.map((d) => (
            <tr key={d.id}>
              <Td wrap className="font-medium text-ink">{d.originalName}</Td>
              <Td>{CATEGORY_LABELS[d.category]}</Td>
              <Td wrap>
                <span className="block text-xs text-muted">{OWNER_LABELS[d.ownerType]}</span>
                {d.record ? <Link href={d.record.href} className="text-primary-600 hover:underline">{d.record.label}</Link> : "—"}
              </Td>
              <Td>
                {formatDateTime(d.uploadedAt)}
                {d.uploadedBy && <span className="block text-xs text-muted">{d.uploadedBy}</span>}
              </Td>
              <Td>{formatBytes(d.sizeBytes)}</Td>
              <Td className="w-px text-right">
                <RowActions
                  label={`Actions for ${d.originalName}`}
                  items={[
                    { label: "View document", href: `/api/documents/${d.id}` },
                    { label: "Download", href: `/api/documents/${d.id}?download=1` },
                    ...(d.record ? [{ label: `Open ${d.record.label}`, href: d.record.href }] : []),
                    // Documents are soft-removed with a reason on their record's page (F43); the file is kept for the record.
                    { label: "Remove or replace", unavailable: d.record ? "Done on the record it belongs to (Open above), with a reason; the file is kept for the record." : "Done on the record it belongs to, with a reason." },
                  ]}
                />
              </Td>
            </tr>
          ))}
        </Table>
        <Pagination {...pg} path="/documents" query={queryWithoutPage(sp)} />
      </Card>
    </>
  );
}

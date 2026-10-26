"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FileText, ImageIcon, Loader2, RefreshCw, TriangleAlert, Upload, X } from "lucide-react";
import { ACCEPT_ATTRIBUTE, ACCEPTED_EXTENSIONS, CATEGORY_LABELS, formatBytes, type DocumentCategoryName, type DocumentOwnerType } from "@/lib/documents";

export type UploadSlot = { category: DocumentCategoryName; label?: string; hint?: string; multiple?: boolean };

type Item = {
  key: string;
  slot: DocumentCategoryName;
  name: string;
  size: number;
  isImage: boolean;
  preview: string | null;
  progress: number;
  status: "uploading" | "done" | "error";
  error?: string;
  id?: string;
};

/**
 * Upload areas for one record. Each file is uploaded on its own (with progress) and staged
 * on the server; the form then submits only the staged ids in hidden `name` inputs, and the
 * server attaches them when it saves the record. Files can be removed or replaced before
 * saving; removing deletes the staged upload.
 */
export function DocumentUploader({
  ownerType,
  slots,
  maxBytes,
  name = "documentIds",
}: {
  ownerType: DocumentOwnerType;
  slots: UploadSlot[];
  maxBytes: number;
  name?: string;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const update = (key: string, patch: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const uploading = items.some((i) => i.status === "uploading");

  // Free preview object URLs when the component goes away.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => () => itemsRef.current.forEach((i) => i.preview && URL.revokeObjectURL(i.preview)), []);
  const counter = useRef(0);

  function upload(file: File, slot: DocumentCategoryName, replaceKey?: string) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const key = `file-${++counter.current}`;
    const isImage = file.type === "image/jpeg" || file.type === "image/png";
    const item: Item = { key, slot, name: file.name, size: file.size, isImage, preview: isImage ? URL.createObjectURL(file) : null, progress: 0, status: "uploading" };
    if (replaceKey) remove(replaceKey);
    if (!ACCEPTED_EXTENSIONS.includes(ext)) Object.assign(item, { status: "error", error: "Only PDF, JPEG and PNG files are accepted." });
    else if (file.size > maxBytes) Object.assign(item, { status: "error", error: `Larger than ${formatBytes(maxBytes)}.` });
    setItems((xs) => [...xs, item]);
    if (item.status === "error") return;

    const body = new FormData();
    body.append("file", file);
    body.append("ownerType", ownerType);
    body.append("category", slot);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/documents");
    xhr.upload.onprogress = (e) => e.lengthComputable && update(key, { progress: Math.round((e.loaded / e.total) * 100) });
    xhr.onload = () => {
      let data: { id?: string; error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON error page
      }
      if (xhr.status === 201 && data.id) update(key, { status: "done", progress: 100, id: data.id });
      else update(key, { status: "error", error: data.error ?? "Upload failed. Please try again." });
    };
    xhr.onerror = () => update(key, { status: "error", error: "Network error. Please try again." });
    xhr.send(body);
  }

  function remove(key: string) {
    setItems((xs) => {
      const it = xs.find((x) => x.key === key);
      if (it?.preview) URL.revokeObjectURL(it.preview);
      if (it?.id) void fetch(`/api/documents/${it.id}`, { method: "DELETE" }); // discard the staged upload
      return xs.filter((x) => x.key !== key);
    });
  }

  return (
    <div className="space-y-4">
      {slots.map((s) => (
        <Slot key={s.category} slot={s} items={items.filter((i) => i.slot === s.category)} onFiles={(files, replaceKey) => files.forEach((f) => upload(f, s.category, replaceKey))} onRemove={remove} maxBytes={maxBytes} />
      ))}
      {items.filter((i) => i.status === "done" && i.id).map((i) => (
        <input key={i.key} type="hidden" name={name} value={i.id} />
      ))}
      {uploading && (
        // Blocks submitting the form until every upload has finished.
        <input
          type="checkbox"
          required
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          onInvalid={(e) => e.currentTarget.setCustomValidity("Please wait until all files have finished uploading.")}
        />
      )}
    </div>
  );
}

function Slot({ slot, items, onFiles, onRemove, maxBytes }: { slot: UploadSlot; items: Item[]; onFiles: (f: File[], replaceKey?: string) => void; onRemove: (k: string) => void; maxBytes: number }) {
  const inputId = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<string | undefined>();
  const [drag, setDrag] = useState(false);
  const label = slot.label ?? CATEGORY_LABELS[slot.category];
  const full = !slot.multiple && items.length > 0;
  // Every slot accepts PDF, JPEG and PNG (ACCEPT_ATTRIBUTE); photographs are images by nature.
  const action = slot.category === "PHOTO" ? `Upload image${slot.multiple ? "s" : ""}` : "Upload PDF or image";
  const pick = (replaceKey?: string) => {
    setReplacing(replaceKey);
    picker.current?.click();
  };
  return (
    <div>
      <p className="text-sm font-medium text-slate-700">{label}</p>
      {slot.hint && <p className="text-xs text-slate-500">{slot.hint}</p>}
      <input
        ref={picker}
        id={inputId}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        multiple={slot.multiple && !replacing}
        className="sr-only"
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])], replacing);
          setReplacing(undefined);
          e.target.value = "";
        }}
      />
      {!full && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => pick()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const files = [...e.dataTransfer.files];
            onFiles(slot.multiple ? files : files.slice(0, 1));
          }}
          aria-label={`${action}: ${label}`}
          className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium shadow-sm transition ${drag ? "border-primary-500 bg-primary-50 text-primary-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
        >
          <Upload className="size-4 shrink-0 text-slate-500" aria-hidden />
          {action}
        </button>
        <span className="text-xs text-slate-500">{`PDF, JPEG or PNG · up to ${formatBytes(maxBytes)}${slot.multiple ? " each" : ""}`}</span>
        </div>
      )}
      {items.length > 0 && (
        <ul className="mt-2 space-y-2">
          {items.map((i) => (
            <li key={i.key} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${i.status === "error" ? "border-red-200 bg-red-50" : "border-line bg-white"}`}>
              {i.preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- local object-URL preview, not an optimisable asset
                <img src={i.preview} alt="" className="size-10 shrink-0 rounded object-cover" />
              ) : (
                <span className="flex size-10 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-500">
                  {i.isImage ? <ImageIcon className="size-5" aria-hidden /> : <FileText className="size-5" aria-hidden />}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink" title={i.name}>{i.name}</p>
                {i.status === "error" ? (
                  <p className="flex items-center gap-1 text-xs text-red-700">
                    <TriangleAlert className="size-3.5" aria-hidden /> {i.error}
                  </p>
                ) : i.status === "uploading" ? (
                  <div className="mt-1 flex items-center gap-2" aria-live="polite">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={i.progress} aria-label={`Uploading ${i.name}`}>
                      <div className="h-full bg-primary-600 transition-[width]" style={{ width: `${i.progress}%` }} />
                    </div>
                    <span className="text-xs text-muted tabular-nums">{`${i.progress}%`}</span>
                  </div>
                ) : (
                  <p className="text-xs text-emerald-700">{`Uploaded · ${formatBytes(i.size)} · saved when you submit the form`}</p>
                )}
              </div>
              {i.status === "uploading" ? (
                <Loader2 className="size-4 animate-spin text-muted" aria-label="Uploading" />
              ) : (
                <span className="flex shrink-0 gap-1">
                  {!slot.multiple && (
                    <button type="button" onClick={() => pick(i.key)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-ink" aria-label={`Replace ${i.name}`} title="Replace">
                      <RefreshCw className="size-4" aria-hidden />
                    </button>
                  )}
                  <button type="button" onClick={() => onRemove(i.key)} className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600" aria-label={`Remove ${i.name}`} title="Remove">
                    <X className="size-4" aria-hidden />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

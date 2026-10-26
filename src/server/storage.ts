// Private file storage for uploaded documents: a folder on the server's disk, outside
// `public/`, so files are reachable only through the permission-checked download route.
// Swappable later (e.g. for object storage) behind these four functions.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const ALLOWED_TYPES = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" } as const;
export type AllowedType = keyof typeof ALLOWED_TYPES;

/** Maximum upload size in bytes (DOCUMENT_MAX_MB, default 10 MB). */
export const MAX_DOCUMENT_BYTES = Math.round(Number(process.env.DOCUMENT_MAX_MB || 10) * 1024 * 1024);

/** The test database gets its own folder, so tests never touch real documents. */
function storageRoot(): string {
  if (process.env.DOCUMENT_STORAGE_DIR) return path.resolve(process.env.DOCUMENT_STORAGE_DIR);
  const db = new URL(process.env.DATABASE_URL ?? "postgres://x/none").pathname.slice(1);
  return path.join(process.cwd(), "storage", db.endsWith("_test") ? "test-documents" : "documents");
}

/** The real type from the file's first bytes; the browser's claimed type and the file name are not trusted. */
export function detectType(bytes: Uint8Array): AllowedType | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf"; // %PDF-
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  return null;
}

/** A display name with no path, control characters or quotes; never used to build a file path. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, "").replace(/\s+/g, " ").trim();
  return (cleaned || "document").slice(0, 120);
}

const KEY_PATTERN = /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.(pdf|jpg|png)$/;

function filePath(key: string): string {
  if (!KEY_PATTERN.test(key)) throw new Error("Invalid storage key.");
  const root = storageRoot();
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage key.");
  return full;
}

/** Writes the bytes under a new random key (written to a temporary file, then renamed). */
export async function storeFile(bytes: Uint8Array, type: AllowedType): Promise<{ key: string; sha256: string }> {
  const now = new Date();
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${ALLOWED_TYPES[type]}`;
  const full = filePath(key);
  await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
  const tmp = `${full}.partial`;
  await writeFile(tmp, bytes, { mode: 0o600, flag: "wx" });
  await rename(tmp, full);
  return { key, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function readStoredFile(key: string): Promise<Buffer> {
  return readFile(filePath(key));
}

/** Deletes a stored file (only for uploads that were never attached to a record). */
export async function deleteStoredFile(key: string): Promise<void> {
  await rm(filePath(key), { force: true });
}

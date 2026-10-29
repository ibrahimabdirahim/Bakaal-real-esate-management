// Private file storage for uploaded documents, behind four functions (store, read, delete, check):
//   DOCUMENT_STORAGE=local (default)  a folder on the server's disk, outside `public/`
//   DOCUMENT_STORAGE=s3               a private S3-compatible bucket (e.g. Cloudflare R2), see below
// Either way files are reachable only through the permission-checked download route: the bucket is
// never public and no link to it is ever given to a browser.
import { createHash, randomUUID } from "node:crypto";
import { access, constants, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";

export const ALLOWED_TYPES = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" } as const;
export type AllowedType = keyof typeof ALLOWED_TYPES;

/** Maximum upload size in bytes (DOCUMENT_MAX_MB, default 10 MB). */
export const MAX_DOCUMENT_BYTES = Math.round(Number(process.env.DOCUMENT_MAX_MB || 10) * 1024 * 1024);

/** Test databases keep their files apart (their own folder or key prefix), so tests never touch real documents. */
const forTests = () => new URL(process.env.DATABASE_URL ?? "postgres://x/none").pathname.slice(1).endsWith("_test");

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

function checkKey(key: string) {
  if (!KEY_PATTERN.test(key)) throw new Error("Invalid storage key.");
}

/** A new random key: year/month/uuid.ext. Never derived from user input. */
function newKey(type: AllowedType) {
  const now = new Date();
  return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${ALLOWED_TYPES[type]}`;
}

interface Driver {
  put(key: string, bytes: Uint8Array, type: AllowedType): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  check(): Promise<boolean>;
}

// ---------------------------------------------------------------- local disk

function storageRoot(): string {
  if (process.env.DOCUMENT_STORAGE_DIR) return path.resolve(process.env.DOCUMENT_STORAGE_DIR);
  return path.join(process.cwd(), "storage", forTests() ? "test-documents" : "documents");
}

function filePath(key: string): string {
  checkKey(key);
  const root = storageRoot();
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage key.");
  return full;
}

const localDriver: Driver = {
  async put(key, bytes) {
    const full = filePath(key);
    await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    const tmp = `${full}.partial`;
    await writeFile(tmp, bytes, { mode: 0o600, flag: "wx" }); // "wx": never overwrite
    await rename(tmp, full);
  },
  get: (key) => readFile(filePath(key)),
  remove: (key) => rm(filePath(key), { force: true }),
  async check() {
    try {
      const root = storageRoot();
      await mkdir(root, { recursive: true, mode: 0o700 });
      await access(root, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  },
};

// ---------------------------------------------------------------- S3-compatible bucket
//
// S3_ENDPOINT           https://<account-id>.r2.cloudflarestorage.com (no bucket name)
// S3_BUCKET             the private bucket
// S3_ACCESS_KEY_ID      an access key limited to that bucket (object read and write)
// S3_SECRET_ACCESS_KEY  its secret
// S3_REGION             "auto" for R2 (default), or the AWS region
// S3_PREFIX             key prefix inside the bucket (default "documents/"; "test-documents/" for test databases)

const S3_TIMEOUT_MS = 20_000;

export class StorageConfigError extends Error {}

function s3Config() {
  const missing = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter((k) => !process.env[k]);
  if (missing.length) throw new StorageConfigError(`Document storage is set to S3 but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set.`);
  const endpoint = new URL(process.env.S3_ENDPOINT!);
  if (endpoint.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(endpoint.hostname)) throw new StorageConfigError("S3_ENDPOINT must use https.");
  const prefix = process.env.S3_PREFIX ?? (forTests() ? "test-documents/" : "documents/");
  return {
    base: `${endpoint.origin}${endpoint.pathname.replace(/\/$/, "")}/${encodeURIComponent(process.env.S3_BUCKET!)}`,
    prefix,
    // Two quick retries for a passing 5xx/429 (the library's default of 10 would hold an upload for
    // many seconds during an outage); the request timeout below still caps the total.
    client: new AwsClient({ accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!, service: "s3", region: process.env.S3_REGION || "auto", retries: 2, initRetryMs: 100 }),
  };
}

function objectUrl(key: string) {
  const { base, prefix, client } = s3Config();
  const full = `${prefix}${key}`;
  return { client, url: `${base}/${full.split("/").map(encodeURIComponent).join("/")}` };
}

async function s3(key: string, init: RequestInit) {
  const { client, url } = objectUrl(key);
  return client.fetch(url, { ...init, signal: AbortSignal.timeout(S3_TIMEOUT_MS) });
}

const s3Driver: Driver = {
  async put(key, bytes, type) {
    checkKey(key);
    // If-None-Match: * — the bucket refuses to replace an existing object, so nothing is ever overwritten.
    const res = await s3(key, { method: "PUT", body: new Uint8Array(bytes), headers: { "Content-Type": type, "If-None-Match": "*" } });
    if (res.status === 412) throw new Error("A stored document with this key already exists; nothing was overwritten.");
    if (!res.ok) throw new Error(`Document storage refused the upload (HTTP ${res.status}).`);
  },
  async get(key) {
    checkKey(key);
    const res = await s3(key, { method: "GET" });
    if (res.status === 404) throw new Error("The stored file is missing.");
    if (!res.ok) throw new Error(`Document storage refused the download (HTTP ${res.status}).`);
    return Buffer.from(await res.arrayBuffer());
  },
  async remove(key) {
    checkKey(key);
    const res = await s3(key, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`Document storage refused the deletion (HTTP ${res.status}).`);
  },
  async check() {
    // A signed HEAD of a key that need not exist: 200 or 404 means the bucket answers and the key is accepted.
    try {
      const { client, url } = objectUrl("0000/00/00000000-0000-0000-0000-000000000000.pdf");
      const res = await client.fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
      return res.status === 200 || res.status === 404;
    } catch {
      return false;
    }
  },
};

function driver(): Driver {
  const kind = process.env.DOCUMENT_STORAGE ?? "local";
  if (kind === "s3") return s3Driver;
  if (kind === "local") return localDriver;
  throw new StorageConfigError(`DOCUMENT_STORAGE must be "local" or "s3", not "${kind}".`);
}

/** Which storage is configured (for the health check): "local" or "s3". */
export const storageKind = () => (process.env.DOCUMENT_STORAGE === "s3" ? "s3" : "local");

let lastCheck: { at: number; ok: boolean } | null = null;

/**
 * Whether documents can be saved: the folder is writable, or the bucket answers with valid credentials.
 * For the health check; the result is kept for a minute so frequent health checks cost almost nothing.
 */
export async function storageWritable(): Promise<boolean> {
  if (lastCheck && Date.now() - lastCheck.at < 60_000) return lastCheck.ok;
  let ok = false;
  try {
    ok = await driver().check();
  } catch {
    ok = false;
  }
  lastCheck = { at: Date.now(), ok };
  return ok;
}

/** For tests: forget the cached storage check. */
export function resetStorageCheck() {
  lastCheck = null;
}

/** Stores the bytes under a new random key; an existing file is never overwritten. */
export async function storeFile(bytes: Uint8Array, type: AllowedType): Promise<{ key: string; sha256: string }> {
  const key = newKey(type);
  await driver().put(key, bytes, type);
  return { key, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function readStoredFile(key: string): Promise<Buffer> {
  return driver().get(key);
}

/** Deletes a stored file (only for uploads that were never attached to a record). */
export async function deleteStoredFile(key: string): Promise<void> {
  await driver().remove(key);
}

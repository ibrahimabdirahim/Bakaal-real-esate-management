// Cloud document storage (S3-compatible, e.g. Cloudflare R2), against an in-memory test bucket: the
// same document workflow as on disk, files never overwritten, no record without its file and no file
// without its record, and failures reported instead of hidden.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { actor, assertTestDatabase, resetTestData } from "@/server/testing";
import { addDocuments, discardStaged, documentForDownload, stageUpload } from "@/server/services/documents";
import { createParty } from "@/server/services/property";
import { resetStorageCheck, storageWritable } from "@/server/storage";
import { startFakeS3, type FakeS3 } from "@/server/fake-s3";

assertTestDatabase();

const admin = actor("ADMIN");
const manager = actor("MANAGER");
const auditor = actor("AUDITOR");
const PDF = new TextEncoder().encode("%PDF-1.4\n% bakaal test\n%%EOF\n");
const KEY = "TESTACCESSKEY";
const ENV = ["DOCUMENT_STORAGE", "S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_REGION", "S3_PREFIX"] as const;

let s3: FakeS3;
const saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {};

beforeAll(async () => {
  for (const k of ENV) saved[k] = process.env[k];
  s3 = await startFakeS3(KEY);
});
afterAll(async () => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await s3.close();
});
beforeEach(async () => {
  await resetTestData();
  Object.assign(process.env, { DOCUMENT_STORAGE: "s3", S3_ENDPOINT: s3.endpoint, S3_BUCKET: s3.bucket, S3_ACCESS_KEY_ID: KEY, S3_SECRET_ACCESS_KEY: "test-secret", S3_REGION: "auto" });
  delete process.env.S3_PREFIX;
  s3.objects.clear();
  s3.requests.length = 0;
  s3.failWith = null;
  resetStorageCheck();
});

const stage = (who = manager) => stageUpload(who, { ownerType: "PARTY", category: "ID_DOCUMENT", fileName: "id.pdf", bytes: PDF });

describe("documents in an S3-compatible bucket", () => {
  it("stores, attaches and downloads a document through the permission-checked route only", async () => {
    const party = await createParty(admin, { displayName: "Bucket Tenant", phone: null, email: null, idNumber: null, notes: null });
    const doc = await stage();
    const row = await db.document.findUniqueOrThrow({ where: { id: doc.id } });
    // Under the test prefix, a random key, signed, and sent with "never overwrite".
    expect(row.storageKey).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);
    expect([...s3.objects.keys()]).toEqual([`test-documents/${row.storageKey}`]);
    expect(s3.requests.find((r) => r.method === "PUT")).toMatchObject({ signed: true, ifNoneMatch: "*" });
    await addDocuments(manager, "PARTY", party.id, [doc.id]);
    const file = (await documentForDownload(manager, doc.id))!;
    expect(Buffer.from(file.bytes).equals(Buffer.from(PDF))).toBe(true);
    expect(file.mimeType).toBe("application/pdf");
    // A role that may not see the account gets nothing (the route answers 404), and nothing is fetched.
    const before = s3.requests.length;
    expect(await documentForDownload(actor("OPERATIONS"), doc.id)).toBeNull();
    expect(s3.requests.length).toBe(before);
    await expect(stageUpload(auditor, { ownerType: "PARTY", category: "ID_DOCUMENT", fileName: "x.pdf", bytes: PDF })).rejects.toThrow(/permission/);
  });

  it("leaves no record when the bucket refuses the upload, and reports the failure", async () => {
    s3.failWith = 500;
    await expect(stage()).rejects.toThrow(/refused the upload/);
    expect(await db.document.count()).toBe(0);
  });

  it("removes the stored file when a staged upload is discarded", async () => {
    const doc = await stage();
    expect(s3.objects.size).toBe(1);
    await discardStaged(manager, doc.id);
    expect([s3.objects.size, await db.document.count()]).toEqual([0, 0]);
  });

  it("checks the file type and size before anything reaches the bucket", async () => {
    await expect(stageUpload(manager, { ownerType: "PARTY", category: "ID_DOCUMENT", fileName: "x.pdf", bytes: new TextEncoder().encode("not a pdf") })).rejects.toThrow(/Only PDF, JPEG and PNG/);
    expect(s3.requests).toHaveLength(0);
  });

  it("reports a missing stored file instead of returning an empty download", async () => {
    const party = await createParty(admin, { displayName: "Missing File", phone: null, email: null, idNumber: null, notes: null });
    const doc = await stage();
    await addDocuments(manager, "PARTY", party.id, [doc.id]);
    s3.objects.clear();
    await expect(documentForDownload(manager, doc.id)).rejects.toThrow(/missing/);
  });

  it("tells the health check whether the bucket answers with valid credentials", async () => {
    expect(await storageWritable()).toBe(true);
    process.env.S3_ACCESS_KEY_ID = "WRONGKEY";
    resetStorageCheck();
    expect(await storageWritable()).toBe(false);
    delete process.env.S3_BUCKET;
    resetStorageCheck();
    expect(await storageWritable()).toBe(false);
    await expect(stage()).rejects.toThrow(/S3_BUCKET is not set/);
  });
});

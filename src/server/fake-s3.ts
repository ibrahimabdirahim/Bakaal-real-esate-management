// Test double for S3-compatible document storage (tests only; never imported by the application).
// An in-memory private bucket on a local port: it refuses unsigned requests and other access keys,
// honours If-None-Match: * (no overwrites), and can be told to fail, to test failure handling.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeS3 {
  endpoint: string;
  bucket: string;
  objects: Map<string, { body: Buffer; type: string }>;
  requests: { method: string; key: string; ifNoneMatch: string | null; signed: boolean }[];
  /** When set, every request answers with this status (e.g. 500, to simulate an outage). */
  failWith: number | null;
  close(): Promise<void>;
}

export async function startFakeS3(accessKeyId: string, bucket = "bakaal-test"): Promise<FakeS3> {
  const fake: Omit<FakeS3, "endpoint" | "close"> = { bucket, objects: new Map(), requests: [], failWith: null };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://x");
      const [, b, ...rest] = url.pathname.split("/");
      const key = rest.map(decodeURIComponent).join("/");
      const auth = req.headers.authorization ?? "";
      const signed = auth.startsWith(`AWS4-HMAC-SHA256 Credential=${accessKeyId}/`) && /Signature=[0-9a-f]{64}$/.test(auth);
      fake.requests.push({ method: req.method ?? "", key, ifNoneMatch: (req.headers["if-none-match"] as string) ?? null, signed });
      if (!signed) return void res.writeHead(403).end("AccessDenied");
      if (b !== bucket) return void res.writeHead(404).end("NoSuchBucket");
      if (fake.failWith) return void res.writeHead(fake.failWith).end();
      const existing = fake.objects.get(key);
      switch (req.method) {
        case "PUT":
          if (req.headers["if-none-match"] === "*" && existing) return void res.writeHead(412).end("PreconditionFailed");
          fake.objects.set(key, { body: Buffer.concat(chunks), type: String(req.headers["content-type"] ?? "") });
          return void res.writeHead(200).end();
        case "GET":
        case "HEAD":
          if (!existing) return void res.writeHead(404).end();
          res.writeHead(200, { "Content-Type": existing.type });
          return void res.end(req.method === "GET" ? existing.body : undefined);
        case "DELETE":
          fake.objects.delete(key);
          return void res.writeHead(204).end();
        default:
          return void res.writeHead(405).end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  // The same object the server reads, so a test can switch failWith on and off.
  return Object.assign(fake, { endpoint: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) });
}

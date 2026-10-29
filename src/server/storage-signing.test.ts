import { describe, expect, it } from "vitest";
import { AwsV4Signer } from "aws4fetch";

// The request signing used for S3-compatible document storage must match AWS's own published examples
// (S3 docs, "Signature Version 4 — Examples"), so real buckets (R2, S3) accept our requests.
const EXAMPLE = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  service: "s3",
  region: "us-east-1",
  datetime: "20130524T000000Z",
  headers: { "x-amz-content-sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
};

const signature = async (url: string) => (await new AwsV4Signer({ ...EXAMPLE, url, method: "GET" }).sign()).headers.get("authorization")?.split("Signature=")[1];

describe("S3 request signing", () => {
  it("reproduces AWS's published GET Bucket Lifecycle signature", async () => {
    expect(await signature("https://examplebucket.s3.amazonaws.com/?lifecycle")).toBe("fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543");
  });
  it("reproduces AWS's published GET Bucket (List Objects) signature", async () => {
    expect(await signature("https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J")).toBe("34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  });
});

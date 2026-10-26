import { describe, expect, it } from "vitest";
import { detectType, safeFileName } from "./storage";

const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0]);

describe("file signature detection", () => {
  it("recognises PDF, PNG and JPEG by their first bytes", () => {
    expect(detectType(new TextEncoder().encode("%PDF-1.7\n..."))).toBe("application/pdf");
    expect(detectType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(detectType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
  });

  it("rejects everything else, whatever its name or claimed type", () => {
    expect(detectType(new TextEncoder().encode("<html><script>alert(1)</script>"))).toBeNull();
    expect(detectType(new TextEncoder().encode("MZ\x90\x00"))).toBeNull(); // Windows executable
    expect(detectType(bytes(0x47, 0x49, 0x46, 0x38))).toBeNull(); // GIF: not an approved format
    expect(detectType(new Uint8Array())).toBeNull();
  });
});

describe("safe file names", () => {
  it("strips paths, control characters and quotes", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\x\\ID card.pdf")).toBe("ID card.pdf");
    expect(safeFileName('a"b<c>.png')).toBe("abc.png");
    expect(safeFileName("\u0000\u0007")).toBe("document");
    expect(safeFileName("x".repeat(300))).toHaveLength(120);
  });
});

import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { reportXlsx } from "./xlsx";
import type { ReportDoc } from "@/lib/report-doc";

const sheetOf = (zip: Buffer) => {
  let i = 0;
  while (zip.readUInt32LE(i) === 0x04034b50) {
    const size = zip.readUInt32LE(i + 18), nameLen = zip.readUInt16LE(i + 26), extra = zip.readUInt16LE(i + 28);
    const name = zip.subarray(i + 30, i + 30 + nameLen).toString();
    if (name === "xl/worksheets/sheet1.xml") return inflateRawSync(zip.subarray(i + 30 + nameLen + extra, i + 30 + nameLen + extra + size)).toString();
    i += 30 + nameLen + extra + size;
  }
  return "";
};

describe("Excel export", () => {
  it("writes dates as the exact calendar day, money as two-decimal numbers, and formula-like text as text", () => {
    const doc: ReportDoc = {
      key: "t", title: "Test", period: "p", filters: [], summary: [], notes: [], generatedAt: "now",
      sections: [{ title: "Rows", empty: "", columns: [{ key: "d", label: "Date", type: "date" }, { key: "a", label: "Amount", type: "money" }, { key: "t", label: "Text", type: "text" }], rows: [{ d: "2024-02-29", a: 123456, t: "=HYPERLINK(\"x\")" }] }],
    };
    const sheet = sheetOf(reportXlsx(doc));
    expect(sheet).toContain("<v>45351</v>"); // 29 Feb 2024 in Excel's day count
    expect(sheet).toContain("<v>1234.56</v>");
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).toContain("=HYPERLINK(&quot;x&quot;)");
    expect(sheet).not.toContain("<f>");
  });
});

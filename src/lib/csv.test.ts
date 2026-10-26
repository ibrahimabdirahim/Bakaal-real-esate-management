import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/csv";

describe("CSV export cells", () => {
  it("keeps numbers as numbers, negative ones included", () => {
    expect(csvCell("-100.00")).toBe("-100.00");
    expect(csvCell("2500.5")).toBe("2500.5");
    expect(csvCell(0)).toBe("0");
  });

  it("neutralises text a spreadsheet would run as a formula", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+254 700")).toBe("'+254 700");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("quotes commas, quotes and line breaks, and leaves plain text alone", () => {
    expect(csvCell("Kamau, Peter")).toBe('"Kamau, Peter"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell("Unit A-101")).toBe("Unit A-101");
    expect(csvCell(null)).toBe("");
  });

  it("writes a UTF-8 file with a header row and CRLF line ends", () => {
    expect(toCsv(["A", "B"], [[1, "-5.00"]])).toBe("\uFEFFA,B\r\n1,-5.00\r\n");
  });
});

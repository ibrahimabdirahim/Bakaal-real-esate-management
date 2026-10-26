// Excel (.xlsx) of a ReportDoc (F55), written directly (no dependency): one sheet with the heading,
// filters, summary and each section. Amounts are numbers with two decimals, dates are date cells,
// percentages are percent cells; text is stored as text, so nothing typed in a record runs as a formula.
import { crc32, deflateRawSync } from "node:zlib";
import { centsToDecimalString } from "@/lib/money";
import type { Cell, ColumnType, ReportDoc } from "@/lib/report-doc";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
/** Excel's day number for a calendar date (1900 date system, as Excel counts it). */
const serial = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000 + 25569;

// Styles: 0 text, 1 bold, 2 money, 3 date, 4 percent, 5 bold money, 6 title, 7 number, 8 header (bold, grey)
const STYLE: Record<ColumnType, number> = { text: 0, money: 2, date: 3, percent: 4, number: 7 };

function cell(ref: string, value: Cell, type: ColumnType, bold = false): string {
  if (value == null || value === "") return "";
  if (type === "money" && typeof value === "number") return `<c r="${ref}" s="${bold ? 5 : 2}"><v>${centsToDecimalString(value)}</v></c>`;
  if (type === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return `<c r="${ref}" s="3"><v>${serial(value)}</v></c>`;
  if ((type === "percent" || type === "number") && typeof value === "number") return `<c r="${ref}" s="${STYLE[type]}"><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr" s="${bold ? 1 : 0}"><is><t xml:space="preserve">${esc(String(value))}</t></is></c>`;
}

export function reportXlsx(doc: ReportDoc): Buffer {
  const rows: string[] = [];
  let r = 0;
  const put = (cells: string[]) => {
    r += 1;
    rows.push(`<row r="${r}">${cells.join("")}</row>`);
  };
  const text = (i: number, s: string, style = 0) => `<c r="${colName(i)}${r + 1}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${esc(s)}</t></is></c>`;
  put([text(0, `BAKAAL — ${doc.title}`, 6)]);
  put([text(0, "Period", 1), text(1, doc.period)]);
  for (const [k, v] of doc.filters) put([text(0, k, 1), text(1, v)]);
  put([text(0, "Generated", 1), text(1, `${doc.generatedAt} (East Africa Time)`)]);
  put([]);
  for (const s of doc.summary) put([text(0, s.label, 1), cell(`B${r + 1}`, s.value, s.type), ...(s.note ? [text(2, s.note)] : [])]);
  let widest = 2;
  for (const sec of doc.sections) {
    put([]);
    put([text(0, sec.title, 1)]);
    if (!sec.rows.length) {
      put([text(0, sec.empty)]);
      continue;
    }
    widest = Math.max(widest, sec.columns.length);
    put(sec.columns.map((c, i) => text(i, c.label, 8)));
    for (const row of sec.rows) put(sec.columns.map((c, i) => cell(`${colName(i)}${r + 1}`, row[c.key] ?? null, c.type)));
    if (sec.totals) put(sec.columns.map((c, i) => cell(`${colName(i)}${r + 1}`, sec.totals![c.key] ?? null, c.type, true)));
    if (sec.note) put([text(0, sec.note)]);
  }
  if (doc.notes.length) put([]);
  for (const n of doc.notes) put([text(0, n)]);

  const cols = Array.from({ length: widest }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i === 0 ? 30 : 18}" customWidth="1"/>`).join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${rows.join("")}</sheetData></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd mmm yyyy"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F7"/></patternFill></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
</cellXfs></styleSheet>`;
  const name = esc(doc.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
  const files: [string, string][] = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", styles],
    ["xl/worksheets/sheet1.xml", sheet],
  ];
  return zip(files.map(([n, c]) => [n, Buffer.from(c, "utf8")]));
}

/** A minimal ZIP (deflate) — the container format of .xlsx. */
function zip(entries: [string, Buffer][]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const n = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, packed);
    centrals.push(central, n);
    offset += local.length + n.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

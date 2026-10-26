// PDF of a ReportDoc (F55), written directly (no dependency): A4 landscape, the standard Helvetica
// fonts, the same rows and totals as the screen, table headings repeated on each page, page numbers.
import { deflateSync } from "node:zlib";
import { formatCell, formatSummary, type ReportColumn, type ReportDoc, type ReportRow } from "@/lib/report-doc";

const W = 842;
const H = 595;
const M = 36;

// Helvetica character widths (1/1000 em), ASCII 32–126, from the standard font metrics.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const SPECIAL: Record<string, number> = { "–": 0x96, "—": 0x97, "·": 0xb7, "÷": 0xf7, "’": 0x92, "‘": 0x91, "“": 0x93, "”": 0x94, "…": 0x85, "€": 0x80 };

/** Text as WinAnsi bytes (what the standard fonts use); anything else becomes "?". */
function bytes(s: string): number[] {
  return [...s].map((ch) => {
    const c = ch.codePointAt(0)!;
    if (c >= 32 && c < 127) return c;
    if (SPECIAL[ch]) return SPECIAL[ch];
    if (c >= 0xa0 && c <= 0xff) return c;
    return 63;
  });
}
const width = (s: string, size: number, bold = false) => (bytes(s).reduce((t, b) => t + (b >= 32 && b < 127 ? HELV[b - 32] : 556), 0) * size * (bold ? 1.07 : 1)) / 1000;
const hex = (s: string) => `<${bytes(s).map((b) => b.toString(16).padStart(2, "0")).join("")}>`;
/** Cut text to fit a width, ending with "…". */
function fit(s: string, max: number, size: number, bold = false) {
  if (width(s, size, bold) <= max) return s;
  let t = s;
  while (t.length > 1 && width(`${t}…`, size, bold) > max) t = t.slice(0, -1);
  return `${t}…`;
}

class Pages {
  pages: string[][] = [[]];
  y = H - M;
  get ops() {
    return this.pages.at(-1)!;
  }
  newPage() {
    this.pages.push([]);
    this.y = H - M;
  }
  text(x: number, y: number, s: string, size: number, bold = false, gray = 0) {
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${gray} g ${x.toFixed(2)} ${y.toFixed(2)} Td ${hex(s)} Tj ET`);
  }
  rect(x: number, y: number, w: number, h: number, gray: number) {
    this.ops.push(`${gray} g ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }
  line(x1: number, y1: number, x2: number, y2: number, gray = 0.85) {
    this.ops.push(`${gray} G 0.5 w ${x1} ${y1.toFixed(2)} m ${x2} ${y2.toFixed(2)} l S`);
  }
}

const NUMERIC = new Set(["money", "number", "percent"]);

/** Column widths: fixed for numbers and dates, the rest shared by text columns; a smaller font if it does not fit. */
function layout(columns: ReportColumn[]) {
  const avail = W - 2 * M;
  for (const size of [8, 7.5, 7, 6.5, 6]) {
    const fixed = (c: ReportColumn) => (c.type === "money" ? 74 : c.type === "date" ? 58 : c.type === "percent" ? 52 : c.type === "number" ? 46 : 0) * (size / 8);
    const fixedTotal = columns.reduce((t, c) => t + fixed(c), 0);
    const texts = columns.filter((c) => !fixed(c));
    const each = texts.length ? (avail - fixedTotal) / texts.length : 0;
    if (!texts.length || each >= 60 * (size / 8) || size === 6) {
      const widths = columns.map((c) => fixed(c) || each);
      const scale = avail / widths.reduce((a, b) => a + b, 0);
      return { size, widths: widths.map((w) => w * scale) };
    }
  }
  throw new Error("unreachable");
}

export function reportPdf(doc: ReportDoc): Buffer {
  const p = new Pages();
  const need = (h: number, onBreak?: () => void) => {
    if (p.y - h < M + 18) {
      p.newPage();
      onBreak?.();
    }
  };
  // Heading
  p.text(M, p.y - 10, "BAKAAL Real Estate Management", 9, true, 0.35);
  p.y -= 30;
  p.text(M, p.y, doc.title, 16, true);
  p.y -= 16;
  p.text(M, p.y, `Period: ${doc.period}`, 9);
  p.y -= 12;
  for (const [k, v] of doc.filters) {
    p.text(M, p.y, fit(`${k}: ${v}`, W - 2 * M, 8), 8, false, 0.3);
    p.y -= 11;
  }
  p.text(M, p.y, `Generated ${doc.generatedAt} (East Africa Time)`, 8, false, 0.45);
  p.y -= 18;
  // Summary: label and value pairs, three per line
  if (doc.summary.length) {
    const colW = (W - 2 * M) / 3;
    doc.summary.forEach((s, i) => {
      const x = M + (i % 3) * colW;
      if (i % 3 === 0) need(24);
      p.text(x, p.y, fit(s.label, colW - 8, 7.5), 7.5, false, 0.4);
      p.text(x, p.y - 11, fit(formatSummary(s.value, s.type) + (s.note ? `  (${s.note})` : ""), colW - 8, 9), 9, true);
      if (i % 3 === 2 || i === doc.summary.length - 1) p.y -= 26;
    });
    p.y -= 6;
  }
  // Sections
  for (const s of doc.sections) {
    need(40);
    p.text(M, p.y, s.title, 11, true);
    p.y -= 8;
    if (!s.rows.length) {
      p.y -= 10;
      p.text(M, p.y, s.empty, 8, false, 0.4);
      p.y -= 18;
      continue;
    }
    const { size, widths } = layout(s.columns);
    const rowH = size + 6;
    const xs = widths.map((_, i) => M + widths.slice(0, i).reduce((a, b) => a + b, 0));
    const header = () => {
      p.rect(M, p.y - rowH, W - 2 * M, rowH, 0.93);
      s.columns.forEach((c, i) => {
        const label = fit(c.label, widths[i] - 6, size, true);
        const x = NUMERIC.has(c.type) ? xs[i] + widths[i] - 3 - width(label, size, true) : xs[i] + 3;
        p.text(x, p.y - rowH + 4, label, size, true, 0.25);
      });
      p.y -= rowH;
    };
    const row = (r: ReportRow, bold: boolean) => {
      need(rowH, header);
      s.columns.forEach((c, i) => {
        const v = r[c.key];
        if (v == null && bold) return;
        const t = fit(formatCell(v ?? null, c.type), widths[i] - 6, size, bold);
        const x = NUMERIC.has(c.type) ? xs[i] + widths[i] - 3 - width(t, size, bold) : xs[i] + 3;
        p.text(x, p.y - rowH + 4, t, size, bold);
      });
      p.line(M, p.y - rowH, W - M, p.y - rowH);
      p.y -= rowH;
    };
    header();
    s.rows.forEach((r) => row(r, false));
    if (s.totals) row(s.totals, true);
    if (s.note) {
      need(14);
      p.y -= 10;
      p.text(M, p.y, fit(s.note, W - 2 * M, 7), 7, false, 0.45);
    }
    p.y -= 20;
  }
  for (const n of doc.notes) {
    need(12);
    p.text(M, p.y, fit(n, W - 2 * M, 7), 7, false, 0.45);
    p.y -= 10;
  }
  // Footer with page numbers on every page
  const total = p.pages.length;
  p.pages.forEach((ops, i) => ops.push(`BT /F1 7 Tf 0.45 g ${M} 20 Td ${hex(`BAKAAL — ${doc.title} — ${doc.period}`)} Tj ET`, `BT /F1 7 Tf 0.45 g ${W - M - 50} 20 Td ${hex(`Page ${i + 1} of ${total}`)} Tj ET`));

  // Assemble the file
  const objects: Buffer[] = [];
  const add = (body: Buffer | string) => objects.push(typeof body === "string" ? Buffer.from(body, "latin1") : body) && objects.length;
  const catalog = add("<< /Type /Catalog /Pages 2 0 R >>");
  add(""); // pages, filled below
  const font = (base: string) => add(`<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`);
  const f1 = font("Helvetica");
  const f2 = font("Helvetica-Bold");
  const kids: number[] = [];
  for (const ops of p.pages) {
    const stream = deflateSync(Buffer.from(ops.join("\n"), "latin1"));
    const content = add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`, "latin1"), stream, Buffer.from("\nendstream", "latin1")]));
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`, "latin1");
  const info = add(`<< /Title ${hex(`${doc.title} — ${doc.period}`)} /Producer (BAKAAL) >>`);
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets: number[] = [];
  let length = parts[0].length;
  objects.forEach((body, i) => {
    offsets.push(length);
    const obj = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")]);
    parts.push(obj);
    length += obj.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${length}\n%%EOF\n`, "latin1"));
  return Buffer.concat(parts);
}

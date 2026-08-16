const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const PDFDocument = require("pdfkit");

const ROOT_DIR = path.join(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT_DIR, "data", "safe_docs");
const INDEX_DIR = path.join(ROOT_DIR, "data", "safe");
const INDEX_PATH = path.join(INDEX_DIR, "index.json");

const DOCS = [
  {
    id: "local-only-emp-layout-sample",
    fileName: "local-only-emp-layout-sample.pdf",
    title: "Local Only EMP Layout Sample",
    agency: "Self-authored test corpus",
    year: 2026,
    topics: ["layout-test", "emp-sample", "table", "figure"],
    sections: [
      {
        heading: "Purpose",
        body:
          "This self-authored test document is only for parser validation. It does not reproduce any external standard, manual, article, or official translation.",
      },
      {
        heading: "Point of Entry Test Language",
        body:
          "In this sample, point of entry means a generic boundary crossing used to test terminology retrieval. The sentence is invented for local software testing.",
      },
    ],
    tableTitle: "Table 1. Sample review matrix",
    tableRows: [
      ["Item", "Review question", "Expected JSON field"],
      ["Cable entry", "Is the crossing point identified?", "table.cells"],
      ["Ground bond", "Is a note attached to the row?", "paragraph.text"],
      ["Status", "Can the parser keep columns aligned?", "table.rows"],
    ],
    figureTitle: "Figure 1. Self-authored workflow diagram",
  },
  {
    id: "local-only-report-layout-sample",
    fileName: "local-only-report-layout-sample.pdf",
    title: "Local Only Report Layout Sample",
    agency: "Self-authored test corpus",
    year: 2026,
    topics: ["layout-test", "report-sample", "caption"],
    sections: [
      {
        heading: "Summary",
        body:
          "This document checks paragraph extraction, caption detection, page rendering, and simple figure extraction with content created specifically for this repository.",
      },
      {
        heading: "Checklist",
        body:
          "The parser should produce paragraphs, a table block, a figure block, and a block-search-index entry without depending on restricted source documents.",
      },
    ],
    tableTitle: "Table 1. Local verification checklist",
    tableRows: [
      ["Check", "Pass condition", "Note"],
      ["Paragraphs", "Text is grouped into readable blocks", "No external text"],
      ["Tables", "Rows and columns are preserved", "Synthetic data"],
      ["Figures", "Image path is generated", "Generated PNG"],
    ],
    figureTitle: "Figure 1. Synthetic verification image",
  },
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function makeDiagramPng(width, height, accent) {
  const rawRows = [];
  const rgb = hexToRgb(accent);
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 3;
      const box =
        (x > 36 && x < 180 && y > 45 && y < 120) ||
        (x > 250 && x < 395 && y > 45 && y < 120) ||
        (x > 465 && x < 610 && y > 45 && y < 120);
      const arrow = y > 78 && y < 88 && ((x > 180 && x < 250) || (x > 395 && x < 465));
      const line = x === 36 || x === 180 || x === 250 || x === 395 || x === 465 || x === 610 || y === 45 || y === 120;
      if (box || arrow || line) {
        row[offset] = rgb.r;
        row[offset + 1] = rgb.g;
        row[offset + 2] = rgb.b;
      } else {
        row[offset] = 248;
        row[offset + 1] = 250;
        row[offset + 2] = 252;
      }
    }
    rawRows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rawRows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function hexToRgb(hex) {
  const normalized = String(hex).replace("#", "");
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function drawTable(doc, x, y, widths, rowHeight, rows) {
  let cursorY = y;
  rows.forEach((row, rowIndex) => {
    let cursorX = x;
    row.forEach((cell, colIndex) => {
      doc.rect(cursorX, cursorY, widths[colIndex], rowHeight).stroke("#aab3c2");
      if (rowIndex === 0) {
        doc.rect(cursorX, cursorY, widths[colIndex], rowHeight).fillOpacity(0.1).fillAndStroke("#ffd24d", "#aab3c2").fillOpacity(1);
      }
      doc.fillColor("#1f2937").font(rowIndex === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
      doc.text(cell, cursorX + 6, cursorY + 8, {
        width: widths[colIndex] - 12,
        height: rowHeight - 10,
      });
      cursorX += widths[colIndex];
    });
    cursorY += rowHeight;
  });
  return cursorY;
}

function writePdf(spec, accent) {
  const pdfPath = path.join(OUT_DIR, spec.fileName);
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: spec.title, Author: "Self-authored test corpus" } });
  const out = fs.createWriteStream(pdfPath);
  doc.pipe(out);

  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(22).text(spec.title);
  doc.moveDown(0.5);
  doc.font("Helvetica").fontSize(10).fillColor("#4b5563").text("License note: self-authored local test content. No external source text is reproduced.");
  doc.moveDown(1);

  spec.sections.forEach((section) => {
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#111827").text(section.heading);
    doc.moveDown(0.2);
    doc.font("Helvetica").fontSize(10.5).fillColor("#1f2937").text(section.body, { lineGap: 3 });
    doc.moveDown(0.8);
  });

  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text(spec.tableTitle);
  const tableBottom = drawTable(doc, 48, doc.y + 8, [110, 220, 160], 34, spec.tableRows);
  doc.y = tableBottom + 22;

  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text(spec.figureTitle);
  doc.moveDown(0.4);
  doc.image(makeDiagramPng(640, 170, accent), 48, doc.y, { width: 490 });
  doc.moveDown(7);
  doc.font("Helvetica").fontSize(9).fillColor("#4b5563").text("Diagram labels are intentionally omitted so image extraction can be checked separately from text extraction.");

  doc.addPage();
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#111827").text("Second Page Parser Check");
  doc.moveDown(0.6);
  doc.font("Helvetica").fontSize(10.5).fillColor("#1f2937").text(
    "This page exists to confirm that multi-page JSON output, page counts, and block identifiers remain stable in a clean test corpus.",
    { lineGap: 3 }
  );
  doc.moveDown(0.8);
  doc.text("Search terms included for testing: point-of-entry, shielding effectiveness, measurement distance, local-only sample.");

  doc.end();

  return new Promise((resolve, reject) => {
    out.on("finish", resolve);
    out.on("error", reject);
  });
}

async function main() {
  ensureDir(OUT_DIR);
  ensureDir(INDEX_DIR);

  const accents = ["#2f80ed", "#2ba84a"];
  for (const [index, spec] of DOCS.entries()) {
    await writePdf(spec, accents[index % accents.length]);
  }

  const index = DOCS.map((spec) => ({
    id: spec.id,
    title: spec.title,
    sourceFile: path.join("data", "safe_docs", spec.fileName).replaceAll("\\", "/"),
    language: "en",
    sourceLanguage: null,
    year: spec.year,
    agency: spec.agency,
    topics: spec.topics,
    license: "Self-authored test content for local parser validation",
  }));

  fs.writeFileSync(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    path.join(OUT_DIR, "README.txt"),
    [
      "This folder contains self-authored PDF fixtures for parser testing.",
      "The files are generated by tools/safe-sample-docs/build-safe-sample-pdfs.js.",
      "They are not copied from external standards, reports, manuals, or official translations.",
      "",
    ].join("\n"),
    "utf8"
  );
  console.log(`Wrote ${DOCS.length} safe sample PDF(s) to ${path.relative(ROOT_DIR, OUT_DIR)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

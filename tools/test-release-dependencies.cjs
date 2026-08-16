"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const packageJson = require(path.join(ROOT, "package.json"));
const packageLock = require(path.join(ROOT, "package-lock.json"));

function tuple(value) {
  return String(value || "")
    .replace(/^[^0-9]*/, "")
    .split(".")
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

function atLeast(value, minimum) {
  const actual = tuple(value);
  const expected = tuple(minimum);
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] !== expected[index]) return actual[index] > expected[index];
  }
  return true;
}

function lockedVersion(moduleName) {
  return packageLock.packages?.[`node_modules/${moduleName}`]?.version || "";
}

test("release runtime excludes the unused vulnerable presentation dependency", () => {
  assert.equal(packageJson.dependencies?.pptxgenjs, undefined);
  const packagedFiles = Array.isArray(packageJson.build?.files) ? packageJson.build.files : [];
  assert.equal(packagedFiles.some((item) => /(?:pptxgenjs|image-size|node_modules\/https)/i.test(String(item))), false);
});

test("release runtime pins patched image and glob dependencies", () => {
  assert.equal(atLeast(lockedVersion("sharp"), "0.35.3"), true, `sharp=${lockedVersion("sharp")}`);
  assert.equal(atLeast(lockedVersion("brace-expansion"), "5.0.9"), true, `brace-expansion=${lockedVersion("brace-expansion")}`);
  const packagedFiles = Array.isArray(packageJson.build?.files) ? packageJson.build.files : [];
  assert.ok(packagedFiles.includes("!node_modules/@img/sharp-wasm32/**/*"));
});

test("ExcelJS uses a patched CommonJS-compatible uuid without changing its public API", async () => {
  assert.equal(atLeast(lockedVersion("uuid"), "11.1.1"), true, `uuid=${lockedVersion("uuid")}`);
  const { v4: uuidv4 } = require("uuid");
  assert.match(uuidv4(), /^[0-9a-f-]{36}$/i);

  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("배포검사");
  sheet.addRow(["항목", "값"]);
  sheet.addRow(["정상", 1]);
  const bytes = await workbook.xlsx.writeBuffer();
  const readback = new ExcelJS.Workbook();
  await readback.xlsx.load(bytes);
  assert.equal(readback.getWorksheet("배포검사").getCell("B2").value, 1);
});

test("patched sharp still performs the supported bounded conversion path", async () => {
  const sharp = require("sharp");
  const png = await sharp({
    create: { width: 8, height: 8, channels: 4, background: "#336699ff" },
  }).png().toBuffer();
  const metadata = await sharp(png, { animated: false, limitInputPixels: 1024 }).metadata();
  assert.equal(metadata.width, 8);
  assert.equal(metadata.height, 8);
});

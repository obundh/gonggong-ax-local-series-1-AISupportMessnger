const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const yauzl = require("yauzl");
const yazl = require("yazl");

const {
  DOCUMENT_RESOURCE_LIMITS,
  SUPPORTED_DOCUMENT_EXTENSIONS,
  analyzeDocumentResources,
  previewDocumentResource,
  publicDocumentResourceError,
  saveAllDocumentResources,
  saveDocumentResource,
} = require("../app/main/document-resource-tools.cjs");

const SECRET = "0123456789abcdef0123456789abcdef";
const PPT_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
const STATIC_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGNwq9jyH4QZYAwAUygJxY+wmGcAAAAASUVORK5CYII=",
  "base64",
);
const STATIC_JPEG = Buffer.from(
  "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJQBWOv/2Q==",
  "base64",
);
const STATIC_WEBP = Buffer.from(
  "UklGRjgAAABXRUJQVlA4ICwAAADwAQCdASoCAAIAAUAmJaACdLoB+AAETAAA/ug4v/lnz+Gzj3/33oDeBgAAAA==",
  "base64",
);

function oversizedPng() {
  const buffer = Buffer.from(STATIC_PNG);
  buffer.writeUInt32BE(50000, 16);
  buffer.writeUInt32BE(50000, 20);
  return buffer;
}

function oversizedJpeg() {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    0xc3, 0x50, 0xc3, 0x50, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

function oversizedWebp() {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(22, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUInt32LE(10, 16);
  buffer.writeUIntLE(49999, 24, 3);
  buffer.writeUIntLE(49999, 27, 3);
  return buffer;
}

async function tempDirectory(t) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heyu-resource-test-"));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  return directory;
}

function writeZip(filePath, entries) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const output = fs.createWriteStream(filePath, { flags: "wx" });
    output.on("close", resolve);
    output.on("error", reject);
    zip.outputStream.on("error", reject);
    zip.outputStream.pipe(output);
    for (const [name, value] of entries) {
      zip.addBuffer(Buffer.isBuffer(value) ? value : Buffer.from(String(value)), name, {
        mtime: new Date("2020-01-01T00:00:00Z"),
        mode: 0o100600,
      });
    }
    zip.end();
  });
}

function pptEntries(extra = []) {
  return [
    ["[Content_Types].xml", `<Types><Override PartName="/ppt/presentation.xml" ContentType="${PPT_CONTENT_TYPE}"/></Types>`],
    ["_rels/.rels", "<Relationships/>"] ,
    ["ppt/presentation.xml", "<p:presentation/>"] ,
    ["ppt/slides/slide1.xml", "<p:sld/>"] ,
    ["ppt/slides/_rels/slide1.xml.rels", '<Relationships><Relationship Target="../media/image1.png"/></Relationships>'],
    ["ppt/media/image1.png", STATIC_PNG],
    ...extra,
  ];
}

async function listZipNames(filePath) {
  const zip = await new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (error, value) => error ? reject(error) : resolve(value));
  });
  return new Promise((resolve, reject) => {
    const names = [];
    zip.on("entry", (entry) => {
      names.push(entry.fileName);
      zip.readEntry();
    });
    zip.on("end", () => resolve(names));
    zip.on("error", reject);
    zip.readEntry();
  });
}

function mutateFirstEocdField(filePath, offset, writer) {
  const buffer = fs.readFileSync(filePath);
  const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const index = buffer.lastIndexOf(signature);
  assert.notEqual(index, -1);
  writer(buffer, index + offset);
  fs.writeFileSync(filePath, buffer);
}

function mutateEntry(filePath, entryName, callback) {
  const buffer = fs.readFileSync(filePath);
  let matches = 0;
  for (let offset = 0; offset <= buffer.length - 4; offset += 1) {
    const signature = buffer.readUInt32LE(offset);
    if (signature === 0x04034b50) {
      const nameLength = buffer.readUInt16LE(offset + 26);
      const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
      if (name === entryName) {
        callback(buffer, { kind: "local", offset, nameOffset: offset + 30, nameLength });
        matches += 1;
      }
    } else if (signature === 0x02014b50) {
      const nameLength = buffer.readUInt16LE(offset + 28);
      const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
      if (name === entryName) {
        callback(buffer, { kind: "central", offset, nameOffset: offset + 46, nameLength });
        matches += 1;
      }
    }
  }
  assert.equal(matches, 2);
  fs.writeFileSync(filePath, buffer);
}

test("supports the published 33 ZIP-package document extensions", () => {
  assert.equal(SUPPORTED_DOCUMENT_EXTENSIONS.length, 33);
  assert.equal(new Set(SUPPORTED_DOCUMENT_EXTENSIONS).size, 33);
  for (const extension of ["hwpx", "docx", "pptm", "xlsb", "odt", "vstm", "oxps", "epub"]) {
    assert.ok(SUPPORTED_DOCUMENT_EXTENSIONS.includes(extension));
  }
});

test("analyzes a valid PPTX, verifies static raster magic, and maps slide usage", async (t) => {
  const directory = await tempDirectory(t);
  const input = path.join(directory, "slides.pptx");
  await writeZip(input, pptEntries());
  const result = await analyzeDocumentResources({ filePath: input, sessionSecret: SECRET });
  assert.equal(result.formatGroup, "powerpoint");
  const image = result.resources.find((resource) => resource.archivePath === "ppt/media/image1.png");
  assert.ok(image);
  assert.equal(image.previewEligible, true);
  assert.equal(image.previewWidth, 2);
  assert.equal(image.previewHeight, 2);
  assert.deepEqual(image.usageLocations, ["슬라이드 1"]);

  const preview = await previewDocumentResource({
    filePath: input,
    sessionSecret: SECRET,
    archiveSha256: result.archiveSha256,
    resourceId: image.resourceId,
  });
  assert.match(preview.dataUrl, /^data:image\/png;base64,/);
  assert.ok(preview.sizeBytes <= DOCUMENT_RESOURCE_LIMITS.maxPreviewBytes);
  assert.deepEqual([preview.width, preview.height], [2, 2]);
});

test("keeps oversized raster resources extractable but blocks renderer previews", async (t) => {
  const directory = await tempDirectory(t);
  const input = path.join(directory, "image-bombs.pptx");
  await writeZip(input, pptEntries([
    ["ppt/media/huge.png", oversizedPng()],
    ["ppt/media/huge.jpg", oversizedJpeg()],
    ["ppt/media/huge.webp", oversizedWebp()],
  ]));
  const result = await analyzeDocumentResources({ filePath: input, sessionSecret: SECRET });
  for (const archivePath of ["ppt/media/huge.png", "ppt/media/huge.jpg", "ppt/media/huge.webp"]) {
    const resource = result.resources.find((item) => item.archivePath === archivePath);
    assert.ok(resource);
    assert.equal(resource.previewEligible, false);
    await assert.rejects(
      previewDocumentResource({
        filePath: input,
        sessionSecret: SECRET,
        archiveSha256: result.archiveSha256,
        resourceId: resource.resourceId,
      }),
      (error) => error.code === "PREVIEW_NOT_ALLOWED",
    );
  }
});

test("accepts bounded static PNG, JPEG, and WebP previews with parsed dimensions", async (t) => {
  const directory = await tempDirectory(t);
  const input = path.join(directory, "bounded-images.pptx");
  await writeZip(input, pptEntries([
    ["ppt/media/bounded.jpg", STATIC_JPEG],
    ["ppt/media/bounded.webp", STATIC_WEBP],
  ]));
  const result = await analyzeDocumentResources({ filePath: input, sessionSecret: SECRET });
  for (const archivePath of ["ppt/media/image1.png", "ppt/media/bounded.jpg", "ppt/media/bounded.webp"]) {
    const resource = result.resources.find((item) => item.archivePath === archivePath);
    assert.ok(resource);
    assert.equal(resource.previewEligible, true, `${archivePath} should be previewable: ${resource.previewReason}`);
    assert.deepEqual([resource.previewWidth, resource.previewHeight], [2, 2]);
  }
});

test("saves one resource and an all-resource ZIP without exposing source paths", async (t) => {
  const directory = await tempDirectory(t);
  const input = path.join(directory, "slides.pptx");
  await writeZip(input, pptEntries());
  const result = await analyzeDocumentResources({ filePath: input, sessionSecret: SECRET });
  const image = result.resources.find((resource) => resource.archivePath.endsWith("image1.png"));
  const single = path.join(directory, "saved.png");
  const archive = path.join(directory, "all-resources.zip");
  await saveDocumentResource({
    filePath: input,
    sessionSecret: SECRET,
    archiveSha256: result.archiveSha256,
    resourceId: image.resourceId,
    outputPath: single,
  });
  assert.deepEqual(await fs.promises.readFile(single), STATIC_PNG);
  await saveAllDocumentResources({
    filePath: input,
    sessionSecret: SECRET,
    archiveSha256: result.archiveSha256,
    outputPath: archive,
  });
  const names = await listZipNames(archive);
  assert.ok(names.includes("ppt/media/image1.png"));
  assert.equal(names.some((name) => name.includes(directory)), false);
});

test("rejects extension and internal package signature mismatches", async (t) => {
  const directory = await tempDirectory(t);
  const input = path.join(directory, "renamed.docx");
  await writeZip(input, pptEntries());
  await assert.rejects(
    analyzeDocumentResources({ filePath: input, sessionSecret: SECRET }),
    (error) => error.code === "FORMAT_MISMATCH"
  );
});

test("rejects ODF manifest encryption declarations even when ZIP flags are clear", async (t) => {
  const directory = await tempDirectory(t);
  const input = path.join(directory, "encrypted.odt");
  await writeZip(input, [
    ["mimetype", "application/vnd.oasis.opendocument.text"],
    ["META-INF/manifest.xml", '<manifest:manifest><manifest:file-entry><manifest:encryption-data/></manifest:file-entry></manifest:manifest>'],
    ["content.xml", "<office:document-content/>"] ,
  ]);
  await assert.rejects(
    analyzeDocumentResources({ filePath: input, sessionSecret: SECRET }),
    (error) => error.code === "ENCRYPTED_ENTRY"
  );
});

test("rejects duplicate case-insensitive entry paths", async (t) => {
  const directory = await tempDirectory(t);
  const input = path.join(directory, "duplicate.pptx");
  await writeZip(input, pptEntries([
    ["ppt/media/same.bin", "a"],
    ["PPT/MEDIA/SAME.BIN", "b"],
  ]));
  await assert.rejects(
    analyzeDocumentResources({ filePath: input, sessionSecret: SECRET }),
    (error) => error.code === "DUPLICATE_ENTRY"
  );
});

test("rejects unsafe paths, encryption flags, and oversized entries before extraction", async (t) => {
  const directory = await tempDirectory(t);
  const unsafe = path.join(directory, "unsafe.pptx");
  const encrypted = path.join(directory, "encrypted.pptx");
  const oversized = path.join(directory, "oversized.pptx");
  await writeZip(unsafe, pptEntries([["ppt/media/safe.bin", "x"]]));
  await fs.promises.copyFile(unsafe, encrypted);
  await fs.promises.copyFile(unsafe, oversized);

  mutateEntry(unsafe, "ppt/media/safe.bin", (buffer, field) => {
    buffer.write("ppt/media/../x.bin", field.nameOffset, field.nameLength, "utf8");
  });
  mutateEntry(encrypted, "ppt/media/safe.bin", (buffer, field) => {
    const flagOffset = field.offset + (field.kind === "local" ? 6 : 8);
    buffer.writeUInt16LE(buffer.readUInt16LE(flagOffset) | 0x0001, flagOffset);
  });
  mutateEntry(oversized, "ppt/media/safe.bin", (buffer, field) => {
    const sizeOffset = field.offset + (field.kind === "local" ? 22 : 24);
    buffer.writeUInt32LE(DOCUMENT_RESOURCE_LIMITS.maxEntryBytes + 1, sizeOffset);
  });

  await assert.rejects(analyzeDocumentResources({ filePath: unsafe, sessionSecret: SECRET }), (error) => error.code === "UNSAFE_ENTRY_PATH");
  await assert.rejects(analyzeDocumentResources({ filePath: encrypted, sessionSecret: SECRET }), (error) => error.code === "ENCRYPTED_ENTRY");
  await assert.rejects(analyzeDocumentResources({ filePath: oversized, sessionSecret: SECRET }), (error) => error.code === "ENTRY_TOO_LARGE");
});

test("rejects abnormal compression ratios and more than 5,000 entries", async (t) => {
  const directory = await tempDirectory(t);
  const bomb = path.join(directory, "ratio.pptx");
  const crowded = path.join(directory, "crowded.pptx");
  await writeZip(bomb, pptEntries([["ppt/media/zeros.bin", Buffer.alloc(8 * 1024 * 1024)]]));
  const crowdedEntries = pptEntries();
  for (let index = 0; index < DOCUMENT_RESOURCE_LIMITS.maxEntries; index += 1) {
    crowdedEntries.push([`ppt/custom/item-${index}.bin`, ""]);
  }
  await writeZip(crowded, crowdedEntries);
  await assert.rejects(analyzeDocumentResources({ filePath: bomb, sessionSecret: SECRET }), (error) => error.code === "ABNORMAL_COMPRESSION_RATIO");
  await assert.rejects(analyzeDocumentResources({ filePath: crowded, sessionSecret: SECRET }), (error) => error.code === "TOO_MANY_ENTRIES");
});

test("rejects ZIP64 sentinels and split-archive disk fields before extraction", async (t) => {
  const directory = await tempDirectory(t);
  const zip64 = path.join(directory, "zip64.pptx");
  const split = path.join(directory, "split.pptx");
  await writeZip(zip64, pptEntries());
  await fs.promises.copyFile(zip64, split);
  mutateFirstEocdField(zip64, 10, (buffer, offset) => buffer.writeUInt16LE(0xffff, offset));
  mutateFirstEocdField(split, 4, (buffer, offset) => buffer.writeUInt16LE(1, offset));
  await assert.rejects(analyzeDocumentResources({ filePath: zip64, sessionSecret: SECRET }), (error) => error.code === "ZIP64_NOT_SUPPORTED");
  await assert.rejects(analyzeDocumentResources({ filePath: split, sessionSecret: SECRET }), (error) => error.code === "SPLIT_ZIP_NOT_SUPPORTED");
});

test("rejects oversized originals and returns fixed path-free public errors", async (t) => {
  const directory = await tempDirectory(t);
  const input = path.join(directory, "large.pptx");
  const handle = await fs.promises.open(input, "w");
  await handle.truncate(DOCUMENT_RESOURCE_LIMITS.maxArchiveBytes + 1);
  await handle.close();
  let caught;
  try {
    await analyzeDocumentResources({ filePath: input, sessionSecret: SECRET });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught.code, "ARCHIVE_TOO_LARGE");
  const publicError = publicDocumentResourceError(caught);
  assert.equal(publicError.errorCode, "ARCHIVE_TOO_LARGE");
  assert.equal(JSON.stringify(publicError).includes(directory), false);
});

test("honors a pre-aborted cancellation signal without starting work", async (t) => {
  const directory = await tempDirectory(t);
  const input = path.join(directory, "slides.pptx");
  await writeZip(input, pptEntries());
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    analyzeDocumentResources({ filePath: input, sessionSecret: SECRET, signal: controller.signal }),
    (error) => error.code === "CANCELED"
  );
});

test("a cancellation requested after final progress still wins over a queued success result", async (t) => {
  const directory = await tempDirectory(t);
  const input = path.join(directory, "late-cancel.pptx");
  await writeZip(input, pptEntries());
  const controller = new AbortController();
  await assert.rejects(
    analyzeDocumentResources({
      filePath: input,
      sessionSecret: SECRET,
      signal: controller.signal,
      onProgress(value) {
        if (value.stage === "done") controller.abort();
      },
    }),
    (error) => error.code === "CANCELED",
  );
});

test("successful worker tasks exit before their promises settle", async (t) => {
  const directory = await tempDirectory(t);
  const input = path.join(directory, "slides.pptx");
  await writeZip(input, pptEntries());
  const before = process._getActiveHandles().filter((handle) => handle?.constructor?.name === "MessagePort").length;
  for (let index = 0; index < 3; index += 1) {
    const result = await analyzeDocumentResources({ filePath: input, sessionSecret: `${SECRET}${index}` });
    assert.equal(result.formatGroup, "powerpoint");
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  const after = process._getActiveHandles().filter((handle) => handle?.constructor?.name === "MessagePort").length;
  assert.ok(after <= before);
});

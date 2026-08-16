const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const { once } = require("events");
const { parentPort, workerData } = require("worker_threads");
const yauzl = require("yauzl");
const yazl = require("yazl");

const limits = workerData.limits;
const operationController = new AbortController();
let canceled = false;

parentPort.on("message", (message) => {
  if (message?.type !== "cancel") return;
  canceled = true;
  operationController.abort();
});

class WorkerError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new WorkerError(code);
}

function checkCanceled() {
  if (canceled || operationController.signal.aborted) fail("CANCELED");
}

function normalizedZipReaderError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("invalid relative path") || message.includes("absolute path") || message.includes("backslash")) {
    return new WorkerError("UNSAFE_ENTRY_PATH");
  }
  return new WorkerError("INVALID_ZIP");
}

function progress(stage, value = {}) {
  parentPort.postMessage({
    type: "progress",
    value: { stage, ...value },
  });
}

function extensionOf(value) {
  return path.extname(String(value || "")).slice(1).toLowerCase();
}

const FORMAT_GROUPS = Object.freeze({
  hwpx: new Set(["hwpx"]),
  word: new Set(["docx", "docm", "dotx", "dotm"]),
  powerpoint: new Set(["pptx", "pptm", "potx", "potm", "ppsx", "ppsm"]),
  excel: new Set(["xlsx", "xlsm", "xlsb", "xltx", "xltm"]),
  opendocument: new Set(["odt", "ods", "odp", "odg", "ott", "ots", "otp", "otg"]),
  visio: new Set(["vsdx", "vsdm", "vssx", "vssm", "vstx", "vstm"]),
  fixed: new Set(["xps", "oxps"]),
  epub: new Set(["epub"]),
});

const FORMAT_LABELS = Object.freeze({
  hwpx: "한글 HWPX",
  word: "Microsoft Word 패키지",
  powerpoint: "Microsoft PowerPoint 패키지",
  excel: "Microsoft Excel 패키지",
  opendocument: "OpenDocument 패키지",
  visio: "Microsoft Visio 패키지",
  fixed: "XPS 고정 문서",
  epub: "EPUB 전자책",
});

const ODF_MIME_TYPES = Object.freeze({
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  odg: "application/vnd.oasis.opendocument.graphics",
  ott: "application/vnd.oasis.opendocument.text-template",
  ots: "application/vnd.oasis.opendocument.spreadsheet-template",
  otp: "application/vnd.oasis.opendocument.presentation-template",
  otg: "application/vnd.oasis.opendocument.graphics-template",
});

const CONTENT_TYPE_MARKERS = Object.freeze({
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  docm: "application/vnd.ms-word.document.macroenabled.main+xml",
  dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml",
  dotm: "application/vnd.ms-word.template.macroenabledtemplate.main+xml",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
  pptm: "application/vnd.ms-powerpoint.presentation.macroenabled.main+xml",
  potx: "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml",
  potm: "application/vnd.ms-powerpoint.template.macroenabled.main+xml",
  ppsx: "application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml",
  ppsm: "application/vnd.ms-powerpoint.slideshow.macroenabled.main+xml",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  xlsm: "application/vnd.ms-excel.sheet.macroenabled.main+xml",
  xlsb: "application/vnd.ms-excel.sheet.binary.macroenabled.main",
  xltx: "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml",
  xltm: "application/vnd.ms-excel.template.macroenabled.main+xml",
});

function formatGroup(extension) {
  for (const [group, extensions] of Object.entries(FORMAT_GROUPS)) {
    if (extensions.has(extension)) return group;
  }
  return "";
}

function canonicalEntryName(fileName) {
  const raw = String(fileName || "").normalize("NFC");
  if (!raw || raw.length > 2048) fail("UNSAFE_ENTRY_PATH");
  if (/[\u0000-\u001f\u007f]/u.test(raw)) fail("UNSAFE_ENTRY_PATH");
  if (raw.includes("\\") || raw.startsWith("/") || /^[a-z]:/i.test(raw)) fail("UNSAFE_ENTRY_PATH");
  const directory = raw.endsWith("/");
  const body = directory ? raw.slice(0, -1) : raw;
  const segments = body.split("/");
  if (!segments.length || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    fail("UNSAFE_ENTRY_PATH");
  }
  for (const segment of segments) {
    if (segment.length > 255 || /[<>:"|?*]/u.test(segment) || /[. ]$/u.test(segment)) fail("UNSAFE_ENTRY_PATH");
    const device = segment.replace(/\..*$/, "").toUpperCase();
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(device)) fail("UNSAFE_ENTRY_PATH");
  }
  return `${segments.join("/")}${directory ? "/" : ""}`;
}

function collisionKey(entryName) {
  return entryName.replace(/\/$/, "").toLocaleLowerCase("en-US");
}

function isDirectoryEntry(entry) {
  return entry.fileName.endsWith("/");
}

function isSymlinkEntry(entry) {
  const unixMode = (Number(entry.externalFileAttributes || 0) >>> 16) & 0xffff;
  return (unixMode & 0xf000) === 0xa000;
}

async function readTailAndValidate(filePath) {
  checkCanceled();
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (_error) {
    fail("FILE_NOT_FOUND");
  }
  if (!stat.isFile()) fail("FILE_NOT_FOUND");
  if (stat.size > limits.maxArchiveBytes) fail("ARCHIVE_TOO_LARGE");
  if (stat.size < 22) fail("INVALID_ZIP");

  const header = Buffer.alloc(4);
  const tailSize = Math.min(stat.size, 131072);
  const tail = Buffer.alloc(tailSize);
  const handle = await fs.promises.open(filePath, "r");
  try {
    await handle.read(header, 0, 4, 0);
    await handle.read(tail, 0, tailSize, stat.size - tailSize);
  } finally {
    await handle.close();
  }
  if (header.readUInt32LE(0) !== 0x04034b50) fail("INVALID_ZIP");

  let eocdIndex = -1;
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (tail.readUInt32LE(index) === 0x06054b50) {
      const commentLength = tail.readUInt16LE(index + 20);
      if (index + 22 + commentLength === tail.length) {
        eocdIndex = index;
        break;
      }
    }
  }
  if (eocdIndex < 0) fail("INVALID_ZIP");

  const diskNumber = tail.readUInt16LE(eocdIndex + 4);
  const centralDisk = tail.readUInt16LE(eocdIndex + 6);
  const entriesOnDisk = tail.readUInt16LE(eocdIndex + 8);
  const entryCount = tail.readUInt16LE(eocdIndex + 10);
  const centralSize = tail.readUInt32LE(eocdIndex + 12);
  const centralOffset = tail.readUInt32LE(eocdIndex + 16);
  if (entriesOnDisk === 0xffff || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    fail("ZIP64_NOT_SUPPORTED");
  }
  const locatorIndex = eocdIndex - 20;
  if (locatorIndex >= 0 && tail.readUInt32LE(locatorIndex) === 0x07064b50) fail("ZIP64_NOT_SUPPORTED");
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) fail("SPLIT_ZIP_NOT_SUPPORTED");
  if (entryCount > limits.maxEntries) fail("TOO_MANY_ENTRIES");
  const eocdFileOffset = stat.size - tailSize + eocdIndex;
  if (centralOffset + centralSize > eocdFileOffset) fail("INVALID_ZIP");
  return { stat, entryCount };
}

function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, {
      autoClose: false,
      decodeStrings: true,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    }, (error, zipFile) => {
      if (error) reject(normalizedZipReaderError(error));
      else resolve(zipFile);
    });
  });
}

function openEntryStream(zipFile, entry) {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error) reject(normalizedZipReaderError(error));
      else resolve(stream);
    });
  });
}

async function readEntryBuffer(zipFile, entry, maxBytes) {
  if (entry.uncompressedSize > maxBytes) fail("PREVIEW_NOT_ALLOWED");
  const stream = await openEntryStream(zipFile, entry);
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      checkCanceled();
      total += chunk.length;
      if (total > maxBytes) fail("PREVIEW_NOT_ALLOWED");
      chunks.push(chunk);
    }
  } catch (error) {
    stream.destroy();
    throw error;
  }
  return Buffer.concat(chunks, total);
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    checkCanceled();
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function resourceIdFor(secret, entry, index) {
  if (!secret || secret.length < 16) fail("INVALID_REQUEST");
  return crypto
    .createHmac("sha256", secret)
    .update(`${index}\0${entry.canonicalName}\0${entry.crc32}\0${entry.compressedSize}\0${entry.uncompressedSize}`)
    .digest("base64url")
    .slice(0, 32);
}

function resourceCategory(entryName) {
  const lower = entryName.toLowerCase();
  const ext = extensionOf(lower);
  if (/vbaproject\.bin$|(^|\/)(macros?|scripts?)(\/|$)/u.test(lower) || ["js", "vbs", "vbe", "ps1", "bat", "cmd", "com", "exe", "dll", "scr", "msi"].includes(ext)) {
    return "macro-script";
  }
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "svg", "wmf", "emf", "eps", "ico", "avif"].includes(ext)) return "image";
  if (["mp4", "m4v", "mov", "avi", "wmv", "webm", "mpeg", "mpg"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "aac", "ogg", "oga", "flac", "wma"].includes(ext)) return "audio";
  if (["ttf", "otf", "woff", "woff2", "eot"].includes(ext)) return "font";
  if (/(^|\/)(embeddings?|attachments?|objects?)(\/|$)/u.test(lower)) return "attachment";
  if (/(^|\/)(styles?|themes?)(\/|$)/u.test(lower) || ["css", "xsl", "xslt"].includes(ext)) return "style-theme";
  if (["xml", "rels", "json", "opf", "ncx", "fdseq", "fdoc", "piece"].includes(ext) || lower === "[content_types].xml" || lower === "mimetype") {
    return "document-structure";
  }
  return "other";
}

function categoryLabel(category) {
  return ({
    image: "이미지",
    video: "영상",
    audio: "오디오",
    attachment: "첨부파일",
    font: "글꼴",
    "style-theme": "테마·서식",
    "macro-script": "매크로·스크립트",
    "document-structure": "문서 구조",
    other: "기타",
  })[category] || "기타";
}

function boundedRasterDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  if (width > limits.maxPreviewDimension || height > limits.maxPreviewDimension) return null;
  if (width * height > limits.maxPreviewPixels) return null;
  return { width, height };
}

function pngDimensions(buffer) {
  if (buffer.length < 33 || buffer.readUInt32BE(8) !== 13 || buffer.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return boundedRasterDimensions(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
}

function jpegDimensions(buffer) {
  if (buffer.length < 10 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) return null;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) return null;
    if (sofMarkers.has(marker)) {
      if (segmentLength < 7) return null;
      return boundedRasterDimensions(buffer.readUInt16BE(offset + 3), buffer.readUInt16BE(offset + 5));
    }
    offset += segmentLength;
  }
  return null;
}

function webpDimensions(buffer) {
  if (buffer.length < 25 || buffer.subarray(0, 4).toString("ascii") !== "RIFF" || buffer.subarray(8, 12).toString("ascii") !== "WEBP") return null;
  const chunk = buffer.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X") {
    if (buffer.length < 30) return null;
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return boundedRasterDimensions(width, height);
  }
  if (chunk === "VP8 ") {
    if (buffer.length < 30 || !buffer.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) return null;
    return boundedRasterDimensions(buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff);
  }
  if (chunk === "VP8L") {
    if (buffer[20] !== 0x2f) return null;
    const bits = buffer.readUInt32LE(21);
    const width = 1 + (bits & 0x3fff);
    const height = 1 + ((bits >>> 14) & 0x3fff);
    return boundedRasterDimensions(width, height);
  }
  return null;
}

function detectSafeStaticRaster(buffer, entryName) {
  const ext = extensionOf(entryName);
  if (!buffer?.length || !["png", "jpg", "jpeg", "webp"].includes(ext)) return null;
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    if (ext !== "png" || buffer.includes(Buffer.from("acTL", "ascii"))) return null;
    const dimensions = pngDimensions(buffer);
    return dimensions ? { mimeType: "image/png", extension: "png", ...dimensions } : null;
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    if (ext !== "jpg" && ext !== "jpeg") return null;
    const dimensions = jpegDimensions(buffer);
    return dimensions ? { mimeType: "image/jpeg", extension: ext, ...dimensions } : null;
  }
  if (buffer.length >= 21 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    if (ext !== "webp") return null;
    const animated = buffer.includes(Buffer.from("ANIM", "ascii")) || buffer.includes(Buffer.from("ANMF", "ascii")) ||
      (buffer.subarray(12, 16).toString("ascii") === "VP8X" && Boolean(buffer[20] & 0x02));
    if (animated) return null;
    const dimensions = webpDimensions(buffer);
    return dimensions ? { mimeType: "image/webp", extension: "webp", ...dimensions } : null;
  }
  return null;
}

function validateEntrySecurity(entry, totals, names) {
  const canonicalName = canonicalEntryName(entry.fileName);
  const key = collisionKey(canonicalName);
  if (names.has(key)) fail("DUPLICATE_ENTRY");
  names.add(key);
  if (isSymlinkEntry(entry)) fail("UNSAFE_ENTRY_TYPE");
  if ((entry.generalPurposeBitFlag & 0x0001) !== 0 || (entry.generalPurposeBitFlag & 0x0040) !== 0) fail("ENCRYPTED_ENTRY");
  if (![0, 8].includes(entry.compressionMethod)) fail("UNSUPPORTED_COMPRESSION");
  if (Array.isArray(entry.extraFields) && entry.extraFields.some((field) => field.id === 0x0001)) fail("ZIP64_NOT_SUPPORTED");
  if (entry.uncompressedSize > limits.maxEntryBytes) fail("ENTRY_TOO_LARGE");
  totals.expanded += entry.uncompressedSize;
  if (totals.expanded > limits.maxExpandedBytes) fail("EXPANDED_SIZE_TOO_LARGE");
  if (entry.uncompressedSize >= 1024 * 1024) {
    if (entry.compressedSize === 0 || entry.uncompressedSize / entry.compressedSize > limits.maxCompressionRatio) {
      fail("ABNORMAL_COMPRESSION_RATIO");
    }
  }
  return canonicalName;
}

function listZipEntries(zipFile, expectedEntryCount) {
  return new Promise((resolve, reject) => {
    const entries = [];
    const names = new Set();
    const totals = { expanded: 0 };
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      zipFile.removeAllListeners("entry");
      zipFile.removeAllListeners("end");
      zipFile.removeAllListeners("error");
      if (error) reject(error);
      else if (entries.length !== expectedEntryCount) reject(new WorkerError("INVALID_ZIP"));
      else resolve({ entries, expandedBytes: totals.expanded });
    };
    zipFile.on("error", (error) => finish(normalizedZipReaderError(error)));
    zipFile.on("entry", (entry) => {
      try {
        checkCanceled();
        if (entries.length >= limits.maxEntries) fail("TOO_MANY_ENTRIES");
        entry.canonicalName = validateEntrySecurity(entry, totals, names);
        entry.entryIndex = entries.length;
        entries.push(entry);
        if (entries.length % 100 === 0) {
          progress("scan", { processedEntries: entries.length, totalEntries: expectedEntryCount });
        }
        zipFile.readEntry();
      } catch (error) {
        finish(error);
      }
    });
    zipFile.on("end", () => finish(null));
    zipFile.readEntry();
  });
}

function findEntry(entries, canonicalName) {
  const target = canonicalName.toLowerCase();
  return entries.find((entry) => entry.canonicalName.toLowerCase() === target) || null;
}

async function validatePackageSignature(zipFile, entries, extension) {
  const group = formatGroup(extension);
  if (!group) fail("UNSUPPORTED_FORMAT");
  const nameSet = new Set(entries.map((entry) => entry.canonicalName.toLowerCase()));
  const has = (name) => nameSet.has(name.toLowerCase());
  const requireEntries = (...names) => {
    if (!names.every(has)) fail("FORMAT_MISMATCH");
  };

  if (group === "hwpx") {
    requireEntries("mimetype", "Contents/content.hpf");
    const mime = (await readEntryBuffer(zipFile, findEntry(entries, "mimetype"), 512)).toString("utf8").trim();
    if (mime !== "application/hwp+zip") fail("FORMAT_MISMATCH");
    return group;
  }
  if (group === "opendocument") {
    requireEntries("mimetype", "META-INF/manifest.xml");
    const mime = (await readEntryBuffer(zipFile, findEntry(entries, "mimetype"), 512)).toString("utf8").trim();
    if (mime !== ODF_MIME_TYPES[extension]) fail("FORMAT_MISMATCH");
    const manifestEntry = findEntry(entries, "META-INF/manifest.xml");
    if (manifestEntry.uncompressedSize > 2 * 1024 * 1024) fail("FORMAT_MISMATCH");
    const manifest = (await readEntryBuffer(zipFile, manifestEntry, 2 * 1024 * 1024)).toString("utf8").toLowerCase();
    if (/(?:encryption-data|encrypted-key|start-key-generation)/u.test(manifest)) fail("ENCRYPTED_ENTRY");
    if (has("META-INF/encryption.xml")) fail("ENCRYPTED_ENTRY");
    return group;
  }
  if (group === "epub") {
    requireEntries("mimetype", "META-INF/container.xml");
    const mime = (await readEntryBuffer(zipFile, findEntry(entries, "mimetype"), 512)).toString("utf8").trim();
    if (mime !== "application/epub+zip") fail("FORMAT_MISMATCH");
    if (has("META-INF/encryption.xml")) fail("ENCRYPTED_ENTRY");
    return group;
  }
  if (group === "fixed") {
    requireEntries("[Content_Types].xml", "_rels/.rels");
    const fixedSequence = entries.some((entry) => /(^|\/)(fixeddocumentsequence|fixeddocseq)\.fdseq$/iu.test(entry.canonicalName));
    if (!fixedSequence) fail("FORMAT_MISMATCH");
    return group;
  }

  requireEntries("[Content_Types].xml", "_rels/.rels");
  if (group === "word") requireEntries("word/document.xml");
  if (group === "powerpoint") requireEntries("ppt/presentation.xml");
  if (group === "excel") requireEntries(extension === "xlsb" ? "xl/workbook.bin" : "xl/workbook.xml");
  if (group === "visio") requireEntries("visio/document.xml");

  const contentTypesEntry = findEntry(entries, "[Content_Types].xml");
  if (contentTypesEntry.uncompressedSize > 2 * 1024 * 1024) fail("FORMAT_MISMATCH");
  const contentTypes = (await readEntryBuffer(zipFile, contentTypesEntry, 2 * 1024 * 1024)).toString("utf8").toLowerCase();
  const marker = CONTENT_TYPE_MARKERS[extension];
  if (marker && !contentTypes.includes(marker)) fail("FORMAT_MISMATCH");
  if (group === "visio" && !contentTypes.includes("visio")) fail("FORMAT_MISMATCH");
  return group;
}

function decodeReference(value) {
  const decodedEntities = String(value || "")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, "\"")
    .replace(/&apos;/giu, "'");
  try {
    return decodeURIComponent(decodedEntities);
  } catch (_error) {
    return decodedEntities;
  }
}

function sourcePathForRelationships(relationshipPath) {
  const match = String(relationshipPath).match(/^(.*\/)?_rels\/([^/]+)\.rels$/iu);
  if (!match) return "";
  return `${match[1] || ""}${match[2]}`;
}

function referenceLabel(group, referencePath) {
  let match = referencePath.match(/^ppt\/slides\/_rels\/slide(\d+)\.xml\.rels$/iu);
  if (match) return `슬라이드 ${Number(match[1])}`;
  match = referencePath.match(/^xl\/worksheets\/_rels\/sheet(\d+)\.xml\.rels$/iu);
  if (match) return `시트 ${Number(match[1])}`;
  if (/^word\/_rels\/document\.xml\.rels$/iu.test(referencePath)) return "본문";
  match = referencePath.match(/^word\/_rels\/(header|footer)(\d+)\.xml\.rels$/iu);
  if (match) return `${match[1].toLowerCase() === "header" ? "머리글" : "바닥글"} ${Number(match[2])}`;
  match = referencePath.match(/^contents\/section(\d+)\.xml$/iu);
  if (group === "hwpx" && match) return `섹션 ${Number(match[1])}`;
  if (group === "opendocument") return /^content\.xml$/iu.test(referencePath) ? "본문" : `문서 ${path.posix.basename(referencePath).slice(0, 36)}`;
  if (group === "epub") return `전자책 ${path.posix.basename(referencePath).slice(0, 36)}`;
  return "";
}

function referenceTargets(xmlText, referencePath) {
  const targets = [];
  const sourcePath = referencePath.toLowerCase().endsWith(".rels")
    ? sourcePathForRelationships(referencePath)
    : referencePath;
  if (!sourcePath) return targets;
  const baseDirectory = path.posix.dirname(sourcePath);
  const attributePattern = /\b(?:target|href|src|xlink:href)\s*=\s*["']([^"']+)["']/giu;
  for (const match of xmlText.matchAll(attributePattern)) {
    const raw = decodeReference(match[1]).split(/[?#]/u, 1)[0].trim();
    if (!raw || /^[a-z][a-z0-9+.-]*:/iu.test(raw) || raw.startsWith("//") || raw.startsWith("/")) continue;
    const normalized = path.posix.normalize(path.posix.join(baseDirectory === "." ? "" : baseDirectory, raw));
    if (!normalized || normalized === ".." || normalized.startsWith("../")) continue;
    targets.push(normalized.toLocaleLowerCase("en-US"));
  }
  return targets;
}

async function attachUsageLocations(zipFile, entries, resources, group) {
  const resourceByPath = new Map(resources.map((resource) => [resource.archivePath.toLocaleLowerCase("en-US"), resource]));
  const referenceEntries = entries.filter((entry) => {
    if (isDirectoryEntry(entry) || entry.uncompressedSize > 2 * 1024 * 1024) return false;
    const lower = entry.canonicalName.toLowerCase();
    if (lower.endsWith(".rels")) return true;
    if (group === "hwpx") return /^contents\/section\d+\.xml$/u.test(lower);
    if (group === "opendocument") return lower === "content.xml" || lower.endsWith(".xml");
    if (group === "epub") return /\.(?:opf|ncx|xhtml|html|xml)$/u.test(lower);
    return false;
  }).slice(0, 500);
  let scannedBytes = 0;
  for (const entry of referenceEntries) {
    checkCanceled();
    if (scannedBytes + entry.uncompressedSize > 16 * 1024 * 1024) break;
    scannedBytes += entry.uncompressedSize;
    const label = referenceLabel(group, entry.canonicalName);
    if (!label) continue;
    const xmlText = (await readEntryBuffer(zipFile, entry, 2 * 1024 * 1024)).toString("utf8");
    for (const target of referenceTargets(xmlText, entry.canonicalName)) {
      const resource = resourceByPath.get(target) ||
        (group === "hwpx" && target.startsWith("contents/") ? resourceByPath.get(target.slice("contents/".length)) : null);
      if (!resource) continue;
      if (!resource.usageLocations.includes(label) && resource.usageLocations.length < 20) resource.usageLocations.push(label);
    }
  }
  for (const resource of resources) {
    resource.usage = resource.usageLocations.join(", ");
    resource.usedIn = [...resource.usageLocations];
  }
}

async function scanArchive(filePath, secret, inspectPreviews) {
  const outer = await readTailAndValidate(filePath);
  progress("hash", { totalBytes: outer.stat.size });
  const archiveSha256 = await sha256File(filePath);
  checkCanceled();
  const zipFile = await openZip(filePath);
  try {
    if (zipFile.entryCount !== outer.entryCount) fail("INVALID_ZIP");
    const listed = await listZipEntries(zipFile, outer.entryCount);
    const extension = extensionOf(filePath);
    const group = await validatePackageSignature(zipFile, listed.entries, extension);
    const resources = [];
    let previewCandidates = 0;
    for (const entry of listed.entries) {
      checkCanceled();
      if (isDirectoryEntry(entry)) continue;
      const category = resourceCategory(entry.canonicalName);
      let raster = null;
      let previewReason = category === "image" ? "형식 또는 크기 제한" : "미리보기 대상 아님";
      if (inspectPreviews && category === "image" && previewCandidates < limits.maxPreviewRequests && entry.uncompressedSize <= limits.maxPreviewBytes) {
        previewCandidates += 1;
        const buffer = await readEntryBuffer(zipFile, entry, limits.maxPreviewBytes);
        raster = detectSafeStaticRaster(buffer, entry.canonicalName);
        previewReason = raster ? "" : "정적 PNG/JPEG/WebP가 아니거나 내부 서명이 일치하지 않음";
      } else if (inspectPreviews && category === "image" && previewCandidates >= limits.maxPreviewRequests) {
        previewReason = "분석 미리보기 검사 한도 초과";
      }
      const resourceId = resourceIdFor(secret, entry, entry.entryIndex);
      resources.push({
        resourceId,
        entryIndex: entry.entryIndex,
        archivePath: entry.canonicalName,
        name: path.posix.basename(entry.canonicalName),
        extension: extensionOf(entry.canonicalName),
        category,
        categoryLabel: categoryLabel(category),
        sizeBytes: entry.uncompressedSize,
        compressedSizeBytes: entry.compressedSize,
        previewEligible: Boolean(raster),
        previewMimeType: raster?.mimeType || "",
        previewWidth: raster?.width || 0,
        previewHeight: raster?.height || 0,
        previewReason,
        requiresCaution: category === "macro-script",
        usage: "",
        usageLocations: [],
        usedIn: [],
      });
    }
    await attachUsageLocations(zipFile, listed.entries, resources, group);
    const categoryCounts = {};
    for (const resource of resources) categoryCounts[resource.category] = (categoryCounts[resource.category] || 0) + 1;
    return {
      archiveSha256,
      sourceSizeBytes: outer.stat.size,
      sourceMtimeMs: outer.stat.mtimeMs,
      extension,
      formatGroup: group,
      formatLabel: FORMAT_LABELS[group],
      expandedBytes: listed.expandedBytes,
      entryCount: listed.entries.length,
      resourceCount: resources.length,
      categoryCounts,
      resources,
      entries: listed.entries,
    };
  } finally {
    zipFile.close();
  }
}

function publicResource(resource) {
  return {
    resourceId: resource.resourceId,
    archivePath: resource.archivePath,
    name: resource.name,
    extension: resource.extension,
    category: resource.category,
    categoryLabel: resource.categoryLabel,
    sizeBytes: resource.sizeBytes,
    compressedSizeBytes: resource.compressedSizeBytes,
    previewEligible: resource.previewEligible,
    previewMimeType: resource.previewMimeType,
    previewWidth: resource.previewWidth,
    previewHeight: resource.previewHeight,
    previewReason: resource.previewReason,
    requiresCaution: resource.requiresCaution,
    usage: resource.usage,
    usageLocations: resource.usageLocations,
    usedIn: resource.usedIn,
  };
}

function verifyArchiveDigest(scanned, expected) {
  if (!expected || scanned.archiveSha256 !== expected) fail("ARCHIVE_CHANGED");
}

function selectedResource(scanned, resourceId) {
  const resource = scanned.resources.find((item) => item.resourceId === resourceId);
  if (!resource) fail("RESOURCE_NOT_FOUND");
  return resource;
}

function partialPath(outputPath) {
  return path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.heyu-partial-${workerData.jobId}`);
}

async function ensureWritableOutput(outputPath) {
  if (!path.isAbsolute(outputPath) || !workerData.jobId) fail("INVALID_REQUEST");
  let directoryStat;
  try {
    directoryStat = await fs.promises.stat(path.dirname(outputPath));
  } catch (_error) {
    fail("OUTPUT_FAILED");
  }
  if (!directoryStat.isDirectory()) fail("OUTPUT_FAILED");
  try {
    await fs.promises.lstat(outputPath);
    fail("OUTPUT_EXISTS");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return partialPath(outputPath);
}

async function commitPartial(partial, outputPath) {
  try {
    await fs.promises.copyFile(partial, outputPath, fs.constants.COPYFILE_EXCL);
    await fs.promises.unlink(partial);
  } catch (error) {
    await fs.promises.unlink(partial).catch(() => {});
    if (error?.code === "EEXIST") fail("OUTPUT_EXISTS");
    fail("OUTPUT_FAILED");
  }
}

async function saveOne(filePath, scanned, resource, outputPath) {
  const partial = await ensureWritableOutput(outputPath);
  const zipFile = await openZip(filePath);
  try {
    const listed = await listZipEntries(zipFile, scanned.entryCount);
    const entry = listed.entries[resource.entryIndex];
    if (!entry || entry.canonicalName !== resource.archivePath || resourceIdFor(workerData.sessionSecret, entry, entry.entryIndex) !== resource.resourceId) {
      fail("ARCHIVE_CHANGED");
    }
    const input = await openEntryStream(zipFile, entry);
    const output = fs.createWriteStream(partial, { flags: "wx" });
    progress("save", { totalBytes: entry.uncompressedSize });
    await pipeline(input, output, { signal: operationController.signal });
    const stat = await fs.promises.stat(partial);
    if (stat.size !== entry.uncompressedSize) fail("INVALID_ZIP");
    checkCanceled();
    await commitPartial(partial, outputPath);
    return { savedCount: 1, fileName: path.basename(outputPath) };
  } finally {
    zipFile.close();
    await fs.promises.unlink(partial).catch(() => {});
  }
}

async function saveAll(filePath, scanned, outputPath) {
  const partial = await ensureWritableOutput(outputPath);
  const sourceZip = await openZip(filePath);
  const outputZip = new yazl.ZipFile();
  outputZip.on("error", (error) => outputZip.outputStream.destroy(error));
  const output = fs.createWriteStream(partial, { flags: "wx" });
  const outputDone = pipeline(outputZip.outputStream, output, { signal: operationController.signal });
  outputDone.catch(() => {});
  try {
    const listed = await listZipEntries(sourceZip, scanned.entryCount);
    const resourcesByIndex = new Map(scanned.resources.map((resource) => [resource.entryIndex, resource]));
    let savedCount = 0;
    let processedBytes = 0;
    for (const entry of listed.entries) {
      checkCanceled();
      const resource = resourcesByIndex.get(entry.entryIndex);
      if (!resource) continue;
      if (entry.canonicalName !== resource.archivePath || resourceIdFor(workerData.sessionSecret, entry, entry.entryIndex) !== resource.resourceId) {
        fail("ARCHIVE_CHANGED");
      }
      const stream = await openEntryStream(sourceZip, entry);
      outputZip.addReadStream(stream, entry.canonicalName, {
        compress: false,
        size: entry.uncompressedSize,
        mtime: new Date(0),
        mode: 0o100600,
      });
      await once(stream, "end");
      savedCount += 1;
      processedBytes += entry.uncompressedSize;
      progress("save", {
        processedEntries: savedCount,
        totalEntries: scanned.resourceCount,
        processedBytes,
        totalBytes: scanned.expandedBytes,
      });
    }
    outputZip.end();
    await outputDone;
    checkCanceled();
    await commitPartial(partial, outputPath);
    return { savedCount, fileName: path.basename(outputPath) };
  } finally {
    sourceZip.close();
    if (!outputZip.outputStream.destroyed) outputZip.outputStream.destroy();
    await outputDone.catch(() => {});
    await fs.promises.unlink(partial).catch(() => {});
  }
}

async function execute() {
  const filePath = String(workerData.filePath || "");
  const secret = String(workerData.sessionSecret || "");
  if (!path.isAbsolute(filePath) || secret.length < 16) fail("INVALID_REQUEST");
  progress("validate");

  if (workerData.operation === "analyze") {
    const scanned = await scanArchive(filePath, secret, true);
    progress("done", { processedEntries: scanned.entryCount, totalEntries: scanned.entryCount });
    return {
      archiveSha256: scanned.archiveSha256,
      sourceSizeBytes: scanned.sourceSizeBytes,
      sourceMtimeMs: scanned.sourceMtimeMs,
      extension: scanned.extension,
      formatGroup: scanned.formatGroup,
      formatLabel: scanned.formatLabel,
      expandedBytes: scanned.expandedBytes,
      entryCount: scanned.entryCount,
      resourceCount: scanned.resourceCount,
      categoryCounts: scanned.categoryCounts,
      resources: scanned.resources.map(publicResource),
    };
  }

  const scanned = await scanArchive(filePath, secret, workerData.operation === "preview");
  verifyArchiveDigest(scanned, String(workerData.archiveSha256 || ""));

  if (workerData.operation === "preview") {
    const resource = selectedResource(scanned, String(workerData.resourceId || ""));
    if (!resource.previewEligible || resource.sizeBytes > limits.maxPreviewBytes) fail("PREVIEW_NOT_ALLOWED");
    const zipFile = await openZip(filePath);
    try {
      const listed = await listZipEntries(zipFile, scanned.entryCount);
      const entry = listed.entries[resource.entryIndex];
      if (!entry || entry.canonicalName !== resource.archivePath) fail("ARCHIVE_CHANGED");
      const buffer = await readEntryBuffer(zipFile, entry, limits.maxPreviewBytes);
      const raster = detectSafeStaticRaster(buffer, entry.canonicalName);
      if (!raster || raster.mimeType !== resource.previewMimeType ||
          raster.width !== resource.previewWidth || raster.height !== resource.previewHeight) {
        fail("PREVIEW_NOT_ALLOWED");
      }
      return {
        resourceId: resource.resourceId,
        mimeType: raster.mimeType,
        sizeBytes: buffer.length,
        width: raster.width,
        height: raster.height,
        dataUrl: `data:${raster.mimeType};base64,${buffer.toString("base64")}`,
      };
    } finally {
      zipFile.close();
    }
  }

  const outputPath = String(workerData.outputPath || "");
  if (workerData.operation === "save-one") {
    const resource = selectedResource(scanned, String(workerData.resourceId || ""));
    return saveOne(filePath, scanned, resource, outputPath);
  }
  if (workerData.operation === "save-all") return saveAll(filePath, scanned, outputPath);
  fail("INVALID_REQUEST");
}

execute()
  .then((value) => {
    parentPort.postMessage({ type: "result", ok: true, value });
    parentPort.close();
  })
  .catch((error) => {
    const errorCode = error?.name === "AbortError" || canceled ? "CANCELED" : String(error?.code || "INTERNAL_ERROR");
    parentPort.postMessage({ type: "result", ok: false, errorCode });
    parentPort.close();
  });

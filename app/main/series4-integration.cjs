const nodeFs = require("node:fs");
const nodeFsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn: nodeSpawn } = require("node:child_process");

const SERIES4_RELEASE = Object.freeze({
  version: "4.1.1",
  tag: "v4.1.1",
  assetName: "GonggongAX-Series4-Portable-x64-v4.1.1.zip",
  bytes: 66_232_189,
  sha256: "1c7056b0fcad99c42ba85d9d9770e5b35e64207379b2fa20279365a2a052805f",
});

const SERIES4_APP_FOLDER = "공공AX 업무 매크로";
const SERIES4_BUNDLE_DIRECTORY = "series4-bundle";
const PREFERRED_EXECUTABLE = "공공AX-업무매크로.exe";
const SIDECAR_SUFFIX = ".series4.json";
const RECEIPT_SCHEMA_VERSION = 1;
const DEFAULT_INSTALL_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_EXTRACT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ARCHIVE_ENTRIES = 4_096;
const DEFAULT_MAX_EXTRACTED_BYTES = 768 * 1024 * 1024;
const DEFAULT_MAX_TREE_DEPTH = 16;
const DEFAULT_MAX_EXECUTABLE_SCAN_ENTRIES = 768;
const DEFAULT_MAX_EXECUTABLE_SCAN_DEPTH = 5;
const DEFAULT_MAX_SIDECAR_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_SIDECAR_EVENTS = 100_000;
const DEFAULT_MAX_SIDECAR_SCAN_ENTRIES = 20_000;
const DEFAULT_MAX_SIDECAR_CANDIDATES = 500;
const DEFAULT_MAX_SESSIONS = 200;
const MAX_PATH_TEXT = 4_096;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const SUPPORTED_ACTION_KINDS = Object.freeze([
  "None",
  "TextEntry",
  "KeyStroke",
  "MouseLeftClick",
  "MouseRightClick",
  "MouseMiddleClick",
  "MouseDrag",
  "MouseWheel",
  "Other",
]);
const SUPPORTED_ACTION_KIND_SET = new Set(SUPPORTED_ACTION_KINDS.slice(0, -1));
const TEST_ONLY = Symbol("series4-test-only");

class Series4IntegrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "Series4IntegrationError";
    this.code = code;
  }
}

function integrationError(code, message) {
  return new Series4IntegrationError(code, message);
}

function positiveSafeInteger(value, fallback, label) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new TypeError(`${label} must be a positive safe integer`);
  return number;
}

function assertAbsoluteNonRoot(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new TypeError(`${label} must be an absolute path`);
  }
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) throw new TypeError(`${label} cannot be a filesystem root`);
  return resolved;
}

function normalizeArchivePath(value, label = "path") {
  const original = String(value || "");
  if (!original || original.length > MAX_PATH_TEXT || /[\x00-\x1f\x7f]/.test(original)) {
    throw integrationError("UNSAFE_PATH", `${label} is empty, too long, or contains control characters`);
  }
  const slashPath = original.replaceAll("\\", "/");
  if (slashPath.startsWith("/") || /^[a-z]:/i.test(slashPath) || slashPath.includes(":")) {
    throw integrationError("UNSAFE_PATH", `${label} must be a portable relative path`);
  }
  const segments = slashPath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.length > 255)) {
    throw integrationError("UNSAFE_PATH", `${label} contains an unsafe segment`);
  }
  for (const segment of segments) {
    if (segment.endsWith(".") || segment.endsWith(" ") || WINDOWS_RESERVED_NAME.test(segment)) {
      throw integrationError("UNSAFE_PATH", `${label} is not portable to Windows`);
    }
  }
  return segments.join("/");
}

function isPathInside(rootDir, targetPath) {
  const relative = path.relative(path.resolve(rootDir), path.resolve(targetPath));
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function safeJoin(rootDir, relativePath, label = "path") {
  const normalized = normalizeArchivePath(relativePath, label);
  const target = path.resolve(rootDir, ...normalized.split("/"));
  if (!isPathInside(rootDir, target)) throw integrationError("UNSAFE_PATH", `${label} escapes its trusted root`);
  return target;
}

function safeIsoDate(value) {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function safeStoredStatus(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "completed") return "completed";
  if (text === "inprogress") return "in-progress";
  if (text === "failed") return "failed";
  return "unknown";
}

function safeCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= 1_000_000 ? Math.round(number * 1000) / 1000 : null;
}

function normalizeReleaseForTest(value) {
  if (!value || typeof value !== "object") throw new TypeError("test release must be an object");
  const version = String(value.version || "");
  const bytes = positiveSafeInteger(value.bytes, 0, "test release bytes");
  const sha256 = String(value.sha256 || "").toLowerCase();
  if (!SHA256_PATTERN.test(sha256)) throw new TypeError("test release sha256 must be a SHA-256 digest");
  return Object.freeze({ version, tag: String(value.tag || "test"), assetName: String(value.assetName || "test.zip"), bytes, sha256 });
}

function resolveFs(options) {
  const fsModule = options.fs || nodeFs;
  const promises = options.fsPromises || fsModule.promises || nodeFsp;
  const createReadStream = options.createReadStream || fsModule.createReadStream?.bind(fsModule) || nodeFs.createReadStream;
  if (!promises || typeof promises.open !== "function" || typeof createReadStream !== "function") {
    throw new TypeError("fs must provide promises and createReadStream");
  }
  return { promises, createReadStream };
}

async function pathExists(fsp, targetPath) {
  return fsp.lstat(targetPath).then(() => true, () => false);
}

function series4BundleRootCandidates(options = {}) {
  const candidates = [];
  const addResourcesPath = (value) => {
    if (typeof value !== "string" || !value.trim()) return;
    const resourcesPath = assertAbsoluteNonRoot(value, "Series 4 resourcesPath");
    candidates.push(path.join(resourcesPath, SERIES4_BUNDLE_DIRECTORY));
  };
  if (options.resourcesPath != null) addResourcesPath(String(options.resourcesPath));
  else if (process.resourcesPath) addResourcesPath(String(process.resourcesPath));
  candidates.push(path.resolve(__dirname, "..", "..", "vendor", SERIES4_BUNDLE_DIRECTORY));
  return [...new Set(candidates.map((item) => path.resolve(item)))];
}

async function resolveBundledSeries4Asset(release, options = {}) {
  const fsp = options.fsp || nodeFsp;
  for (const bundleRoot of series4BundleRootCandidates(options)) {
    const rootStat = await fsp.lstat(bundleRoot).catch(() => null);
    if (!rootStat) continue;
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw integrationError("BUNDLED_ASSET_INVALID", "The bundled Series 4 resource directory is not trusted");
    }
    const artifactPath = path.join(bundleRoot, release.assetName);
    const artifactStat = await fsp.lstat(artifactPath).catch(() => null);
    if (!artifactStat) continue;
    if (!artifactStat.isFile() || artifactStat.isSymbolicLink()) {
      throw integrationError("BUNDLED_ASSET_INVALID", "The bundled Series 4 release is not a regular file");
    }
    const [realRoot, realArtifact] = await Promise.all([fsp.realpath(bundleRoot), fsp.realpath(artifactPath)]);
    if (!isPathInside(realRoot, realArtifact)) {
      throw integrationError("BUNDLED_ASSET_INVALID", "The bundled Series 4 release resolves outside its trusted resource directory");
    }
    return Object.freeze({ path: realArtifact, stat: artifactStat });
  }
  return null;
}

async function copyBundledRelease(release, bundledAsset, destinationPath, options) {
  if (!bundledAsset?.path) throw integrationError("BUNDLED_ASSET_MISSING", "The installer does not contain the pinned Series 4 release");
  const source = await options.fsp.open(bundledAsset.path, "r");
  let destination;
  try {
    const before = await source.stat();
    if (!before.isFile() || before.size !== release.bytes) {
      throw integrationError("SIZE_MISMATCH", "The bundled Series 4 release size did not match the pinned metadata");
    }
    destination = await options.fsp.open(destinationPath, "wx", 0o600);
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let copiedBytes = 0;
    while (copiedBytes < release.bytes) {
      throwIfCanceled(options.signal);
      const requested = Math.min(buffer.length, release.bytes - copiedBytes);
      const { bytesRead } = await source.read(buffer, 0, requested, copiedBytes);
      if (bytesRead < 1) break;
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      let written = 0;
      while (written < bytesRead) {
        const result = await destination.write(chunk, written, bytesRead - written);
        if (result.bytesWritten < 1) throw integrationError("BUNDLED_ASSET_INVALID", "The bundled Series 4 release could not be staged");
        written += result.bytesWritten;
      }
      copiedBytes += bytesRead;
      emitProgress(options.progressCallbacks, {
        operation: "series4-install",
        phase: "copying",
        version: release.version,
        downloadedBytes: copiedBytes,
        totalBytes: release.bytes,
      });
    }
    const after = await source.stat();
    if (copiedBytes !== release.bytes || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw integrationError("SIZE_MISMATCH", "The bundled Series 4 release changed or was truncated while being staged");
    }
    const digest = hash.digest("hex");
    if (digest !== release.sha256) {
      throw integrationError("CHECKSUM_MISMATCH", "The bundled Series 4 release SHA-256 did not match the pinned metadata");
    }
    return Object.freeze({ bytes: copiedBytes, sha256: digest, source: "bundled-installer-resource" });
  } finally {
    await destination?.close().catch(() => {});
    await source.close().catch(() => {});
  }
}

function cancellationError(signal, message = "The Series 4 operation was canceled") {
  return signal?.aborted ? integrationError("OPERATION_CANCELED", message) : null;
}

function throwIfCanceled(signal) {
  const error = cancellationError(signal);
  if (error) throw error;
}

async function sha256File(filePath, context, signal) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of context.createReadStream(filePath)) {
    throwIfCanceled(signal);
    hash.update(chunk);
  }
  throwIfCanceled(signal);
  return hash.digest("hex");
}

function emitProgress(callbacks, event) {
  const frozen = Object.freeze({ ...event });
  for (const callback of callbacks) {
    if (typeof callback !== "function") continue;
    try {
      callback(frozen);
    } catch (_error) {
      // Observers cannot interrupt or alter an integrity-checked installation.
    }
  }
}

function findEndOfCentralDirectory(buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

async function inspectZipArchive(zipPath, options = {}) {
  const fsp = options.fsPromises || nodeFsp;
  const maxEntries = positiveSafeInteger(options.maxArchiveEntries, DEFAULT_MAX_ARCHIVE_ENTRIES, "maxArchiveEntries");
  const maxExtractedBytes = positiveSafeInteger(options.maxExtractedBytes, DEFAULT_MAX_EXTRACTED_BYTES, "maxExtractedBytes");
  throwIfCanceled(options.signal);
  const handle = await fsp.open(zipPath, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 22) throw integrationError("UNSAFE_ARCHIVE", "The Series 4 ZIP is truncated or is not a regular file");
    const tailLength = Math.min(stat.size, 65_557);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, stat.size - tailLength);
    const eocd = findEndOfCentralDirectory(tail);
    if (eocd < 0 || eocd + 22 > tail.length) throw integrationError("UNSAFE_ARCHIVE", "The Series 4 ZIP directory is missing");
    const diskNumber = tail.readUInt16LE(eocd + 4);
    const centralDisk = tail.readUInt16LE(eocd + 6);
    const diskEntries = tail.readUInt16LE(eocd + 8);
    const totalEntries = tail.readUInt16LE(eocd + 10);
    const centralSize = tail.readUInt32LE(eocd + 12);
    const centralOffset = tail.readUInt32LE(eocd + 16);
    const commentLength = tail.readUInt16LE(eocd + 20);
    if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
      throw integrationError("UNSAFE_ARCHIVE", "Multi-disk Series 4 ZIPs are not supported");
    }
    if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw integrationError("UNSAFE_ARCHIVE", "ZIP64 Series 4 archives are not supported");
    }
    if (totalEntries < 1 || totalEntries > maxEntries || centralSize > 32 * 1024 * 1024) {
      throw integrationError("UNSAFE_ARCHIVE", "The Series 4 ZIP has an unsafe number of entries");
    }
    if (eocd + 22 + commentLength !== tail.length || centralOffset + centralSize > stat.size) {
      throw integrationError("UNSAFE_ARCHIVE", "The Series 4 ZIP directory is inconsistent");
    }
    const central = Buffer.alloc(centralSize);
    await handle.read(central, 0, centralSize, centralOffset);
    const entries = [];
    const seen = new Map();
    let extractedBytes = 0;
    let offset = 0;
    for (let index = 0; index < totalEntries; index += 1) {
      throwIfCanceled(options.signal);
      if (offset + 46 > central.length || central.readUInt32LE(offset) !== 0x02014b50) {
        throw integrationError("UNSAFE_ARCHIVE", "The Series 4 ZIP contains a malformed directory entry");
      }
      const versionMadeBy = central.readUInt16LE(offset + 4);
      const flags = central.readUInt16LE(offset + 8);
      const method = central.readUInt16LE(offset + 10);
      const compressedSize = central.readUInt32LE(offset + 20);
      const uncompressedSize = central.readUInt32LE(offset + 24);
      const nameLength = central.readUInt16LE(offset + 28);
      const extraLength = central.readUInt16LE(offset + 30);
      const entryCommentLength = central.readUInt16LE(offset + 32);
      const externalAttributes = central.readUInt32LE(offset + 38);
      const localHeaderOffset = central.readUInt32LE(offset + 42);
      const end = offset + 46 + nameLength + extraLength + entryCommentLength;
      if (nameLength < 1 || end > central.length) throw integrationError("UNSAFE_ARCHIVE", "The Series 4 ZIP entry is truncated");
      if ((flags & 0x1) !== 0 || ![0, 8].includes(method)) throw integrationError("UNSAFE_ARCHIVE", "Encrypted or unsupported ZIP entries are not allowed");
      if ([compressedSize, uncompressedSize, localHeaderOffset].includes(0xffffffff)) throw integrationError("UNSAFE_ARCHIVE", "ZIP64 Series 4 entries are not supported");
      const nameBytes = central.subarray(offset + 46, offset + 46 + nameLength);
      if ((flags & 0x800) === 0 && nameBytes.some((byte) => byte > 0x7f)) throw integrationError("UNSAFE_ARCHIVE", "Non-UTF-8 archive paths are not supported");
      const rawName = nameBytes.toString("utf8");
      if (rawName.includes("\ufffd")) throw integrationError("UNSAFE_ARCHIVE", "The Series 4 ZIP path encoding is invalid");
      const isDirectory = rawName.endsWith("/") || rawName.endsWith("\\");
      const normalizedName = normalizeArchivePath(isDirectory ? rawName.slice(0, -1) : rawName, "archive entry");
      const collisionKey = normalizedName.toLowerCase();
      if (seen.has(collisionKey)) throw integrationError("UNSAFE_ARCHIVE", "The Series 4 ZIP has colliding paths");
      const segments = collisionKey.split("/");
      for (let depth = 1; depth < segments.length; depth += 1) {
        if (seen.get(segments.slice(0, depth).join("/")) === false) throw integrationError("UNSAFE_ARCHIVE", "The Series 4 ZIP places a file above another entry");
      }
      if (!isDirectory && [...seen.keys()].some((item) => item.startsWith(`${collisionKey}/`))) {
        throw integrationError("UNSAFE_ARCHIVE", "The Series 4 ZIP places a file above another entry");
      }
      seen.set(collisionKey, isDirectory);
      const creatorSystem = versionMadeBy >>> 8;
      const unixMode = externalAttributes >>> 16;
      const unixType = unixMode & 0o170000;
      if (creatorSystem === 3 && ![0, 0o040000, 0o100000].includes(unixType)) {
        throw integrationError("UNSAFE_ARCHIVE", "Links and special filesystem entries are not allowed in Series 4 ZIPs");
      }
      if (creatorSystem === 3 && ((unixType === 0o040000) !== isDirectory) && unixType !== 0) {
        throw integrationError("UNSAFE_ARCHIVE", "The Series 4 ZIP directory attributes are inconsistent");
      }
      extractedBytes += uncompressedSize;
      if (extractedBytes > maxExtractedBytes) throw integrationError("UNSAFE_ARCHIVE", "The Series 4 ZIP expands beyond its configured limit");
      entries.push({ name: normalizedName, isDirectory, localHeaderOffset, flags, method, compressedSize, nameBytes });
      offset = end;
    }
    if (offset !== central.length) throw integrationError("UNSAFE_ARCHIVE", "The Series 4 ZIP directory contains trailing data");
    for (const entry of entries) {
      throwIfCanceled(options.signal);
      const localHeader = Buffer.alloc(30);
      const read = await handle.read(localHeader, 0, localHeader.length, entry.localHeaderOffset);
      if (read.bytesRead !== localHeader.length || localHeader.readUInt32LE(0) !== 0x04034b50) throw integrationError("UNSAFE_ARCHIVE", "The Series 4 ZIP local header is invalid");
      const localFlags = localHeader.readUInt16LE(6);
      const localMethod = localHeader.readUInt16LE(8);
      const localNameLength = localHeader.readUInt16LE(26);
      const localExtraLength = localHeader.readUInt16LE(28);
      if (localFlags !== entry.flags || localMethod !== entry.method || localNameLength !== entry.nameBytes.length) throw integrationError("UNSAFE_ARCHIVE", "The Series 4 ZIP headers do not agree");
      const dataOffset = entry.localHeaderOffset + 30 + localNameLength + localExtraLength;
      if (dataOffset > stat.size || dataOffset + entry.compressedSize > centralOffset) throw integrationError("UNSAFE_ARCHIVE", "The Series 4 ZIP entry overlaps its directory");
      const localName = Buffer.alloc(localNameLength);
      await handle.read(localName, 0, localNameLength, entry.localHeaderOffset + 30);
      if (!localName.equals(entry.nameBytes)) throw integrationError("UNSAFE_ARCHIVE", "The Series 4 ZIP contains conflicting path names");
    }
    throwIfCanceled(options.signal);
    return Object.freeze({
      entries: Object.freeze(entries.map(({ name, isDirectory }) => Object.freeze({ name, isDirectory }))),
      extractedBytes,
    });
  } finally {
    await handle.close();
  }
}

function runProcess(spawnImpl, executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(executable, args, {
        cwd: options.cwd,
        windowsHide: true,
        shell: false,
        stdio: "ignore",
      });
    } catch (_error) {
      reject(integrationError("EXTRACTION_FAILED", "A safe ZIP extractor is not available on this computer"));
      return;
    }
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener?.("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => {
      try { child.kill(); } catch (_error) {}
      finish(integrationError("OPERATION_CANCELED", "The Series 4 installation was canceled"));
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_error) {}
      finish(integrationError("EXTRACTION_FAILED", "The Series 4 ZIP extraction timed out"));
    }, options.timeoutMs || DEFAULT_EXTRACT_TIMEOUT_MS);
    child.once?.("error", () => finish(integrationError("EXTRACTION_FAILED", "A safe ZIP extractor is not available on this computer")));
    child.once?.("close", (code) => {
      if (options.signal?.aborted) finish(integrationError("OPERATION_CANCELED", "The Series 4 installation was canceled"));
      else if (code === 0) finish();
      else finish(integrationError("EXTRACTION_FAILED", `The Series 4 ZIP extractor exited with code ${Number(code) || 0}`));
    });
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

async function defaultExtractZip(zipPath, destinationDir, options) {
  const executable = options.platform === "win32" ? "tar.exe" : "tar";
  await runProcess(options.spawnImpl, executable, ["-xf", zipPath, "-C", destinationDir], {
    cwd: destinationDir,
    signal: options.signal,
    timeoutMs: options.extractTimeoutMs,
  });
}

async function inspectExtractedTree(rootDir, archive, options) {
  const fsp = options.fsp;
  const maxEntries = options.maxArchiveEntries;
  const maxBytes = options.maxExtractedBytes;
  const rootStat = await fsp.lstat(rootDir);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw integrationError("UNSAFE_ARCHIVE", "The extracted Series 4 payload is not a regular directory");
  const realRoot = await fsp.realpath(rootDir);
  const expectedFiles = new Set(archive.entries.filter((item) => !item.isDirectory).map((item) => item.name.toLowerCase()));
  const foundFiles = new Set();
  const pending = [{ directory: rootDir, relative: "", depth: 0 }];
  let entriesSeen = 0;
  let totalBytes = 0;
  while (pending.length) {
    throwIfCanceled(options.signal);
    const current = pending.pop();
    if (current.depth > DEFAULT_MAX_TREE_DEPTH) throw integrationError("UNSAFE_ARCHIVE", "The extracted Series 4 payload is nested too deeply");
    const children = await fsp.readdir(current.directory, { withFileTypes: true });
    for (const child of children) {
      throwIfCanceled(options.signal);
      entriesSeen += 1;
      if (entriesSeen > maxEntries) throw integrationError("UNSAFE_ARCHIVE", "The extracted Series 4 payload has too many entries");
      const relative = normalizeArchivePath(current.relative ? `${current.relative}/${child.name}` : child.name, "extracted entry");
      const target = safeJoin(rootDir, relative, "extracted entry");
      const stat = await fsp.lstat(target);
      if (stat.isSymbolicLink()) throw integrationError("UNSAFE_ARCHIVE", "Extracted links are not allowed");
      const realTarget = await fsp.realpath(target);
      if (!isPathInside(realRoot, realTarget)) throw integrationError("UNSAFE_ARCHIVE", "An extracted entry resolves outside the Series 4 payload");
      if (stat.isDirectory()) {
        pending.push({ directory: target, relative, depth: current.depth + 1 });
      } else if (stat.isFile()) {
        const key = relative.toLowerCase();
        if (!expectedFiles.has(key)) throw integrationError("UNSAFE_ARCHIVE", "The extractor created a file that was not in the inspected ZIP");
        foundFiles.add(key);
        totalBytes += stat.size;
        if (totalBytes > maxBytes) throw integrationError("UNSAFE_ARCHIVE", "The extracted Series 4 payload exceeded its configured size limit");
      } else {
        throw integrationError("UNSAFE_ARCHIVE", "The Series 4 ZIP contains a special filesystem entry");
      }
    }
  }
  if (foundFiles.size !== expectedFiles.size || [...expectedFiles].some((item) => !foundFiles.has(item))) {
    throw integrationError("INSTALL_INCOMPLETE", "The Series 4 ZIP did not extract all inspected files");
  }
  return { entriesSeen, totalBytes, realRoot };
}

function normalizedExecutableStem(fileName) {
  return path.basename(String(fileName || ""), path.extname(String(fileName || "")))
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

async function detectInstalledExecutable(rootDir, options) {
  const fsp = options.fsp;
  const maxEntries = options.maxExecutableScanEntries || DEFAULT_MAX_EXECUTABLE_SCAN_ENTRIES;
  const maxDepth = options.maxExecutableScanDepth || DEFAULT_MAX_EXECUTABLE_SCAN_DEPTH;
  const rootStat = await fsp.lstat(rootDir).catch(() => null);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) return null;
  const realRoot = await fsp.realpath(rootDir);
  const pending = [{ directory: rootDir, relative: "", depth: 0 }];
  const candidates = [];
  let scanned = 0;
  while (pending.length) {
    const current = pending.shift();
    const children = await fsp.readdir(current.directory, { withFileTypes: true });
    for (const child of children) {
      scanned += 1;
      if (scanned > maxEntries) throw integrationError("INSTALL_INCOMPLETE", "The Series 4 executable search exceeded its safe entry limit");
      const relative = normalizeArchivePath(current.relative ? `${current.relative}/${child.name}` : child.name, "installed entry");
      const target = safeJoin(rootDir, relative, "installed entry");
      const stat = await fsp.lstat(target);
      if (stat.isSymbolicLink()) throw integrationError("UNSAFE_INSTALLATION", "The Series 4 installation contains a link");
      const realTarget = await fsp.realpath(target);
      if (!isPathInside(realRoot, realTarget)) throw integrationError("UNSAFE_INSTALLATION", "The Series 4 installation resolves outside its trusted directory");
      if (stat.isDirectory()) {
        if (current.depth < maxDepth) pending.push({ directory: target, relative, depth: current.depth + 1 });
      } else if (stat.isFile() && path.extname(child.name).toLowerCase() === ".exe") {
        candidates.push({ path: target, relative, fileName: child.name, depth: current.depth });
      } else if (!stat.isFile()) {
        throw integrationError("UNSAFE_INSTALLATION", "The Series 4 installation contains a special filesystem entry");
      }
    }
  }
  const exact = candidates.filter((item) => item.fileName.toLowerCase() === PREFERRED_EXECUTABLE.toLowerCase());
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw integrationError("INSTALL_INCOMPLETE", "The Series 4 installation contains multiple preferred executables");
  const expectedStem = normalizedExecutableStem(PREFERRED_EXECUTABLE);
  const normalizedMatches = candidates.filter((item) => normalizedExecutableStem(item.fileName) === expectedStem);
  if (normalizedMatches.length === 1) return normalizedMatches[0];
  if (normalizedMatches.length > 1) throw integrationError("INSTALL_INCOMPLETE", "The Series 4 installation contains ambiguous application executables");
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) return null;
  throw integrationError("INSTALL_INCOMPLETE", "The Series 4 application executable could not be selected safely");
}

async function writeJsonAtomic(targetPath, value, fsp) {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const temporary = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${crypto.randomUUID()}.tmp`);
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    await fsp.rename(temporary, targetPath);
  } finally {
    await fsp.rm(temporary, { force: true }).catch(() => {});
  }
}

async function readJsonObject(filePath, fsp) {
  try {
    const value = JSON.parse(await fsp.readFile(filePath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch (_error) {
    return null;
  }
}

async function assertRegularFileInside(rootDir, filePath, fsp, label) {
  if (!isPathInside(rootDir, filePath)) throw integrationError("UNSAFE_PATH", `${label} is outside its trusted root`);
  const stat = await fsp.lstat(filePath).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) throw integrationError("ARTIFACT_NOT_FOUND", `${label} is not a regular file`);
  const [realRoot, realFile] = await Promise.all([fsp.realpath(rootDir), fsp.realpath(filePath)]);
  if (!isPathInside(realRoot, realFile)) throw integrationError("UNSAFE_PATH", `${label} resolves outside its trusted root`);
  return { path: realFile, stat };
}

async function readBoundedSidecar(record, context) {
  const trusted = await assertRegularFileInside(record.root, record.sidecarPath, context.fsp, "Series 4 sidecar");
  if (trusted.stat.size < 2 || trusted.stat.size > context.maxSidecarBytes) throw integrationError("INVALID_SIDECAR", "The Series 4 sidecar is outside the configured size limit");
  const handle = await context.fsp.open(trusted.path, "r");
  let text;
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== trusted.stat.size || before.size > context.maxSidecarBytes) throw integrationError("INVALID_SIDECAR", "The Series 4 sidecar changed while it was being opened");
    text = await handle.readFile({ encoding: "utf8" });
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw integrationError("INVALID_SIDECAR", "The Series 4 sidecar changed while it was being read");
  } finally {
    await handle.close();
  }
  let document;
  try {
    document = JSON.parse(text);
  } catch (_error) {
    throw integrationError("INVALID_SIDECAR", "The Series 4 sidecar is not valid JSON");
  }
  if (!document || typeof document !== "object" || Array.isArray(document) || ![1, 2].includes(document.version)) {
    throw integrationError("INVALID_SIDECAR", "The Series 4 sidecar version is not supported");
  }
  if (!Array.isArray(document.events) || document.events.length > context.maxSidecarEvents) {
    throw integrationError("INVALID_SIDECAR", "The Series 4 sidecar event list is missing or too large");
  }
  const storedVideo = String(document.currentVideoPath || "");
  if (!storedVideo || storedVideo.length > MAX_PATH_TEXT || /[\x00-\x1f\x7f]/.test(storedVideo)) {
    throw integrationError("INVALID_SIDECAR", "The Series 4 sidecar video reference is invalid");
  }
  const counts = Object.fromEntries(SUPPORTED_ACTION_KINDS.map((kind) => [kind, 0]));
  const timeline = [];
  let executableEventCount = 0;
  let quarantinedEventCount = 0;
  let maxOffsetTicks = 0;
  for (const event of document.events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) throw integrationError("INVALID_SIDECAR", "The Series 4 sidecar contains an invalid event");
    const rawKind = String(event.actionKind || "None");
    const kind = SUPPORTED_ACTION_KIND_SET.has(rawKind) ? rawKind : "Other";
    counts[kind] += 1;
    const quarantined = event.isQuarantined === true;
    if (quarantined) quarantinedEventCount += 1;
    if (!quarantined && kind !== "None" && kind !== "Other") executableEventCount += 1;
    const ticks = Number(event.offsetTicks);
    if (Number.isSafeInteger(ticks) && ticks >= 0 && ticks > maxOffsetTicks) maxOffsetTicks = ticks;
    if (timeline.length < 500) {
      const durationTicks = Number(event.dragDurationTicks);
      timeline.push(Object.freeze({
        type: kind,
        actionKind: kind,
        offsetMs: Number.isSafeInteger(ticks) && ticks >= 0 ? Math.round(ticks / 10_000) : 0,
        durationMs: Number.isSafeInteger(durationTicks) && durationTicks >= 0 ? Math.round(durationTicks / 10_000) : 0,
        x: safeCoordinate(event.screenX),
        y: safeCoordinate(event.screenY),
      }));
    }
  }
  return {
    document,
    trustedSidecarPath: trusted.path,
    summary: {
      schemaVersion: document.version,
      savedAt: safeIsoDate(document.savedAtUtc),
      status: safeStoredStatus(document.status),
      eventCount: document.events.length,
      executableEventCount,
      quarantinedEventCount,
      durationMs: Math.min(Number.MAX_SAFE_INTEGER, Math.round(maxOffsetTicks / 10_000)),
      eventTypes: SUPPORTED_ACTION_KINDS
        .filter((kind) => counts[kind] > 0)
        .map((kind) => Object.freeze({ type: kind, count: counts[kind] })),
      timeline: Object.freeze(timeline),
      timelineTruncated: document.events.length > timeline.length,
    },
  };
}

function validateTrustedAbsolutePath(rootDir, targetPath, label) {
  const resolved = path.resolve(targetPath);
  if (!isPathInside(rootDir, resolved)) throw integrationError("UNSAFE_PATH", `${label} is outside its trusted root`);
  const relative = path.relative(rootDir, resolved).split(path.sep).join("/");
  normalizeArchivePath(relative, label);
  return resolved;
}

async function resolveVideoArtifact(record, parsed, context) {
  const stored = String(parsed.document.currentVideoPath || "");
  const sidecarDir = path.dirname(parsed.trustedSidecarPath);
  const candidates = [];
  if (path.isAbsolute(stored)) {
    candidates.push(path.resolve(stored));
    const baseName = path.basename(stored);
    if (baseName && baseName !== stored) candidates.push(path.resolve(sidecarDir, baseName));
  } else {
    const slashStored = stored.replaceAll("\\", "/");
    try {
      const normalized = normalizeArchivePath(slashStored, "Series 4 video reference");
      candidates.push(path.resolve(sidecarDir, ...normalized.split("/")));
    } catch (_error) {
      // Invalid relative references are never followed.
    }
  }
  for (const candidate of [...new Set(candidates)]) {
    try {
      const trustedCandidate = validateTrustedAbsolutePath(record.root, candidate, "Series 4 video");
      if (path.extname(trustedCandidate).toLowerCase() !== ".mp4") continue;
      return await assertRegularFileInside(record.root, trustedCandidate, context.fsp, "Series 4 video");
    } catch (_error) {
      // A missing or unsafe video is represented only as unavailable metadata.
    }
  }
  return null;
}

async function summarizeRecord(record, context) {
  const parsed = await readBoundedSidecar(record, context);
  const video = await resolveVideoArtifact(record, parsed, context);
  return { parsed, video, summary: Object.freeze({ ...parsed.summary, videoAvailable: Boolean(video) }) };
}

function sessionListMetadata(summary) {
  const { timeline: _timeline, ...metadata } = summary;
  return Object.freeze(metadata);
}

function defaultRoots(options) {
  const roots = options.roots || {};
  const userProfile = process.env.USERPROFILE || "";
  const videosDir = roots.videosDir || options.videosDir || (userProfile ? path.join(userProfile, "Videos") : "");
  const localAppDataDir = roots.localAppDataDir || options.localAppDataDir || process.env.LOCALAPPDATA || "";
  if (!videosDir || !localAppDataDir) throw new TypeError("roots.videosDir and roots.localAppDataDir are required");
  return {
    videosDir: assertAbsoluteNonRoot(videosDir, "roots.videosDir"),
    localAppDataDir: assertAbsoluteNonRoot(localAppDataDir, "roots.localAppDataDir"),
  };
}

function createSeries4Integration(options = {}) {
  const userDataDir = assertAbsoluteNonRoot(options.userDataDir, "userDataDir");
  const roots = defaultRoots(options);
  const fileSystem = resolveFs(options);
  const fsp = fileSystem.promises;
  const testConfiguration = options[TEST_ONLY] || null;
  const spawnImpl = options.spawnImpl || nodeSpawn;
  if (typeof spawnImpl !== "function") throw new TypeError("spawnImpl must be a function");
  const release = testConfiguration?.release ? normalizeReleaseForTest(testConfiguration.release) : SERIES4_RELEASE;
  const platform = String(options.platform || process.platform).toLowerCase();
  const architecture = String(options.arch || process.arch).toLowerCase();
  const rootDir = path.join(userDataDir, "series4");
  const runtimeRoot = path.join(rootDir, "runtime");
  const targetDir = path.join(runtimeRoot, `v${release.version}`);
  const stagingRoot = path.join(rootDir, ".staging");
  const receiptPath = path.join(targetDir, "heyu-series4-receipt.json");
  const maxArchiveEntries = positiveSafeInteger(options.maxArchiveEntries, DEFAULT_MAX_ARCHIVE_ENTRIES, "maxArchiveEntries");
  const maxExtractedBytes = positiveSafeInteger(options.maxExtractedBytes, DEFAULT_MAX_EXTRACTED_BYTES, "maxExtractedBytes");
  const maxSidecarBytes = positiveSafeInteger(options.maxSidecarBytes, DEFAULT_MAX_SIDECAR_BYTES, "maxSidecarBytes");
  const maxSidecarEvents = positiveSafeInteger(options.maxSidecarEvents, DEFAULT_MAX_SIDECAR_EVENTS, "maxSidecarEvents");
  const maxSidecarScanEntries = positiveSafeInteger(options.maxSidecarScanEntries, DEFAULT_MAX_SIDECAR_SCAN_ENTRIES, "maxSidecarScanEntries");
  const maxSidecarCandidates = positiveSafeInteger(options.maxSidecarCandidates, DEFAULT_MAX_SIDECAR_CANDIDATES, "maxSidecarCandidates");
  const maxSessions = positiveSafeInteger(options.maxSessions, DEFAULT_MAX_SESSIONS, "maxSessions");
  const onProgress = options.onProgress;
  const knownProjectRoots = [...new Set([
    path.join(roots.videosDir, SERIES4_APP_FOLDER),
    path.join(roots.localAppDataDir, SERIES4_APP_FOLDER),
  ].map((item) => path.resolve(item).toLowerCase()))].map((lowerPath) => {
    const candidate = [path.join(roots.videosDir, SERIES4_APP_FOLDER), path.join(roots.localAppDataDir, SERIES4_APP_FOLDER)]
      .find((item) => path.resolve(item).toLowerCase() === lowerPath);
    return path.resolve(candidate);
  });
  const sidecarContext = { fsp, maxSidecarBytes, maxSidecarEvents };
  const sessionHandles = new Map();
  const importedHandles = new Map();
  let activeInstall = null;
  let lastProgress = null;

  async function assertManagedDirectory(directory, parent, label) {
    const stat = await fsp.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw integrationError("UNSAFE_INSTALLATION", `${label} is not a regular directory`);
    const [realParent, realDirectory] = await Promise.all([fsp.realpath(parent), fsp.realpath(directory)]);
    if (!isPathInside(realParent, realDirectory)) throw integrationError("UNSAFE_INSTALLATION", `${label} resolves outside its managed parent`);
    return realDirectory;
  }

  async function ensureManagedRoot() {
    await fsp.mkdir(userDataDir, { recursive: true, mode: 0o700 });
    const userDataStat = await fsp.lstat(userDataDir);
    if (!userDataStat.isDirectory() || userDataStat.isSymbolicLink()) throw integrationError("UNSAFE_INSTALLATION", "The injected user data directory is not a regular directory");
    await fsp.mkdir(rootDir, { recursive: true, mode: 0o700 });
    await assertManagedDirectory(rootDir, userDataDir, "The Series 4 managed directory");
  }

  async function readInstalled() {
    const userDataStat = await fsp.lstat(userDataDir).catch(() => null);
    if (!userDataStat?.isDirectory() || userDataStat.isSymbolicLink()) return null;
    const rootStat = await fsp.lstat(rootDir).catch(() => null);
    if (!rootStat) return null;
    await assertManagedDirectory(rootDir, userDataDir, "The Series 4 managed directory");
    const runtimeStat = await fsp.lstat(runtimeRoot).catch(() => null);
    if (!runtimeStat) return null;
    await assertManagedDirectory(runtimeRoot, rootDir, "The Series 4 runtime directory");
    const targetStat = await fsp.lstat(targetDir).catch(() => null);
    if (!targetStat?.isDirectory() || targetStat.isSymbolicLink()) return null;
    await assertManagedDirectory(targetDir, runtimeRoot, "The Series 4 version directory");
    const receipt = await readJsonObject(receiptPath, fsp);
    if (!receipt || receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION || receipt.version !== release.version ||
        receipt.artifactSha256 !== release.sha256 || receipt.artifactBytes !== release.bytes) return null;
    let relativeExecutable;
    try {
      relativeExecutable = normalizeArchivePath(receipt.executableRelativePath, "Series 4 receipt executable");
    } catch (_error) {
      return null;
    }
    const executablePath = safeJoin(targetDir, relativeExecutable, "Series 4 executable");
    let file;
    try {
      file = await assertRegularFileInside(targetDir, executablePath, fsp, "Series 4 executable");
    } catch (_error) {
      return null;
    }
    if (!Number.isSafeInteger(receipt.executableBytes) || receipt.executableBytes !== file.stat.size || !SHA256_PATTERN.test(String(receipt.executableSha256 || ""))) return null;
    if (await sha256File(file.path, fileSystem) !== receipt.executableSha256) return null;
    return {
      executablePath: file.path,
      executableRelativePath: relativeExecutable,
      installedAt: safeIsoDate(receipt.installedAt),
      executableBytes: file.stat.size,
    };
  }

  async function getStatus() {
    let installed = null;
    let unsafeInstallation = false;
    try {
      installed = await readInstalled();
    } catch (error) {
      if (error?.code !== "UNSAFE_INSTALLATION") throw error;
      unsafeInstallation = true;
    }
    const targetExists = unsafeInstallation || await pathExists(fsp, targetDir);
    const installing = Boolean(activeInstall);
    const state = installed ? "ready" : unsafeInstallation || targetExists ? "repair-required" : installing ? "installing" : "not-installed";
    return Object.freeze({
      ok: Boolean(installed),
      state,
      installed: Boolean(installed),
      installing,
      launchable: Boolean(installed) && platform === "win32" && architecture === "x64",
      version: release.version,
      platform,
      architecture,
      installedAt: installed?.installedAt || "",
      package: Object.freeze({ source: "bundled-installer-resource", bytes: release.bytes }),
      progress: activeInstall && lastProgress ? Object.freeze({ ...lastProgress }) : null,
    });
  }

  async function safeRemoveManaged(target, parent) {
    if (!isPathInside(parent, target)) throw integrationError("UNSAFE_PATH", "A Series 4 cleanup target escaped its managed directory");
    await fsp.rm(target, { recursive: true, force: true });
  }

  async function performInstall(installOptions, controller, progressCallbacks) {
    if (platform !== "win32" || architecture !== "x64") throw integrationError("INCOMPATIBLE_PLATFORM", "Series 4 v4.1.1 supports Windows x64 only");
    const existing = await readInstalled();
    if (existing) return Object.freeze({ ok: true, state: "ready", installed: true, alreadyInstalled: true, version: release.version });
    await ensureManagedRoot();
    await fsp.mkdir(stagingRoot, { recursive: true, mode: 0o700 });
    await assertManagedDirectory(stagingRoot, rootDir, "The Series 4 staging directory");
    const stagingDir = path.join(stagingRoot, `install-${crypto.randomUUID()}`);
    const artifactPath = path.join(stagingDir, release.assetName);
    const payloadDir = path.join(stagingDir, "payload");
    const backupDir = path.join(stagingDir, "previous-installation");
    await fsp.mkdir(stagingDir, { recursive: false, mode: 0o700 });
    let previousMoved = false;
    let committed = false;
    let preserveStaging = false;
    try {
      throwIfCanceled(controller.signal);
      emitProgress(progressCallbacks, { operation: "series4-install", phase: "starting", version: release.version, downloadedBytes: 0, totalBytes: release.bytes });
      const bundledAsset = await resolveBundledSeries4Asset(release, {
        fsp,
        resourcesPath: options.resourcesPath,
      });
      if (!bundledAsset) throw integrationError("BUNDLED_ASSET_MISSING", "The installer does not contain the pinned Series 4 release; rebuild the installer with the verified bundle");
      const downloaded = await copyBundledRelease(release, bundledAsset, artifactPath, {
        fsp,
        signal: controller.signal,
        progressCallbacks,
      });
      emitProgress(progressCallbacks, { operation: "series4-install", phase: "verifying", version: release.version, downloadedBytes: downloaded.bytes, totalBytes: release.bytes });
      const archive = await inspectZipArchive(artifactPath, {
        fsPromises: fsp,
        signal: controller.signal,
        maxArchiveEntries,
        maxExtractedBytes,
      });
      throwIfCanceled(controller.signal);
      await fsp.mkdir(payloadDir, { recursive: false, mode: 0o700 });
      emitProgress(progressCallbacks, { operation: "series4-install", phase: "extracting", version: release.version, downloadedBytes: downloaded.bytes, totalBytes: release.bytes });
      const extractZip = options.extractZip || defaultExtractZip;
      await extractZip(artifactPath, payloadDir, {
        platform,
        spawnImpl,
        signal: controller.signal,
        extractTimeoutMs: options.extractTimeoutMs || DEFAULT_EXTRACT_TIMEOUT_MS,
        archive,
      });
      throwIfCanceled(controller.signal);
      await inspectExtractedTree(payloadDir, archive, { fsp, signal: controller.signal, maxArchiveEntries, maxExtractedBytes });
      const executable = await detectInstalledExecutable(payloadDir, {
        fsp,
        maxExecutableScanEntries: options.maxExecutableScanEntries,
        maxExecutableScanDepth: options.maxExecutableScanDepth,
      });
      if (!executable) throw integrationError("INSTALL_INCOMPLETE", "The Series 4 application executable is missing from the pinned release");
      const executableStat = await fsp.lstat(executable.path);
      const executableSha256 = await sha256File(executable.path, fileSystem, controller.signal);
      await writeJsonAtomic(path.join(payloadDir, "heyu-series4-receipt.json"), {
        schemaVersion: RECEIPT_SCHEMA_VERSION,
        version: release.version,
        installedAt: new Date().toISOString(),
        artifactBytes: release.bytes,
        artifactSha256: release.sha256,
        packageSource: downloaded.source,
        executableRelativePath: executable.relative,
        executableBytes: executableStat.size,
        executableSha256,
      }, fsp);
      throwIfCanceled(controller.signal);
      emitProgress(progressCallbacks, { operation: "series4-install", phase: "installing", version: release.version, downloadedBytes: downloaded.bytes, totalBytes: release.bytes });
      await fsp.mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
      await assertManagedDirectory(runtimeRoot, rootDir, "The Series 4 runtime directory");
      if (await pathExists(fsp, targetDir)) {
        await fsp.rename(targetDir, backupDir);
        previousMoved = true;
      }
      throwIfCanceled(controller.signal);
      await fsp.rename(payloadDir, targetDir);
      committed = true;
      throwIfCanceled(controller.signal);
      const installed = await readInstalled();
      if (!installed) throw integrationError("INSTALL_INCOMPLETE", "The Series 4 installation failed its final integrity check");
      throwIfCanceled(controller.signal);
      emitProgress(progressCallbacks, { operation: "series4-install", phase: "complete", version: release.version, downloadedBytes: downloaded.bytes, totalBytes: release.bytes });
      return Object.freeze({ ok: true, state: "ready", installed: true, alreadyInstalled: false, repaired: previousMoved, version: release.version, packageSource: downloaded.source });
    } catch (error) {
      let rollbackFailed = false;
      if (committed) {
        try {
          await safeRemoveManaged(targetDir, runtimeRoot);
          committed = false;
        } catch (_error) {
          rollbackFailed = true;
        }
      }
      if (previousMoved) {
        try {
          if (await pathExists(fsp, targetDir)) throw new Error("occupied");
          await fsp.rename(backupDir, targetDir);
          previousMoved = false;
        } catch (_error) {
          rollbackFailed = true;
        }
      }
      if (rollbackFailed) {
        preserveStaging = true;
        throw integrationError("ROLLBACK_FAILED", "The previous Series 4 installation was preserved in quarantine because rollback did not finish");
      }
      if (controller.signal.aborted || error?.code === "OPERATION_CANCELED") throw integrationError("OPERATION_CANCELED", "The Series 4 installation was canceled");
      if (error instanceof Series4IntegrationError) throw error;
      throw integrationError("INSTALL_FAILED", "Series 4 could not be installed");
    } finally {
      if (!preserveStaging && isPathInside(stagingRoot, stagingDir)) {
        await safeRemoveManaged(stagingDir, stagingRoot).catch(() => {});
      }
    }
  }

  function install(installOptions = {}) {
    if (activeInstall) {
      if (typeof installOptions.onProgress === "function") activeInstall.callbacks.add(installOptions.onProgress);
      return activeInstall.promise;
    }
    const controller = new AbortController();
    const callbacks = new Set([onProgress, installOptions.onProgress].filter((item) => typeof item === "function"));
    const relayProgress = (event) => {
      lastProgress = event;
      emitProgress(callbacks, event);
    };
    const timeoutMs = positiveSafeInteger(installOptions.timeoutMs, options.installTimeoutMs || DEFAULT_INSTALL_TIMEOUT_MS, "install timeoutMs");
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    let detachSignal = () => {};
    if (installOptions.signal) {
      const cancel = () => controller.abort();
      if (installOptions.signal.aborted) cancel();
      else installOptions.signal.addEventListener("abort", cancel, { once: true });
      detachSignal = () => installOptions.signal.removeEventListener("abort", cancel);
    }
    const promise = performInstall(installOptions, controller, [relayProgress])
      .catch((error) => {
        if (timedOut) throw integrationError("INSTALL_TIMEOUT", "The Series 4 installation timed out");
        throw error;
      })
      .finally(() => {
        clearTimeout(timeout);
        detachSignal();
        activeInstall = null;
        lastProgress = null;
      });
    activeInstall = { controller, promise, callbacks };
    return promise;
  }

  function cancelInstall() {
    if (!activeInstall) return Object.freeze({ ok: true, canceled: false });
    activeInstall.controller.abort();
    return Object.freeze({ ok: true, canceled: true });
  }

  async function launch() {
    if (platform !== "win32" || architecture !== "x64") throw integrationError("INCOMPATIBLE_PLATFORM", "Series 4 v4.1.1 supports Windows x64 only");
    const installed = await readInstalled();
    if (!installed) throw integrationError("NOT_INSTALLED", "Series 4 is not installed or failed its integrity check");
    let child;
    try {
      child = spawnImpl(installed.executablePath, [], {
        cwd: path.dirname(installed.executablePath),
        shell: false,
        windowsHide: false,
        detached: false,
        stdio: "ignore",
      });
    } catch (_error) {
      throw integrationError("LAUNCH_FAILED", "Series 4 could not be started");
    }
    if (child && typeof child.once === "function") {
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          if (error) reject(error);
          else resolve();
        };
        child.once("spawn", () => finish());
        child.once("error", () => finish(integrationError("LAUNCH_FAILED", "Series 4 could not be started")));
      });
    }
    child?.unref?.();
    return Object.freeze({ ok: true, started: true, version: release.version });
  }

  async function enumerateSidecars(limit) {
    const candidates = [];
    let scannedEntries = 0;
    let truncated = false;
    rootLoop: for (const root of knownProjectRoots) {
      const rootStat = await fsp.lstat(root).catch(() => null);
      if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) continue;
      const realRoot = await fsp.realpath(root);
      const pending = [{ directory: root, depth: 0 }];
      while (pending.length) {
        const current = pending.pop();
        if (current.depth > DEFAULT_MAX_TREE_DEPTH) continue;
        let children;
        try {
          children = await fsp.readdir(current.directory, { withFileTypes: true });
        } catch (_error) {
          continue;
        }
        children.sort((a, b) => a.name.localeCompare(b.name));
        for (const child of children) {
          scannedEntries += 1;
          if (scannedEntries > maxSidecarScanEntries) {
            truncated = true;
            break rootLoop;
          }
          const target = path.join(current.directory, child.name);
          let stat;
          try {
            stat = await fsp.lstat(target);
          } catch (_error) {
            continue;
          }
          if (stat.isSymbolicLink()) continue;
          let realTarget;
          try {
            realTarget = await fsp.realpath(target);
          } catch (_error) {
            continue;
          }
          if (!isPathInside(realRoot, realTarget)) continue;
          if (stat.isDirectory()) {
            pending.push({ directory: target, depth: current.depth + 1 });
          } else if (stat.isFile() && child.name.toLowerCase().endsWith(SIDECAR_SUFFIX) && stat.size <= maxSidecarBytes) {
            if (candidates.length >= maxSidecarCandidates) {
              truncated = true;
              break rootLoop;
            }
            candidates.push({ root: realRoot, sidecarPath: realTarget });
          }
        }
      }
    }
    const summaries = [];
    let skippedCount = 0;
    for (const record of candidates) {
      try {
        const result = await summarizeRecord(record, sidecarContext);
        summaries.push({ record, summary: sessionListMetadata(result.summary) });
      } catch (_error) {
        skippedCount += 1;
      }
    }
    summaries.sort((a, b) => (b.summary.savedAt || "").localeCompare(a.summary.savedAt || ""));
    if (summaries.length > limit) truncated = true;
    return { summaries: summaries.slice(0, limit), truncated, skippedCount };
  }

  async function listSessions(listOptions = {}) {
    const requested = listOptions.limit == null ? maxSessions : Number(listOptions.limit);
    if (!Number.isSafeInteger(requested) || requested < 1) throw integrationError("INVALID_LIMIT", "Series 4 session limit must be a positive integer");
    const limit = Math.min(requested, maxSessions);
    const result = await enumerateSidecars(limit);
    sessionHandles.clear();
    const sessions = result.summaries.map(({ record, summary }) => {
      const sessionId = crypto.randomUUID();
      sessionHandles.set(sessionId, record);
      return Object.freeze({ sessionId, ...summary });
    });
    return Object.freeze({ ok: true, sessions: Object.freeze(sessions), truncated: result.truncated, skippedCount: result.skippedCount });
  }

  function resolveHandle(identifier) {
    const id = String(identifier || "");
    const record = sessionHandles.get(id) || importedHandles.get(id);
    if (!record) throw integrationError("SESSION_NOT_FOUND", "The selected Series 4 session is no longer available; refresh the session list");
    return record;
  }

  async function readSession(sessionId) {
    const record = resolveHandle(sessionId);
    const result = await summarizeRecord(record, sidecarContext);
    return Object.freeze({ ok: true, sessionId: String(sessionId), ...result.summary });
  }

  const inspectSession = readSession;

  async function importSession(sessionId) {
    const record = resolveHandle(sessionId);
    const result = await summarizeRecord(record, sidecarContext);
    const importId = crypto.randomUUID();
    importedHandles.set(importId, record);
    while (importedHandles.size > maxSessions) importedHandles.delete(importedHandles.keys().next().value);
    return Object.freeze({
      ok: true,
      imported: true,
      importId,
      session: Object.freeze({ ...result.summary }),
    });
  }

  async function resolveArtifact(sessionOrImportId, artifactKind) {
    const record = resolveHandle(sessionOrImportId);
    const result = await summarizeRecord(record, sidecarContext);
    if (artifactKind === "video") {
      if (!result.video) throw integrationError("ARTIFACT_NOT_FOUND", "The selected Series 4 video is unavailable");
      return Object.freeze({ kind: "video", path: result.video.path });
    }
    if (artifactKind === "folder") {
      const folderPath = path.dirname(result.parsed.trustedSidecarPath);
      const stat = await fsp.lstat(folderPath);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw integrationError("ARTIFACT_NOT_FOUND", "The selected Series 4 folder is unavailable");
      const [realRoot, realFolder] = await Promise.all([fsp.realpath(record.root), fsp.realpath(folderPath)]);
      if (realFolder !== realRoot && !isPathInside(realRoot, realFolder)) throw integrationError("UNSAFE_PATH", "The Series 4 folder resolves outside its trusted root");
      return Object.freeze({ kind: "folder", path: realFolder });
    }
    throw integrationError("INVALID_ARTIFACT_KIND", "Series 4 artifact kind must be video or folder");
  }

  return Object.freeze({
    getStatus,
    install,
    cancelInstall,
    launch,
    listSessions,
    readSession,
    inspectSession,
    importSession,
    // Main-process-only. Do not expose this path-returning method over IPC.
    resolveArtifact,
  });
}

module.exports = {
  PREFERRED_EXECUTABLE,
  SERIES4_APP_FOLDER,
  SERIES4_BUNDLE_DIRECTORY,
  SERIES4_RELEASE,
  SIDECAR_SUFFIX,
  Series4IntegrationError,
  createSeries4Integration,
  detectInstalledExecutable,
  inspectZipArchive,
  normalizeArchivePath,
  resolveBundledSeries4Asset,
  TEST_ONLY,
};

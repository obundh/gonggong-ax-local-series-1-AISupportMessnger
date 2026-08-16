const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const MANIFEST_SCHEMA_VERSION = 1;
const RECEIPT_SCHEMA_VERSION = 1;
const DEFAULT_MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024 * 1024;
const DEFAULT_MAX_EXTRACTED_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const DEFAULT_EXTRACT_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_MAX_ARCHIVE_ENTRIES = 5_000;
const MAX_REDIRECTS = 6;
const SAFE_IDENTIFIER = /^[a-z0-9](?:[a-z0-9._-]{0,79})$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DEFAULT_RUNTIME_EXECUTABLES = new Set([
  "whisper-cli.exe",
  "main.exe",
  "whisper-cli",
  "main",
]);
const DEFAULT_MODEL_EXTENSIONS = new Set([".bin", ".gguf", ".onnx"]);
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

class SttRuntimeManagerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SttRuntimeManagerError";
    this.code = code;
  }
}

function managerError(code, message) {
  return new SttRuntimeManagerError(code, message);
}

function assertAbsoluteUserDataDir(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new TypeError("userDataDir must be an absolute path");
  }
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) {
    throw new TypeError("userDataDir cannot be a filesystem root");
  }
  return resolved;
}

function assertSafeIdentifier(value, label) {
  const text = String(value || "").toLowerCase();
  if (!SAFE_IDENTIFIER.test(text)) {
    throw managerError("INVALID_MANIFEST", `${label} is not a safe identifier`);
  }
  return text;
}

function safeDisplayText(value, maxLength = 160) {
  return String(value || "")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function positiveSafeInteger(value, fallback, label) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new TypeError(`${label} must be a positive safe integer`);
  return number;
}

function normalizeRelativePath(value, label = "path") {
  const original = String(value || "");
  if (!original || original.includes("\0") || /[\x00-\x1f\x7f]/.test(original)) {
    throw managerError("UNSAFE_PATH", `${label} is empty or contains control characters`);
  }
  const slashPath = original.replaceAll("\\", "/");
  if (slashPath.startsWith("/") || /^[a-z]:/i.test(slashPath) || slashPath.includes(":")) {
    throw managerError("UNSAFE_PATH", `${label} must be relative`);
  }
  const segments = slashPath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw managerError("UNSAFE_PATH", `${label} contains an unsafe segment`);
  }
  for (const segment of segments) {
    if (segment.endsWith(".") || segment.endsWith(" ") || WINDOWS_RESERVED_NAME.test(segment)) {
      throw managerError("UNSAFE_PATH", `${label} is not portable to Windows`);
    }
  }
  return segments.join("/");
}

function safeJoin(rootDir, relativePath, label) {
  const normalized = normalizeRelativePath(relativePath, label);
  const resolvedRoot = path.resolve(rootDir);
  const resolved = path.resolve(resolvedRoot, ...normalized.split("/"));
  if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw managerError("UNSAFE_PATH", `${label || "path"} escapes its root`);
  }
  return resolved;
}

function normalizeTrustedPrefix(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch (_error) {
    throw new TypeError("trustedUrlPrefixes must contain valid HTTPS URLs");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || url.search || /%(?:00|2e|2f|5c)/i.test(url.pathname)) {
    throw new TypeError("trustedUrlPrefixes must contain credential-free HTTPS URL prefixes");
  }
  if (isLocalNetworkHostname(url.hostname)) {
    throw new TypeError("trustedUrlPrefixes cannot target a local network address");
  }
  return Object.freeze({ origin: url.origin, pathname: url.pathname || "/" });
}

function isLocalNetworkHostname(hostname) {
  const host = String(hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map(Number);
  if (octets.some((part) => part > 255)) return true;
  return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
}

function assertTrustedUrl(value, trustedPrefixes) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch (_error) {
    throw managerError("UNTRUSTED_URL", "The artifact URL is invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || isLocalNetworkHostname(url.hostname) || /%(?:00|2e|2f|5c)/i.test(url.pathname)) {
    throw managerError("UNTRUSTED_URL", "Only credential-free public HTTPS artifact URLs are allowed");
  }
  const trusted = trustedPrefixes.some((prefix) => {
    if (url.origin !== prefix.origin) return false;
    if (prefix.pathname.endsWith("/")) return url.pathname.startsWith(prefix.pathname);
    return url.pathname === prefix.pathname;
  });
  if (!trusted) throw managerError("UNTRUSTED_URL", "The artifact URL is outside the trusted source allowlist");
  return url;
}

function normalizeStringArray(value, label, fallback) {
  const source = Array.isArray(value) && value.length ? value : fallback;
  if (!Array.isArray(source) || !source.length || source.length > 32) {
    throw managerError("INVALID_MANIFEST", `${label} must be a non-empty array`);
  }
  return [...new Set(source.map((item) => assertSafeIdentifier(item, label)))];
}

function normalizeArtifact(value, kind, trustedPrefixes, maxDownloadBytes) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw managerError("INVALID_MANIFEST", "artifact must be an object");
  }
  const type = String(value.type || "").toLowerCase();
  if (kind === "runtime" ? !["zip", "file"].includes(type) : type !== "file") {
    throw managerError("INVALID_MANIFEST", `Unsupported ${kind} artifact type`);
  }
  const sha256 = String(value.sha256 || "").toLowerCase();
  if (!SHA256.test(sha256)) {
    throw managerError("INVALID_MANIFEST", "Every artifact requires an exact SHA-256 checksum");
  }
  const bytes = value.bytes == null ? null : Number(value.bytes);
  if (bytes !== null && (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > maxDownloadBytes)) {
    throw managerError("INVALID_MANIFEST", "artifact.bytes is outside the configured download limit");
  }
  const url = assertTrustedUrl(value.url, trustedPrefixes).href;
  return Object.freeze({ type, url, sha256, bytes });
}

function normalizeCatalogEntry(value, kind, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw managerError("INVALID_MANIFEST", `${kind} entries must be objects`);
  }
  const id = assertSafeIdentifier(value.id, `${kind}.id`);
  const version = assertSafeIdentifier(value.version, `${kind}.version`);
  const entry = {
    kind,
    id,
    version,
    installationId: `${kind}:${id}@${version}`,
    name: safeDisplayText(value.name || id),
    description: safeDisplayText(value.description || "", 500),
    license: safeDisplayText(value.license || "", 120),
    engine: assertSafeIdentifier(value.engine || "whisper.cpp", `${kind}.engine`),
    platforms: normalizeStringArray(value.platforms, `${kind}.platforms`, ["win32"]),
    architectures: normalizeStringArray(value.architectures, `${kind}.architectures`, ["x64"]),
    artifact: normalizeArtifact(value.artifact, kind, context.trustedPrefixes, context.maxDownloadBytes),
  };

  if (kind === "runtime") {
    entry.executable = normalizeRelativePath(value.executable, "runtime.executable");
    const executableName = path.posix.basename(entry.executable).toLowerCase();
    if (!context.allowedRuntimeExecutables.has(executableName)) {
      throw managerError("INVALID_MANIFEST", "runtime.executable is not an approved STT executable name");
    }
    const requiredFiles = Array.isArray(value.requiredFiles) ? value.requiredFiles : [];
    if (requiredFiles.length > 128) throw managerError("INVALID_MANIFEST", "runtime.requiredFiles is too large");
    entry.requiredFiles = [...new Set([entry.executable, ...requiredFiles.map((item) => normalizeRelativePath(item, "runtime.requiredFiles"))])];
    const rawChecksums = value.fileChecksums == null ? {} : value.fileChecksums;
    if (!rawChecksums || typeof rawChecksums !== "object" || Array.isArray(rawChecksums)) {
      throw managerError("INVALID_MANIFEST", "runtime.fileChecksums must be an object");
    }
    entry.fileChecksums = Object.freeze(Object.fromEntries(Object.entries(rawChecksums).map(([fileName, digest]) => {
      const normalizedName = normalizeRelativePath(fileName, "runtime.fileChecksums");
      const normalizedDigest = String(digest || "").toLowerCase();
      if (!entry.requiredFiles.includes(normalizedName) || !SHA256.test(normalizedDigest)) {
        throw managerError("INVALID_MANIFEST", "runtime.fileChecksums must match required files and contain SHA-256 values");
      }
      return [normalizedName, normalizedDigest];
    })));
    if (context.requireRuntimeFileChecksums && !entry.fileChecksums[entry.executable]) {
      throw managerError("INVALID_MANIFEST", "runtime.fileChecksums must include the executable checksum");
    }
  } else {
    entry.fileName = normalizeRelativePath(value.fileName, "model.fileName");
    if (entry.fileName.includes("/")) throw managerError("INVALID_MANIFEST", "model.fileName must be a file name");
    if (!context.allowedModelExtensions.has(path.extname(entry.fileName).toLowerCase())) {
      throw managerError("INVALID_MANIFEST", "model.fileName has an unsupported extension");
    }
    entry.modelKey = assertSafeIdentifier(value.modelKey || "custom", "model.modelKey");
    entry.languages = normalizeStringArray(value.languages, "model.languages", ["multilingual"]);
    entry.selectable = value.selectable !== false && entry.modelKey !== "vad";
  }
  return Object.freeze(entry);
}

function normalizeManifest(manifest, options = {}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw managerError("INVALID_MANIFEST", "A manifest object is required");
  }
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw managerError("INVALID_MANIFEST", `Unsupported STT manifest schema: ${manifest.schemaVersion}`);
  }
  const trustedPrefixes = (options.trustedUrlPrefixes || []).map(normalizeTrustedPrefix);
  if (!trustedPrefixes.length) {
    throw new TypeError("At least one trustedUrlPrefixes entry is required");
  }
  const allowedRuntimeExecutables = new Set(
    [...(options.allowedRuntimeExecutables || DEFAULT_RUNTIME_EXECUTABLES)].map((item) => String(item).toLowerCase())
  );
  const allowedModelExtensions = new Set(
    [...(options.allowedModelExtensions || DEFAULT_MODEL_EXTENSIONS)].map((item) => String(item).toLowerCase())
  );
  const context = {
    trustedPrefixes,
    maxDownloadBytes: positiveSafeInteger(options.maxDownloadBytes, DEFAULT_MAX_DOWNLOAD_BYTES, "maxDownloadBytes"),
    allowedRuntimeExecutables,
    allowedModelExtensions,
    requireRuntimeFileChecksums: options.requireRuntimeFileChecksums === true,
  };
  if (manifest.runtimes != null && !Array.isArray(manifest.runtimes)) throw managerError("INVALID_MANIFEST", "manifest.runtimes must be an array");
  if (manifest.models != null && !Array.isArray(manifest.models)) throw managerError("INVALID_MANIFEST", "manifest.models must be an array");
  const runtimes = (manifest.runtimes || []).map((item) => normalizeCatalogEntry(item, "runtime", context));
  const models = (manifest.models || []).map((item) => normalizeCatalogEntry(item, "model", context));
  const ids = new Set();
  for (const entry of [...runtimes, ...models]) {
    if (ids.has(entry.installationId)) throw managerError("INVALID_MANIFEST", `Duplicate catalog entry: ${entry.installationId}`);
    ids.add(entry.installationId);
  }
  return Object.freeze({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedAt: safeDisplayText(manifest.generatedAt || "", 80),
    runtimes: Object.freeze(runtimes),
    models: Object.freeze(models),
  });
}

function isCompatible(entry, platform, arch) {
  return entry.platforms.includes(platform) && entry.architectures.includes(arch);
}

async function writeJsonAtomic(targetPath, value) {
  const parent = path.dirname(targetPath);
  await fsp.mkdir(parent, { recursive: true });
  const temporary = path.join(parent, `.${path.basename(targetPath)}.${crypto.randomUUID()}.tmp`);
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    await fsp.rename(temporary, targetPath);
  } catch (error) {
    if (process.platform === "win32" && ["EEXIST", "EPERM"].includes(error?.code)) {
      await fsp.rm(targetPath, { force: true });
      await fsp.rename(temporary, targetPath);
    } else {
      throw error;
    }
  } finally {
    await fsp.rm(temporary, { force: true }).catch(() => {});
  }
}

async function readJsonFile(filePath) {
  try {
    const text = await fsp.readFile(filePath, "utf8");
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch (_error) {
    return null;
  }
}

async function sha256File(filePath, signal) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) {
    throwIfCanceled(signal);
    hash.update(chunk);
  }
  throwIfCanceled(signal);
  return hash.digest("hex");
}

function emitProgress(callbacks, event) {
  for (const callback of callbacks) {
    if (typeof callback !== "function") continue;
    try {
      callback(Object.freeze({ ...event }));
    } catch (_error) {
      // A UI progress observer cannot interrupt an integrity-checked install.
    }
  }
}

function cancellationError(signal) {
  return signal?.aborted ? managerError("INSTALL_CANCELED", "The STT installation was canceled") : null;
}

function throwIfCanceled(signal) {
  const canceled = cancellationError(signal);
  if (canceled) throw canceled;
}

async function fetchWithTrustedRedirects(urlValue, options) {
  let current = assertTrustedUrl(urlValue, options.trustedPrefixes);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const canceled = cancellationError(options.signal);
    if (canceled) throw canceled;
    let response;
    try {
      response = await options.fetchImpl(current.href, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted || error?.name === "AbortError") throw managerError("INSTALL_CANCELED", "The STT installation was canceled");
      throw managerError("DOWNLOAD_FAILED", "The STT artifact could not be downloaded");
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers?.get?.("location");
      if (!location) throw managerError("DOWNLOAD_FAILED", "The artifact redirect did not include a destination");
      try {
        await response.body?.cancel?.();
      } catch (_error) {
        // The redirect response body is not needed.
      }
      current = assertTrustedUrl(new URL(location, current).href, options.trustedPrefixes);
      continue;
    }
    if (!response.ok || response.status !== 200) {
      throw managerError("DOWNLOAD_FAILED", `The artifact server returned HTTP ${Number(response.status) || 0}`);
    }
    return response;
  }
  throw managerError("DOWNLOAD_FAILED", "The artifact exceeded the redirect limit");
}

async function downloadArtifact(entry, destinationPath, options) {
  const response = await fetchWithTrustedRedirects(entry.artifact.url, options);
  if (!response.body) throw managerError("DOWNLOAD_FAILED", "The artifact response did not contain a body");
  const configuredLimit = Number(options.maxDownloadBytes) || DEFAULT_MAX_DOWNLOAD_BYTES;
  const byteLimit = entry.artifact.bytes == null ? configuredLimit : Math.min(configuredLimit, entry.artifact.bytes);
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > byteLimit) {
    throw managerError("DOWNLOAD_TOO_LARGE", "The artifact is larger than its configured limit");
  }
  const handle = await fsp.open(destinationPath, "wx", 0o600);
  const hash = crypto.createHash("sha256");
  let downloadedBytes = 0;
  try {
    for await (const rawChunk of response.body) {
      throwIfCanceled(options.signal);
      const chunk = Buffer.from(rawChunk);
      downloadedBytes += chunk.length;
      if (downloadedBytes > byteLimit) throw managerError("DOWNLOAD_TOO_LARGE", "The artifact exceeded its configured limit");
      hash.update(chunk);
      await handle.write(chunk);
      emitProgress(options.progressCallbacks, {
        installationId: entry.installationId,
        phase: "downloading",
        downloadedBytes,
        totalBytes: entry.artifact.bytes || (Number.isFinite(contentLength) ? contentLength : 0),
      });
    }
  } finally {
    await handle.close();
  }
  throwIfCanceled(options.signal);
  if (entry.artifact.bytes !== null && downloadedBytes !== entry.artifact.bytes) {
    throw managerError("SIZE_MISMATCH", "The artifact size did not match the trusted manifest");
  }
  const digest = hash.digest("hex");
  if (digest !== entry.artifact.sha256) {
    throw managerError("CHECKSUM_MISMATCH", "The artifact SHA-256 did not match the trusted manifest");
  }
  return { bytes: downloadedBytes, sha256: digest };
}

async function copyAndVerifyLocalArtifact(entry, sourcePath, destinationPath, options = {}) {
  const candidate = String(sourcePath || "");
  if (!candidate || !path.isAbsolute(candidate)) {
    throw managerError("LOCAL_FILE_REQUIRED", "A local artifact file selected by the main process is required");
  }

  let sourceStat;
  let realSource;
  try {
    sourceStat = await fsp.lstat(candidate);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      throw managerError("UNSAFE_LOCAL_FILE", "The selected STT artifact must be a regular local file");
    }
    realSource = await fsp.realpath(candidate);
  } catch (error) {
    if (error instanceof SttRuntimeManagerError) throw error;
    throw managerError("LOCAL_FILE_NOT_FOUND", "The selected STT artifact is no longer available");
  }

  const resolvedRoot = path.resolve(options.rootDir || path.dirname(destinationPath));
  const resolvedSource = path.resolve(realSource);
  if (resolvedSource === resolvedRoot || resolvedSource.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw managerError("UNSAFE_LOCAL_FILE", "An installed STT file cannot be used as an import source");
  }
  if (entry.artifact.bytes !== null && sourceStat.size !== entry.artifact.bytes) {
    throw managerError("SIZE_MISMATCH", "The selected file size does not match the trusted catalog");
  }
  const byteLimit = Math.min(Number(options.maxDownloadBytes) || DEFAULT_MAX_DOWNLOAD_BYTES, entry.artifact.bytes || Number.MAX_SAFE_INTEGER);
  if (sourceStat.size < 1 || sourceStat.size > byteLimit) {
    throw managerError("DOWNLOAD_TOO_LARGE", "The selected file is outside the trusted catalog size limit");
  }

  const sourceHandle = await fsp.open(realSource, "r");
  let destinationHandle = null;
  const hash = crypto.createHash("sha256");
  let copiedBytes = 0;
  try {
    destinationHandle = await fsp.open(destinationPath, "wx", 0o600);
    const openedStat = await sourceHandle.stat();
    if (!openedStat.isFile() || openedStat.size !== sourceStat.size) {
      throw managerError("LOCAL_FILE_CHANGED", "The selected STT artifact changed before verification");
    }
    for await (const rawChunk of sourceHandle.createReadStream({ autoClose: false })) {
      throwIfCanceled(options.signal);
      const chunk = Buffer.from(rawChunk);
      copiedBytes += chunk.length;
      if (copiedBytes > byteLimit) throw managerError("DOWNLOAD_TOO_LARGE", "The selected file exceeded the trusted catalog size limit");
      hash.update(chunk);
      await destinationHandle.write(chunk);
      emitProgress(options.progressCallbacks || [], {
        installationId: entry.installationId,
        phase: "importing",
        downloadedBytes: copiedBytes,
        totalBytes: entry.artifact.bytes || sourceStat.size,
      });
    }
  } finally {
    await Promise.allSettled([
      sourceHandle.close(),
      destinationHandle ? destinationHandle.close() : Promise.resolve(),
    ]);
  }
  throwIfCanceled(options.signal);
  if (entry.artifact.bytes !== null && copiedBytes !== entry.artifact.bytes) {
    throw managerError("SIZE_MISMATCH", "The selected file size does not match the trusted catalog");
  }
  const digest = hash.digest("hex");
  if (digest !== entry.artifact.sha256) {
    throw managerError("CHECKSUM_MISMATCH", "The selected file SHA-256 does not match the trusted catalog");
  }
  return { bytes: copiedBytes, sha256: digest, source: "local-file" };
}

function findEndOfCentralDirectory(tailBuffer) {
  for (let offset = tailBuffer.length - 22; offset >= 0; offset -= 1) {
    if (tailBuffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

async function inspectZipArchive(zipPath, options = {}) {
  throwIfCanceled(options.signal);
  const maxEntries = options.maxArchiveEntries || DEFAULT_MAX_ARCHIVE_ENTRIES;
  const maxExtractedBytes = options.maxExtractedBytes || DEFAULT_MAX_EXTRACTED_BYTES;
  const handle = await fsp.open(zipPath, "r");
  try {
    const stat = await handle.stat();
    if (stat.size < 22) throw managerError("UNSAFE_ARCHIVE", "The runtime ZIP is truncated");
    const tailLength = Math.min(stat.size, 65_557);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, stat.size - tailLength);
    const eocdOffset = findEndOfCentralDirectory(tail);
    if (eocdOffset < 0 || eocdOffset + 22 > tail.length) throw managerError("UNSAFE_ARCHIVE", "The runtime ZIP directory is missing");
    const diskNumber = tail.readUInt16LE(eocdOffset + 4);
    const centralDisk = tail.readUInt16LE(eocdOffset + 6);
    const diskEntries = tail.readUInt16LE(eocdOffset + 8);
    const totalEntries = tail.readUInt16LE(eocdOffset + 10);
    const centralSize = tail.readUInt32LE(eocdOffset + 12);
    const centralOffset = tail.readUInt32LE(eocdOffset + 16);
    const commentLength = tail.readUInt16LE(eocdOffset + 20);
    if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
      throw managerError("UNSAFE_ARCHIVE", "Multi-disk runtime ZIPs are not supported");
    }
    if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw managerError("UNSAFE_ARCHIVE", "ZIP64 runtime archives are not supported");
    }
    if (totalEntries < 1 || totalEntries > maxEntries || centralSize > 32 * 1024 * 1024) {
      throw managerError("UNSAFE_ARCHIVE", "The runtime ZIP has an unsafe number of entries");
    }
    if (eocdOffset + 22 + commentLength !== tail.length || centralOffset + centralSize > stat.size) {
      throw managerError("UNSAFE_ARCHIVE", "The runtime ZIP directory is inconsistent");
    }
    const central = Buffer.alloc(centralSize);
    await handle.read(central, 0, centralSize, centralOffset);
    const entries = [];
    const seen = new Map();
    let offset = 0;
    let extractedBytes = 0;
    for (let index = 0; index < totalEntries; index += 1) {
      throwIfCanceled(options.signal);
      if (offset + 46 > central.length || central.readUInt32LE(offset) !== 0x02014b50) {
        throw managerError("UNSAFE_ARCHIVE", "The runtime ZIP contains a malformed directory entry");
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
      if (end > central.length || nameLength < 1) throw managerError("UNSAFE_ARCHIVE", "The runtime ZIP entry is truncated");
      if ((flags & 0x1) !== 0 || ![0, 8].includes(method)) throw managerError("UNSAFE_ARCHIVE", "Encrypted or unsupported ZIP entries are not allowed");
      if ([compressedSize, uncompressedSize, localHeaderOffset].includes(0xffffffff)) {
        throw managerError("UNSAFE_ARCHIVE", "ZIP64 runtime entries are not supported");
      }
      const nameBytes = central.subarray(offset + 46, offset + 46 + nameLength);
      if ((flags & 0x800) === 0 && nameBytes.some((byte) => byte > 0x7f)) {
        throw managerError("UNSAFE_ARCHIVE", "Non-UTF-8 archive paths are not supported");
      }
      const rawName = nameBytes.toString("utf8");
      if (rawName.includes("�")) throw managerError("UNSAFE_ARCHIVE", "The runtime ZIP path encoding is invalid");
      const isDirectory = rawName.endsWith("/") || rawName.endsWith("\\");
      const trimmedName = isDirectory ? rawName.slice(0, -1) : rawName;
      const name = normalizeRelativePath(trimmedName, "archive entry");
      const collisionKey = name.toLowerCase();
      if (seen.has(collisionKey)) throw managerError("UNSAFE_ARCHIVE", "The runtime ZIP has colliding paths");
      const segments = collisionKey.split("/");
      for (let depth = 1; depth < segments.length; depth += 1) {
        if (seen.get(segments.slice(0, depth).join("/")) === false) {
          throw managerError("UNSAFE_ARCHIVE", "The runtime ZIP places a file above another entry");
        }
      }
      if (!isDirectory && [...seen.keys()].some((item) => item.startsWith(`${collisionKey}/`))) {
        throw managerError("UNSAFE_ARCHIVE", "The runtime ZIP places a file above another entry");
      }
      seen.set(collisionKey, isDirectory);
      const creatorSystem = versionMadeBy >>> 8;
      const unixMode = externalAttributes >>> 16;
      if (creatorSystem === 3 && (unixMode & 0o170000) === 0o120000) {
        throw managerError("UNSAFE_ARCHIVE", "Symbolic links are not allowed in runtime ZIPs");
      }
      extractedBytes += uncompressedSize;
      if (extractedBytes > maxExtractedBytes) throw managerError("UNSAFE_ARCHIVE", "The runtime ZIP expands beyond its configured limit");
      entries.push({ name, isDirectory, localHeaderOffset, flags, method, compressedSize, nameBytes });
      offset = end;
    }
    if (offset !== central.length) throw managerError("UNSAFE_ARCHIVE", "The runtime ZIP directory has trailing data");

    for (const entry of entries) {
      throwIfCanceled(options.signal);
      const localHeader = Buffer.alloc(30);
      const result = await handle.read(localHeader, 0, 30, entry.localHeaderOffset);
      if (result.bytesRead !== 30 || localHeader.readUInt32LE(0) !== 0x04034b50) {
        throw managerError("UNSAFE_ARCHIVE", "The runtime ZIP local header is invalid");
      }
      const localFlags = localHeader.readUInt16LE(6);
      const localMethod = localHeader.readUInt16LE(8);
      const localNameLength = localHeader.readUInt16LE(26);
      const localExtraLength = localHeader.readUInt16LE(28);
      if (localFlags !== entry.flags || localMethod !== entry.method || localNameLength !== entry.nameBytes.length) {
        throw managerError("UNSAFE_ARCHIVE", "The runtime ZIP headers do not agree");
      }
      if (entry.localHeaderOffset + 30 + localNameLength + localExtraLength > stat.size) {
        throw managerError("UNSAFE_ARCHIVE", "The runtime ZIP local entry is truncated");
      }
      if (entry.localHeaderOffset + 30 + localNameLength + localExtraLength + entry.compressedSize > centralOffset) {
        throw managerError("UNSAFE_ARCHIVE", "The runtime ZIP entry overlaps its directory");
      }
      const localName = Buffer.alloc(localNameLength);
      await handle.read(localName, 0, localNameLength, entry.localHeaderOffset + 30);
      if (!localName.equals(entry.nameBytes)) throw managerError("UNSAFE_ARCHIVE", "The runtime ZIP contains conflicting path names");
    }
    throwIfCanceled(options.signal);
    return { entries: entries.map(({ name, isDirectory }) => ({ name, isDirectory })), extractedBytes };
  } finally {
    await handle.close();
  }
}

function runProcess(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    let timer = null;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener?.("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => {
      try {
        child.kill();
      } catch (_error) {
        // The process may already have exited.
      }
      finish(managerError("INSTALL_CANCELED", "The STT installation was canceled"));
    };
    timer = setTimeout(() => {
      try {
        child.kill();
      } catch (_error) {
        // The process may already have exited.
      }
      finish(managerError("EXTRACTION_FAILED", "The runtime ZIP extraction timed out"));
    }, options.timeoutMs || DEFAULT_EXTRACT_TIMEOUT_MS);
    child.on("error", () => {
      finish(managerError("EXTRACTION_FAILED", "A safe ZIP extractor is not available on this computer"));
    });
    child.on("close", (code) => {
      if (options.signal?.aborted) finish(managerError("INSTALL_CANCELED", "The STT installation was canceled"));
      else if (code === 0) finish();
      else finish(managerError("EXTRACTION_FAILED", `The runtime ZIP extractor exited with code ${Number(code) || 0}`));
    });
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

async function defaultExtractZip(zipPath, destinationDir, options = {}) {
  const executable = options.platform === "win32" ? "tar.exe" : "tar";
  await runProcess(executable, ["-xf", zipPath, "-C", destinationDir], {
    cwd: destinationDir,
    timeoutMs: options.extractTimeoutMs,
    signal: options.signal,
  });
}

async function inspectExtractedTree(rootDir, maxExtractedBytes, signal) {
  const pending = [rootDir];
  let totalBytes = 0;
  while (pending.length) {
    throwIfCanceled(signal);
    const current = pending.pop();
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      throwIfCanceled(signal);
      const itemPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw managerError("UNSAFE_ARCHIVE", "Extracted symbolic links are not allowed");
      if (entry.isDirectory()) {
        pending.push(itemPath);
      } else if (entry.isFile()) {
        totalBytes += (await fsp.stat(itemPath)).size;
        if (totalBytes > maxExtractedBytes) throw managerError("UNSAFE_ARCHIVE", "Extracted runtime files exceed their configured limit");
      } else {
        throw managerError("UNSAFE_ARCHIVE", "The runtime archive contains a special filesystem entry");
      }
    }
  }
  throwIfCanceled(signal);
  return totalBytes;
}

async function assertRegularFileInside(rootDir, relativePath, label) {
  const targetPath = safeJoin(rootDir, relativePath, label);
  let stat;
  try {
    stat = await fsp.lstat(targetPath);
  } catch (_error) {
    throw managerError("INSTALL_INCOMPLETE", `${label} is missing from the installed artifact`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw managerError("INSTALL_INCOMPLETE", `${label} is not a regular file`);
  }
  const [realRoot, realTarget] = await Promise.all([fsp.realpath(rootDir), fsp.realpath(targetPath)]);
  if (!realTarget.startsWith(`${realRoot}${path.sep}`)) {
    throw managerError("UNSAFE_PATH", `${label} resolves outside the installation directory`);
  }
  return { path: targetPath, size: stat.size };
}

function installationTarget(rootDir, entry) {
  const kindRoot = entry.kind === "runtime" ? "runtimes" : "models";
  return path.join(rootDir, kindRoot, entry.id, entry.version);
}

function publicCatalogEntry(entry, platform, arch) {
  return {
    kind: entry.kind,
    id: entry.id,
    version: entry.version,
    installationId: entry.installationId,
    name: entry.name,
    description: entry.description,
    license: entry.license,
    engine: entry.engine,
    compatible: isCompatible(entry, platform, arch),
    platforms: [...entry.platforms],
    architectures: [...entry.architectures],
    bytes: entry.artifact.bytes || 0,
    ...(entry.kind === "model" ? { modelKey: entry.modelKey, languages: [...entry.languages], selectable: entry.selectable } : {}),
  };
}

function createSttRuntimeManager(options = {}) {
  const userDataDir = assertAbsoluteUserDataDir(options.userDataDir);
  const rootDir = path.join(userDataDir, "stt");
  const platform = assertSafeIdentifier(options.platform || process.platform, "platform");
  const arch = assertSafeIdentifier(options.arch || process.arch, "arch");
  const maxDownloadBytes = positiveSafeInteger(options.maxDownloadBytes, DEFAULT_MAX_DOWNLOAD_BYTES, "maxDownloadBytes");
  const maxExtractedBytes = positiveSafeInteger(options.maxExtractedBytes, DEFAULT_MAX_EXTRACTED_BYTES, "maxExtractedBytes");
  const allowNetworkInstall = options.allowNetworkInstall === true;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (allowNetworkInstall && typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function when network install is enabled");
  const trustedPrefixes = (options.trustedUrlPrefixes || []).map(normalizeTrustedPrefix);
  const manifest = normalizeManifest(options.manifest, {
    trustedUrlPrefixes: options.trustedUrlPrefixes,
    maxDownloadBytes,
    allowedRuntimeExecutables: options.allowedRuntimeExecutables,
    allowedModelExtensions: options.allowedModelExtensions,
    requireRuntimeFileChecksums: options.requireRuntimeFileChecksums,
  });
  const entries = [...manifest.runtimes, ...manifest.models];
  const entriesByInstallationId = new Map(entries.map((entry) => [entry.installationId, entry]));
  const entriesByCatalogKey = new Map(entries.map((entry) => [`${entry.kind}:${entry.id}`, entry]));
  const selectionPath = path.join(rootDir, "selection.json");
  const stagingRoot = path.join(rootDir, ".staging");
  const activeInstalls = new Map();
  const managerProgress = options.onProgress;

  function getCatalog() {
    return {
      schemaVersion: manifest.schemaVersion,
      generatedAt: manifest.generatedAt,
      platform,
      arch,
      runtimes: manifest.runtimes.map((entry) => publicCatalogEntry(entry, platform, arch)),
      models: manifest.models.map((entry) => publicCatalogEntry(entry, platform, arch)),
    };
  }

  async function readSelections() {
    const value = await readJsonFile(selectionPath);
    const runtimeEntry = entriesByInstallationId.get(value?.runtime);
    const modelEntry = entriesByInstallationId.get(value?.model);
    return {
      runtime: runtimeEntry?.kind === "runtime" ? runtimeEntry.installationId : "",
      model: modelEntry?.kind === "model" && modelEntry.selectable ? modelEntry.installationId : "",
    };
  }

  async function readInstalledEntry(entry) {
    const targetDir = installationTarget(rootDir, entry);
    const receipt = await readJsonFile(path.join(targetDir, "receipt.json"));
    if (!receipt || receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION || receipt.installationId !== entry.installationId || receipt.kind !== entry.kind || receipt.artifact?.sha256 !== entry.artifact.sha256) {
      return null;
    }
    try {
      const requiredPaths = entry.kind === "runtime" ? entry.requiredFiles : [entry.fileName];
      const validatedFiles = new Map();
      for (const relativePath of requiredPaths) {
        const file = await assertRegularFileInside(targetDir, relativePath, "installed component file");
        const receiptRecord = Array.isArray(receipt.files)
          ? receipt.files.find((item) => item?.path === relativePath)
          : null;
        if (!receiptRecord || !Number.isSafeInteger(receiptRecord.size) || receiptRecord.size !== file.size || !SHA256.test(String(receiptRecord.sha256 || ""))) {
          throw managerError("INSTALL_INCOMPLETE", "The installed component receipt does not match its file");
        }
        const expectedDigest = entry.kind === "model" ? entry.artifact.sha256 : entry.fileChecksums[relativePath];
        if (expectedDigest && receiptRecord.sha256 !== expectedDigest) {
          throw managerError("INSTALL_INCOMPLETE", "The installed component does not match the trusted manifest");
        }
        if (entry.kind === "runtime" && expectedDigest && await sha256File(file.path) !== expectedDigest) {
          throw managerError("INSTALL_INCOMPLETE", "The installed runtime file failed its manifest checksum");
        }
        validatedFiles.set(relativePath, file);
      }
      const file = validatedFiles.get(entry.kind === "runtime" ? entry.executable : entry.fileName);
      if (entry.kind === "model" && entry.artifact.bytes !== null && file.size !== entry.artifact.bytes) {
        throw managerError("INSTALL_INCOMPLETE", "The installed model size does not match the trusted manifest");
      }
      return {
        kind: entry.kind,
        id: entry.id,
        version: entry.version,
        installationId: entry.installationId,
        name: entry.name,
        engine: entry.engine,
        installedAt: safeDisplayText(receipt.installedAt, 80),
        path: file.path,
        size: file.size,
        valid: true,
        compatible: isCompatible(entry, platform, arch),
        ...(entry.kind === "runtime" ? { executablePath: file.path } : {
          modelPath: file.path,
          modelKey: entry.modelKey,
          languages: [...entry.languages],
        }),
      };
    } catch (_error) {
      return {
        kind: entry.kind,
        id: entry.id,
        version: entry.version,
        installationId: entry.installationId,
        name: entry.name,
        engine: entry.engine,
        installedAt: safeDisplayText(receipt.installedAt, 80),
        path: "",
        size: 0,
        valid: false,
        compatible: isCompatible(entry, platform, arch),
      };
    }
  }

  async function listInstalled(kind) {
    if (kind && !["runtime", "model"].includes(kind)) throw managerError("INVALID_KIND", "Unknown STT component kind");
    const selected = await readSelections();
    const relevant = entries.filter((entry) => !kind || entry.kind === kind);
    const installed = (await Promise.all(relevant.map(readInstalledEntry))).filter(Boolean);
    return installed.map((item) => ({
      ...item,
      selected: selected[item.kind] === item.installationId,
    }));
  }

  function resolveCatalogEntry(kind, idOrInstallationId) {
    if (!["runtime", "model"].includes(kind)) throw managerError("INVALID_KIND", "Unknown STT component kind");
    const value = String(idOrInstallationId || "").toLowerCase();
    const entry = value.startsWith(`${kind}:`)
      ? entriesByInstallationId.get(value)
      : entriesByCatalogKey.get(`${kind}:${value}`);
    if (!entry || entry.kind !== kind) throw managerError("CATALOG_ENTRY_NOT_FOUND", "The requested STT component is not in the trusted catalog");
    if (!isCompatible(entry, platform, arch)) throw managerError("INCOMPATIBLE_COMPONENT", "The STT component is not compatible with this computer");
    return entry;
  }

  async function saveSelection(kind, installationId) {
    const state = await readSelections();
    state[kind] = installationId;
    await writeJsonAtomic(selectionPath, {
      schemaVersion: 1,
      runtime: state.runtime,
      model: state.model,
      updatedAt: new Date().toISOString(),
    });
  }

  async function select(kind, idOrInstallationId) {
    const entry = resolveCatalogEntry(kind, idOrInstallationId);
    if (entry.kind === "model" && !entry.selectable) {
      throw managerError("COMPONENT_NOT_SELECTABLE", "This STT support asset is installed automatically and cannot be selected as a transcription model");
    }
    const installed = await readInstalledEntry(entry);
    if (!installed?.valid) throw managerError("COMPONENT_NOT_INSTALLED", "The selected STT component is not installed correctly");
    try {
      await saveSelection(kind, entry.installationId);
    } catch (_error) {
      throw managerError("SELECTION_SAVE_FAILED", "The STT selection could not be saved");
    }
    return { ...installed, selected: true };
  }

  async function assertExactRepairTarget(entry, targetDir) {
    const expectedTarget = path.resolve(installationTarget(rootDir, entry));
    const resolvedRoot = path.resolve(rootDir);
    if (path.resolve(targetDir) !== expectedTarget || !expectedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw managerError("UNSAFE_PATH", "The repair target is outside the STT data directory");
    }
    const parentDir = path.dirname(expectedTarget);
    const parentStat = await fsp.lstat(parentDir);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
      throw managerError("UNSAFE_PATH", "The repair target parent is not a regular directory");
    }
    const [realRoot, realParent] = await Promise.all([fsp.realpath(rootDir), fsp.realpath(parentDir)]);
    if (!realParent.startsWith(`${realRoot}${path.sep}`)) {
      throw managerError("UNSAFE_PATH", "The repair target parent resolves outside the STT data directory");
    }
    return expectedTarget;
  }

  async function preparePayload(entry, artifactPath, payloadDir, stageOptions = {}) {
    throwIfCanceled(stageOptions.signal);
    await fsp.mkdir(payloadDir, { recursive: true });
    throwIfCanceled(stageOptions.signal);
    if (entry.artifact.type === "zip") {
      emitProgress(stageOptions.progressCallbacks || [], {
        installationId: entry.installationId,
        phase: "extracting",
        downloadedBytes: stageOptions.downloadedBytes || 0,
        totalBytes: stageOptions.downloadedBytes || entry.artifact.bytes || 0,
      });
      await inspectZipArchive(artifactPath, {
        maxArchiveEntries: options.maxArchiveEntries,
        maxExtractedBytes,
        signal: stageOptions.signal,
      });
      throwIfCanceled(stageOptions.signal);
      const extractor = options.extractZip || defaultExtractZip;
      await extractor(artifactPath, payloadDir, {
        platform,
        extractTimeoutMs: options.extractTimeoutMs || DEFAULT_EXTRACT_TIMEOUT_MS,
        signal: stageOptions.signal,
      });
      throwIfCanceled(stageOptions.signal);
      await inspectExtractedTree(payloadDir, maxExtractedBytes, stageOptions.signal);
    } else {
      throwIfCanceled(stageOptions.signal);
      const relativeName = entry.kind === "runtime" ? entry.executable : entry.fileName;
      const targetPath = safeJoin(payloadDir, relativeName, "artifact target");
      await fsp.mkdir(path.dirname(targetPath), { recursive: true });
      throwIfCanceled(stageOptions.signal);
      await fsp.rename(artifactPath, targetPath);
      throwIfCanceled(stageOptions.signal);
    }

    const files = [];
    if (entry.kind === "runtime") {
      for (const requiredFile of entry.requiredFiles) {
        throwIfCanceled(stageOptions.signal);
        const file = await assertRegularFileInside(payloadDir, requiredFile, "runtime required file");
        const digest = await sha256File(file.path, stageOptions.signal);
        if (entry.fileChecksums[requiredFile] && entry.fileChecksums[requiredFile] !== digest) {
          throw managerError("CHECKSUM_MISMATCH", "An extracted runtime file did not match the trusted manifest");
        }
        files.push({ path: requiredFile, size: file.size, sha256: digest });
      }
      if (platform !== "win32") {
        throwIfCanceled(stageOptions.signal);
        await fsp.chmod(safeJoin(payloadDir, entry.executable, "runtime executable"), 0o755);
      }
    } else {
      throwIfCanceled(stageOptions.signal);
      const file = await assertRegularFileInside(payloadDir, entry.fileName, "model file");
      files.push({ path: entry.fileName, size: file.size, sha256: entry.artifact.sha256 });
    }
    throwIfCanceled(stageOptions.signal);
    return files;
  }

  async function performInstall(entry, installOptions, controller) {
    throwIfCanceled(controller.signal);
    const existing = await readInstalledEntry(entry);
    const shouldSelect = installOptions.autoSelect !== false && (entry.kind !== "model" || entry.selectable);
    if (existing?.valid && !installOptions.localFilePath) {
      if (shouldSelect) {
        const previousSelections = await readSelections();
        throwIfCanceled(controller.signal);
        try {
          await saveSelection(entry.kind, entry.installationId);
          if (controller.signal.aborted) {
            await saveSelection(entry.kind, previousSelections[entry.kind]);
            throwIfCanceled(controller.signal);
          }
        } catch (_error) {
          if (controller.signal.aborted) throw managerError("INSTALL_CANCELED", "The STT installation was canceled");
          throw managerError("SELECTION_SAVE_FAILED", "The STT selection could not be saved");
        }
      }
      throwIfCanceled(controller.signal);
      return { ...existing, selected: shouldSelect, alreadyInstalled: true };
    }
    const targetDir = installationTarget(rootDir, entry);
    await fsp.mkdir(stagingRoot, { recursive: true });
    const stagingDir = path.join(stagingRoot, `${entry.kind}-${entry.id}-${crypto.randomUUID()}`);
    const artifactPath = path.join(stagingDir, entry.artifact.type === "zip" ? "artifact.zip" : "artifact.download");
    const payloadDir = path.join(stagingDir, "payload");
    const quarantineDir = path.join(stagingDir, "quarantine-original");
    const failedReplacementDir = path.join(stagingDir, "failed-replacement");
    await fsp.mkdir(stagingDir, { recursive: false, mode: 0o700 });
    const progressCallbacks = [managerProgress, installOptions.onProgress];
    const previousSelections = shouldSelect ? await readSelections() : null;
    let targetCommitted = false;
    let selectionChanged = false;
    let repairInProgress = false;
    let preserveStaging = false;
    try {
      throwIfCanceled(controller.signal);
      if (await fsp.lstat(targetDir).then(() => true, () => false)) {
        const exactTarget = await assertExactRepairTarget(entry, targetDir);
        emitProgress(progressCallbacks, { installationId: entry.installationId, phase: "repairing", downloadedBytes: 0, totalBytes: entry.artifact.bytes || 0 });
        throwIfCanceled(controller.signal);
        await fsp.rename(exactTarget, quarantineDir);
        repairInProgress = true;
        throwIfCanceled(controller.signal);
      }
      emitProgress(progressCallbacks, { installationId: entry.installationId, phase: "starting", downloadedBytes: 0, totalBytes: entry.artifact.bytes || 0 });
      const downloaded = installOptions.localFilePath
        ? await copyAndVerifyLocalArtifact(entry, installOptions.localFilePath, artifactPath, {
          rootDir,
          signal: controller.signal,
          maxDownloadBytes,
          progressCallbacks,
        })
        : allowNetworkInstall
          ? await downloadArtifact(entry, artifactPath, {
            fetchImpl,
            trustedPrefixes,
            signal: controller.signal,
            maxDownloadBytes,
            progressCallbacks,
          })
          : (() => { throw managerError("NETWORK_INSTALL_DISABLED", "Runtime STT downloads are disabled; select a verified local file instead"); })();
      throwIfCanceled(controller.signal);
      emitProgress(progressCallbacks, { installationId: entry.installationId, phase: "verifying", downloadedBytes: downloaded.bytes, totalBytes: downloaded.bytes });
      throwIfCanceled(controller.signal);
      const files = await preparePayload(entry, artifactPath, payloadDir, {
        signal: controller.signal,
        progressCallbacks,
        downloadedBytes: downloaded.bytes,
      });
      throwIfCanceled(controller.signal);
      emitProgress(progressCallbacks, { installationId: entry.installationId, phase: "installing", downloadedBytes: downloaded.bytes, totalBytes: downloaded.bytes });
      throwIfCanceled(controller.signal);
      await writeJsonAtomic(path.join(payloadDir, "receipt.json"), {
        schemaVersion: RECEIPT_SCHEMA_VERSION,
        kind: entry.kind,
        id: entry.id,
        version: entry.version,
        installationId: entry.installationId,
        engine: entry.engine,
        installedAt: new Date().toISOString(),
        artifact: { sha256: entry.artifact.sha256, bytes: downloaded.bytes },
        executable: entry.kind === "runtime" ? entry.executable : undefined,
        modelFile: entry.kind === "model" ? entry.fileName : undefined,
        files,
      });
      throwIfCanceled(controller.signal);
      await fsp.mkdir(path.dirname(targetDir), { recursive: true });
      throwIfCanceled(controller.signal);
      await fsp.rename(payloadDir, targetDir);
      targetCommitted = true;
      throwIfCanceled(controller.signal);
      if (shouldSelect) {
        await saveSelection(entry.kind, entry.installationId);
        selectionChanged = true;
        throwIfCanceled(controller.signal);
      }
      const installed = await readInstalledEntry(entry);
      throwIfCanceled(controller.signal);
      if (!installed?.valid) throw managerError("INSTALL_INCOMPLETE", "The installed STT component failed its final validation");
      throwIfCanceled(controller.signal);
      emitProgress(progressCallbacks, { installationId: entry.installationId, phase: "complete", downloadedBytes: downloaded.bytes, totalBytes: downloaded.bytes });
      return { ...installed, selected: shouldSelect, alreadyInstalled: false, repaired: repairInProgress };
    } catch (error) {
      const canceled = controller.signal.aborted || error?.code === "INSTALL_CANCELED";
      if (repairInProgress) {
        let rollbackFailed = false;
        if (selectionChanged && previousSelections) {
          try {
            await saveSelection(entry.kind, previousSelections[entry.kind]);
            selectionChanged = false;
          } catch (_error) {
            rollbackFailed = true;
          }
        }
        if (targetCommitted) {
          try {
            const exactTarget = await assertExactRepairTarget(entry, targetDir);
            await fsp.rename(exactTarget, failedReplacementDir);
            targetCommitted = false;
          } catch (_error) {
            rollbackFailed = true;
          }
        }
        try {
          if (await fsp.lstat(targetDir).then(() => true, () => false)) {
            throw managerError("REPAIR_TARGET_OCCUPIED", "The repair target was occupied before rollback");
          }
          await fsp.rename(quarantineDir, targetDir);
          repairInProgress = false;
        } catch (_error) {
          rollbackFailed = true;
        }
        if (rollbackFailed) {
          preserveStaging = true;
          throw managerError("REPAIR_ROLLBACK_FAILED", "The previous STT installation is preserved in quarantine because automatic repair rollback did not finish");
        }
        if (canceled) throw managerError("INSTALL_CANCELED", "The STT installation was canceled");
        if (error instanceof SttRuntimeManagerError) throw error;
        throw managerError("INSTALL_FAILED", "The STT component could not be installed");
      }
      if (canceled) {
        let rollbackFailed = false;
        if (selectionChanged && previousSelections) {
          try {
            await saveSelection(entry.kind, previousSelections[entry.kind]);
          } catch (_error) {
            rollbackFailed = true;
          }
        }
        if (targetCommitted) {
          try {
            const expectedTarget = path.resolve(installationTarget(rootDir, entry));
            if (path.resolve(targetDir) !== expectedTarget || !expectedTarget.startsWith(`${path.resolve(rootDir)}${path.sep}`)) {
              throw managerError("UNSAFE_PATH", "The canceled installation target is outside the STT data directory");
            }
            await fsp.rm(expectedTarget, { recursive: true, force: true });
          } catch (_error) {
            rollbackFailed = true;
          }
        }
        if (rollbackFailed) {
          throw managerError("CANCEL_ROLLBACK_FAILED", "The STT installation was canceled but its local rollback did not finish");
        }
        throw managerError("INSTALL_CANCELED", "The STT installation was canceled");
      }
      if (error instanceof SttRuntimeManagerError) throw error;
      throw managerError("INSTALL_FAILED", "The STT component could not be installed");
    } finally {
      const resolvedStaging = path.resolve(stagingDir);
      const resolvedRoot = path.resolve(stagingRoot);
      if (!preserveStaging && resolvedStaging.startsWith(`${resolvedRoot}${path.sep}`)) {
        await fsp.rm(resolvedStaging, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  async function install(kind, idOrInstallationId, installOptions = {}) {
    const entry = resolveCatalogEntry(kind, idOrInstallationId);
    if (activeInstalls.has(entry.installationId)) return activeInstalls.get(entry.installationId).promise;
    const controller = new AbortController();
    const timeoutMs = Number(installOptions.timeoutMs) || Number(options.downloadTimeoutMs) || DEFAULT_DOWNLOAD_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let detachSignal = () => {};
    if (installOptions.signal) {
      const cancel = () => controller.abort();
      if (installOptions.signal.aborted) cancel();
      else installOptions.signal.addEventListener("abort", cancel, { once: true });
      detachSignal = () => installOptions.signal.removeEventListener("abort", cancel);
    }
    const promise = performInstall(entry, installOptions, controller)
      .catch((error) => {
        if (error instanceof SttRuntimeManagerError) throw error;
        if (controller.signal.aborted) throw managerError("INSTALL_CANCELED", "The STT installation was canceled");
        throw managerError("INSTALL_FAILED", "The STT component could not be installed");
      })
      .finally(() => {
        clearTimeout(timeout);
        detachSignal();
        activeInstalls.delete(entry.installationId);
      });
    activeInstalls.set(entry.installationId, { controller, promise });
    return promise;
  }

  function cancelInstall(idOrInstallationId, kind) {
    let installationId = String(idOrInstallationId || "").toLowerCase();
    if (!installationId.includes(":")) {
      const normalizedKind = ["runtime", "model"].includes(kind) ? kind : "";
      const entry = normalizedKind ? entriesByCatalogKey.get(`${normalizedKind}:${installationId}`) : null;
      installationId = entry?.installationId || "";
    }
    const active = activeInstalls.get(installationId);
    if (!active) return { ok: true, canceled: false };
    active.controller.abort();
    return { ok: true, canceled: true };
  }

  async function getStatus() {
    const [installed, selections] = await Promise.all([listInstalled(), readSelections()]);
    const runtimes = installed.filter((item) => item.kind === "runtime");
    const models = installed.filter((item) => item.kind === "model");
    const runtime = runtimes.find((item) => item.installationId === selections.runtime && item.valid && item.compatible) || null;
    const model = models.find((item) => item.installationId === selections.model && item.valid && item.compatible) || null;
    return {
      ok: Boolean(runtime && model),
      status: runtime && model ? "ready" : runtime ? "model-missing" : model ? "runtime-missing" : "not-installed",
      rootDir,
      platform,
      arch,
      runtime,
      model,
      installed: { runtimes, models },
    };
  }

  async function resolveSelectedPaths() {
    const status = await getStatus();
    return {
      ok: status.ok,
      status: status.status,
      executablePath: status.runtime?.executablePath || "",
      modelPath: status.model?.modelPath || "",
      runtimeInstallationId: status.runtime?.installationId || "",
      modelInstallationId: status.model?.installationId || "",
      modelKey: status.model?.modelKey || "",
    };
  }

  async function verifyInstallation(idOrInstallationId, kind) {
    const entry = resolveCatalogEntry(kind, idOrInstallationId);
    const targetDir = installationTarget(rootDir, entry);
    const receipt = await readJsonFile(path.join(targetDir, "receipt.json"));
    if (!receipt || receipt.artifact?.sha256 !== entry.artifact.sha256 || !Array.isArray(receipt.files)) {
      return { ok: false, installationId: entry.installationId, errorCode: "COMPONENT_NOT_INSTALLED" };
    }
    const requiredPaths = entry.kind === "runtime" ? entry.requiredFiles : [entry.fileName];
    for (const requiredPath of requiredPaths) {
      try {
        const record = receipt.files.find((item) => item?.path === requiredPath);
        if (!record) throw managerError("INSTALL_INCOMPLETE", "The receipt is missing a required file");
        const relativePath = normalizeRelativePath(record.path, "receipt file");
        const file = await assertRegularFileInside(targetDir, relativePath, "receipt file");
        const manifestDigest = entry.kind === "model" ? entry.artifact.sha256 : entry.fileChecksums[relativePath];
        const expectedDigest = manifestDigest || record.sha256;
        if (!SHA256.test(String(record.sha256 || "")) ||
            (manifestDigest && record.sha256 !== manifestDigest) ||
            file.size !== record.size ||
            await sha256File(file.path) !== expectedDigest) {
          return { ok: false, installationId: entry.installationId, errorCode: "INSTALLATION_TAMPERED" };
        }
      } catch (_error) {
        return { ok: false, installationId: entry.installationId, errorCode: "INSTALLATION_TAMPERED" };
      }
    }
    return { ok: true, installationId: entry.installationId, errorCode: "" };
  }

  return Object.freeze({
    rootDir,
    getCatalog,
    listInstalled,
    getStatus,
    resolveSelectedPaths,
    installRuntime: (id, installOptions) => install("runtime", id, installOptions),
    installModel: (id, installOptions) => install("model", id, installOptions),
    importRuntimeFromFile: (id, localFilePath, installOptions = {}) => install("runtime", id, { ...installOptions, localFilePath }),
    importModelFromFile: (id, localFilePath, installOptions = {}) => install("model", id, { ...installOptions, localFilePath }),
    selectRuntime: (id) => select("runtime", id),
    selectModel: (id) => select("model", id),
    cancelInstall,
    verifyRuntime: (id) => verifyInstallation(id, "runtime"),
    verifyModel: (id) => verifyInstallation(id, "model"),
  });
}

module.exports = {
  MANIFEST_SCHEMA_VERSION,
  SttRuntimeManagerError,
  createSttRuntimeManager,
  inspectZipArchive,
  normalizeManifest,
  normalizeRelativePath,
};

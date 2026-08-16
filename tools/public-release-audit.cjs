const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const failures = [];
const checked = { files: 0, text: 0, syntax: 0 };

const forbiddenDirectories = [
  "node_modules",
  "dist",
  "release",
  "release-installer",
  "outputs",
  "offline",
  "tmp",
  "heyu_workspace",
];

const forbiddenExtensions = new Set([
  ".7z",
  ".bin",
  ".ckpt",
  ".dll",
  ".exe",
  ".onnx",
  ".pdf",
  ".pfx",
  ".p12",
  ".pth",
  ".pt",
  ".safetensors",
  ".tar",
  ".tgz",
  ".zip",
]);

const textExtensions = new Set([
  "",
  ".cmd",
  ".cjs",
  ".css",
  ".desktop",
  ".html",
  ".js",
  ".json",
  ".md",
  ".ps1",
  ".py",
  ".sh",
  ".txt",
  ".yaml",
  ".yml",
]);

const reviewedAvatarAssets = new Set([
  "app/renderer/assets/avatars/lawai.png",
  "app/renderer/assets/avatars/hangjeongai.png",
  "app/renderer/assets/avatars/langai.png",
  "app/renderer/assets/avatars/byeonghwanai.png",
  "app/renderer/assets/avatars/languageai.png",
  "app/renderer/assets/avatars/geurimai.png",
  "app/renderer/assets/avatars/sokgiai.png",
  "app/renderer/assets/avatars/gaeboai.png",
  "app/renderer/assets/avatars/routineai.png",
  "app/renderer/assets/avatars/noriai.png",
  "app/renderer/assets/avatars/jawonai.png",
]);

const sensitivePatterns = [
  ["Windows user home path", /[A-Za-z]:[\\/]Users[\\/][^\\/\s`"']+/i],
  ["Unix user home path", /\/home\/[^/\s`"']+/i],
  ["private key material", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["high-confidence API token", /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,})\b/],
  ["Korean registration number", /(?<!\d)\d{6}-[1-8]\d{6}(?!\d)/],
  ["Korean mobile number", /(?<!\d)01[016789]-?\d{3,4}-?\d{4}(?!\d)/],
  ["email address", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
];

// The web demo intentionally shows two reserved, non-personal sample values so
// visitors can see the privacy-officer flow. Only those exact values in that
// exact public demo file are excluded from the identity scan.
const reviewedSyntheticDemoValues = new Map([
  [
    "web-demo/scenarios.js",
    [
      ["010", "0000", "0000"].join("-"),
      ["demo", "example.invalid"].join("@"),
    ],
  ],
]);

function relative(filePath) {
  return path.relative(ROOT, filePath).replaceAll("\\", "/");
}

function fail(message) {
  failures.push(message);
}

function collectFilesystemCandidates(directory, result = []) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const fullPath = path.join(directory, entry.name);
    const rel = relative(fullPath);
    if (entry.isDirectory()) {
      if (
        rel === "vendor/stt-bundle"
        || rel.startsWith("vendor/stt-bundle/")
        || rel === "vendor/series4-bundle"
        || rel.startsWith("vendor/series4-bundle/")
      ) continue;
      if (forbiddenDirectories.includes(rel.split("/")[0])) continue;
      collectFilesystemCandidates(fullPath, result);
      continue;
    }
    if (!entry.isFile()) continue;
    if (rel.startsWith("data/") && rel !== "data/README.md") continue;
    result.push(fullPath);
  }
  return result;
}

function candidateFiles() {
  const probe = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: ROOT, encoding: "utf8" });
  if (probe.status === 0 && String(probe.stdout).trim() === "true") {
    const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    if (listed.status !== 0) fail(`git candidate listing failed: ${String(listed.stderr).trim()}`);
    const files = String(listed.stdout || "")
      .split("\0")
      .filter(Boolean)
      .map((item) => path.resolve(ROOT, item))
      .filter((item) => fs.existsSync(item) && fs.statSync(item).isFile());
    return { mode: "git tracked/unignored", files };
  }
  return { mode: "filesystem source", files: collectFilesystemCandidates(ROOT) };
}

const candidates = candidateFiles();
const privateConfigs = new Set(["app/config/llm.json"]);

for (const fullPath of candidates.files) {
    const rel = relative(fullPath);
    const extension = path.extname(fullPath).toLowerCase();
    const stat = fs.statSync(fullPath);

    checked.files += 1;

    if (forbiddenDirectories.some((directory) => rel === directory || rel.startsWith(`${directory}/`))) {
      fail(`forbidden local/generated path is a release candidate: ${rel}`);
    }
    if (privateConfigs.has(rel)) {
      fail(`private configuration is a release candidate: ${rel}`);
    }

    if (stat.size > 20 * 1024 * 1024) {
      fail(`file exceeds 20 MiB: ${rel}`);
    }
    if (forbiddenExtensions.has(extension)) {
      fail(`unreviewed binary/model/archive is not allowed: ${rel}`);
    }

    if (rel.startsWith("data/") && rel !== "data/README.md") {
      fail(`data directory may contain only data/README.md: ${rel}`);
    }
    if (
      rel.startsWith("app/renderer/assets/avatars/")
      && rel !== "app/renderer/assets/avatars/README.md"
      && !reviewedAvatarAssets.has(rel)
    ) {
      fail(`portrait asset requires manual rights/privacy review: ${rel}`);
    }

    if (textExtensions.has(extension) && rel !== "package-lock.json") {
      checked.text += 1;
      const text = fs.readFileSync(fullPath, "utf8");
      let auditedText = text;
      for (const syntheticValue of reviewedSyntheticDemoValues.get(rel) || []) {
        auditedText = auditedText.replaceAll(syntheticValue, "[reviewed synthetic demo value]");
      }
      for (const [label, pattern] of sensitivePatterns) {
        if (pattern.test(auditedText)) fail(`${label} found in ${rel}`);
      }
    }

    if (extension === ".js" || extension === ".cjs") {
      checked.syntax += 1;
      const result = spawnSync(process.execPath, ["--check", fullPath], { encoding: "utf8" });
      if (result.status !== 0) {
        fail(`JavaScript syntax check failed: ${rel}\n${String(result.stderr || result.stdout).trim()}`);
      }
    }
}

for (const jsonFile of ["package.json", "package-lock.json", "app/config/llm.example.json"]) {
  try {
    JSON.parse(fs.readFileSync(path.join(ROOT, jsonFile), "utf8"));
  } catch (error) {
    fail(`invalid JSON: ${jsonFile} (${error.message})`);
  }
}

for (const licenseFile of [
  "third_party/licenses/whisper.cpp-v1.9.2-MIT.txt",
  "third_party/licenses/OpenAI-Whisper-MIT.txt",
  "third_party/licenses/Silero-VAD-v6.2-MIT.txt",
]) {
  if (!fs.existsSync(path.join(ROOT, licenseFile))) fail(`bundled STT license is missing: ${licenseFile}`);
}

try {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const extraResources = Array.isArray(packageJson.build?.extraResources) ? packageJson.build.extraResources : [];
  const hasSttBundle = extraResources.some((item) => item?.from === "vendor/stt-bundle" && item?.to === "stt-bundle");
  const hasSeries4Bundle = extraResources.some((item) => item?.from === "vendor/series4-bundle" && item?.to === "series4-bundle");
  const hasLicenses = extraResources.some((item) => item?.from === "third_party/licenses" && item?.to === "licenses");
  const hasNotices = extraResources.some((item) => item?.from === "THIRD_PARTY_NOTICES.md" && item?.to === "licenses/THIRD_PARTY_NOTICES.md");
  if (!hasSttBundle) fail("package build must include the verified STT bundle as extraResources");
  if (!hasSeries4Bundle) fail("package build must include the verified Series 4 bundle as extraResources");
  if (!hasLicenses) fail("package build must include bundled STT licenses as extraResources");
  if (!hasNotices) fail("package build must expose third-party notices beside bundled STT licenses");
} catch (error) {
  fail(`unable to verify bundled STT package resources (${error.message})`);
}

if (failures.length) {
  console.error(`Public release audit failed with ${failures.length} issue(s):`);
  for (const issue of failures) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(`Public release audit passed (${candidates.mode}): ${checked.files} files, ${checked.text} text files, ${checked.syntax} JavaScript files.`);

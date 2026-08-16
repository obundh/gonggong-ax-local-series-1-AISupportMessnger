const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { Data, NtExecutable, NtExecutableResource, Resource } = require("resedit");

const ROOT_DIR = path.resolve(__dirname, "..");
const LAUNCHER_FILE_NAME = "HEYU.exe";
const RECEIPT_FILE_NAME = "HEYU.launcher.json";
const APP_NAME = "AI지원담당";
const LAUNCHER_SCHEMA_VERSION = 1;

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function resolveLauncherPaths(rootDir = ROOT_DIR) {
  const electronExecutable = require("electron");
  const electronDir = path.dirname(electronExecutable);
  return {
    rootDir,
    electronExecutable,
    iconPath: path.join(rootDir, "app", "renderer", "assets", "app-icon.ico"),
    launcherPath: path.join(electronDir, LAUNCHER_FILE_NAME),
    receiptPath: path.join(electronDir, RECEIPT_FILE_NAME),
  };
}

function normalizeVersion(version) {
  const parts = String(version || "0.1.0")
    .split(".")
    .slice(0, 4)
    .map((part) => String(Math.max(0, Number.parseInt(part, 10) || 0)));
  while (parts.length < 3) parts.push("0");
  return parts.join(".");
}

async function editLauncherResources(executablePath, iconPath, packageVersion) {
  const input = await fsp.readFile(executablePath);
  const executable = NtExecutable.from(input);
  const resources = NtExecutableResource.from(executable);
  const versionInfos = Resource.VersionInfo.fromEntries(resources.entries);
  const versionInfo = versionInfos[0] || Resource.VersionInfo.createEmpty();
  const versionLanguages = versionInfo.getAllLanguagesForStringValues();
  const language = versionLanguages[0] || { lang: 0x0409, codepage: 1200 };
  const normalizedVersion = normalizeVersion(packageVersion);

  versionInfo.setFileVersion(normalizedVersion);
  versionInfo.setProductVersion(normalizedVersion);
  versionInfo.setStringValues(language, {
    FileDescription: APP_NAME,
    ProductName: APP_NAME,
    InternalName: "HEYU",
    OriginalFilename: LAUNCHER_FILE_NAME,
    CompanyName: "AI지원담당 contributors",
    FileVersion: normalizedVersion,
    ProductVersion: normalizedVersion,
  });
  versionInfo.outputToResourceEntries(resources.entries);

  const iconBuffer = await fsp.readFile(iconPath);
  const iconFile = Data.IconFile.from(iconBuffer);
  Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    1,
    language.lang,
    iconFile.icons.map((icon) => icon.data),
  );

  resources.outputResource(executable);
  await fsp.writeFile(executablePath, Buffer.from(executable.generate()));
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.name === "SyntaxError")) return null;
    throw error;
  }
}

async function prepareWindowsDevLauncher(options = {}) {
  if (process.platform !== "win32" && !options.allowNonWindows) {
    throw new Error("HEYU Windows launcher preparation is available only on Windows.");
  }

  const resolved = options.paths || resolveLauncherPaths(options.rootDir || ROOT_DIR);
  const packageJsonPath = path.join(resolved.rootDir, "package.json");
  const packageJson = JSON.parse(await fsp.readFile(packageJsonPath, "utf8"));
  const sourceHash = await sha256File(resolved.electronExecutable);
  const iconHash = await sha256File(resolved.iconPath);
  const expectedReceipt = {
    schemaVersion: LAUNCHER_SCHEMA_VERSION,
    sourceSha256: sourceHash,
    iconSha256: iconHash,
    packageVersion: normalizeVersion(packageJson.version),
  };

  const currentReceipt = await readJsonIfPresent(resolved.receiptPath);
  if (
    currentReceipt
    && Object.keys(expectedReceipt).every((key) => currentReceipt[key] === expectedReceipt[key])
  ) {
    try {
      await fsp.access(resolved.launcherPath, fs.constants.R_OK | fs.constants.X_OK);
      return { ...resolved, created: false, receipt: currentReceipt };
    } catch {
      // The receipt is stale; rebuild the missing launcher.
    }
  }

  const stagingPath = `${resolved.launcherPath}.${process.pid}.${Date.now()}.tmp`;
  const stagedReceiptPath = `${resolved.receiptPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsp.copyFile(resolved.electronExecutable, stagingPath);
    await (options.editResources || editLauncherResources)(
      stagingPath,
      resolved.iconPath,
      expectedReceipt.packageVersion,
    );
    const launcherHash = await sha256File(stagingPath);
    if (launcherHash === sourceHash) {
      throw new Error("HEYU launcher icon/resource editing did not change the copied executable.");
    }
    const completeReceipt = { ...expectedReceipt, launcherSha256: launcherHash };
    await fsp.writeFile(stagedReceiptPath, `${JSON.stringify(completeReceipt, null, 2)}\n`, "utf8");

    const previousLauncherPath = `${resolved.launcherPath}.previous`;
    const previousReceiptPath = `${resolved.receiptPath}.previous`;
    let hadPreviousLauncher = false;
    let hadPreviousReceipt = false;
    try {
      await fsp.rm(previousLauncherPath, { force: true });
      await fsp.rm(previousReceiptPath, { force: true });
      try {
        await fsp.rename(resolved.launcherPath, previousLauncherPath);
        hadPreviousLauncher = true;
      } catch (error) {
        if (!error || error.code !== "ENOENT") throw error;
      }
      try {
        await fsp.rename(resolved.receiptPath, previousReceiptPath);
        hadPreviousReceipt = true;
      } catch (error) {
        if (!error || error.code !== "ENOENT") throw error;
      }
      await fsp.rename(stagingPath, resolved.launcherPath);
      await fsp.rename(stagedReceiptPath, resolved.receiptPath);
      await fsp.rm(previousLauncherPath, { force: true });
      await fsp.rm(previousReceiptPath, { force: true });
    } catch (error) {
      try {
        await fsp.rm(resolved.launcherPath, { force: true });
        await fsp.rm(resolved.receiptPath, { force: true });
        if (hadPreviousLauncher) await fsp.rename(previousLauncherPath, resolved.launcherPath);
        if (hadPreviousReceipt) await fsp.rename(previousReceiptPath, resolved.receiptPath);
      } catch {
        // Preserve the original failure; recovery is best-effort and targets only HEYU-owned files.
      }
      throw new Error(`HEYU 전용 실행기를 갱신하지 못했습니다. 실행 중인 HEYU를 닫고 다시 시도하세요. (${error.code || "PREPARE_FAILED"})`);
    }

    return { ...resolved, created: true, receipt: completeReceipt };
  } finally {
    await fsp.rm(stagingPath, { force: true });
    await fsp.rm(stagedReceiptPath, { force: true });
  }
}

async function launchHeyu({ detached = false } = {}) {
  const prepared = await prepareWindowsDevLauncher();
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(prepared.launcherPath, [prepared.rootDir], {
    cwd: prepared.rootDir,
    env: childEnv,
    detached,
    shell: false,
    stdio: detached ? "ignore" : "inherit",
    windowsHide: false,
  });

  if (detached) {
    child.unref();
    return 0;
  }
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) return resolve(1);
      return resolve(Number.isInteger(code) ? code : 1);
    });
  });
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--prepare-only")) {
    const result = await prepareWindowsDevLauncher();
    console.log(`[HEYU] 전용 실행기 ${result.created ? "생성" : "확인"}: ${result.launcherPath}`);
    return;
  }
  const exitCode = await launchHeyu({ detached: args.has("--detach") });
  process.exitCode = exitCode;
}

module.exports = {
  APP_NAME,
  LAUNCHER_FILE_NAME,
  RECEIPT_FILE_NAME,
  editLauncherResources,
  launchHeyu,
  normalizeVersion,
  prepareWindowsDevLauncher,
  resolveLauncherPaths,
  sha256File,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`[HEYU] ${error.message}`);
    process.exitCode = 1;
  });
}

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const { NtExecutable, NtExecutableResource, Resource } = require("resedit");
const {
  LAUNCHER_FILE_NAME,
  prepareWindowsDevLauncher,
  resolveLauncherPaths,
  sha256File,
} = require("./windows-dev-launcher.cjs");

const ROOT_DIR = path.resolve(__dirname, "..");
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"));
const LAUNCHER_SOURCE = fs.readFileSync(path.join(ROOT_DIR, "tools", "windows-dev-launcher.cjs"), "utf8");
const CMD_SOURCE = fs.readFileSync(path.join(ROOT_DIR, "HEYU_실행.cmd"), "utf8");

function readLauncherResources(filePath) {
  const buffer = fs.readFileSync(filePath);
  const executable = NtExecutable.from(buffer);
  const resources = NtExecutableResource.from(executable);
  const iconGroups = Resource.IconGroupEntry.fromEntries(resources.entries);
  const versionInfo = Resource.VersionInfo.fromEntries(resources.entries)[0];
  const language = versionInfo.getAllLanguagesForStringValues()[0];
  return {
    iconSizes: iconGroups[0].icons.map((icon) => `${icon.width || 256}x${icon.height || 256}`),
    versionStrings: versionInfo.getStringValues(language),
  };
}

test("Windows start commands launch the branded HEYU executable path", () => {
  assert.match(CMD_SOURCE, /windows-dev-launcher\.cjs" --detach/);
  assert.doesNotMatch(CMD_SOURCE, /start\s+""\s+"node_modules\\electron\\dist\\electron\.exe"/i);
  assert.match(PACKAGE.scripts.start, /windows-dev-launcher\.cjs/);
  assert.match(PACKAGE.scripts["start:safe"], /windows-dev-launcher\.cjs/);
  assert.equal(PACKAGE.devDependencies.resedit, "^1.7.2");
  assert.match(LAUNCHER_SOURCE, /const LAUNCHER_FILE_NAME = "HEYU\.exe"/);
});

test("preparation preserves electron.exe and embeds the Kim Geurim icon in HEYU.exe", async () => {
  const paths = resolveLauncherPaths(ROOT_DIR);
  const sourceHashBefore = await sha256File(paths.electronExecutable);
  const first = await prepareWindowsDevLauncher();
  const sourceHashAfter = await sha256File(paths.electronExecutable);
  assert.equal(sourceHashAfter, sourceHashBefore, "the original Electron executable must remain unchanged");
  assert.equal(path.basename(first.launcherPath), LAUNCHER_FILE_NAME);
  assert.notEqual(path.resolve(first.launcherPath), path.resolve(paths.electronExecutable));
  assert.equal(await sha256File(first.launcherPath), first.receipt.launcherSha256);

  const resources = readLauncherResources(first.launcherPath);
  assert.deepEqual(resources.iconSizes, [
    "16x16",
    "20x20",
    "24x24",
    "32x32",
    "40x40",
    "48x48",
    "64x64",
    "96x96",
    "128x128",
    "256x256",
  ]);
  assert.equal(resources.versionStrings.FileDescription, "AI지원담당");
  assert.equal(resources.versionStrings.ProductName, "AI지원담당");
  assert.equal(resources.versionStrings.OriginalFilename, LAUNCHER_FILE_NAME);

  const second = await prepareWindowsDevLauncher();
  assert.equal(second.created, false, "an unchanged launcher should be reused");
  assert.equal(await sha256File(second.launcherPath), first.receipt.launcherSha256);
});

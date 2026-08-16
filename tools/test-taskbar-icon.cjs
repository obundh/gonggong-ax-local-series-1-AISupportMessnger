const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT_DIR = path.resolve(__dirname, "..");
const MAIN_SOURCE = fs.readFileSync(path.join(ROOT_DIR, "app", "main", "main.cjs"), "utf8");
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"));
const APP_ICON_PNG = fs.readFileSync(path.join(ROOT_DIR, "app", "renderer", "assets", "app-icon.png"));
const GEURIM_AVATAR = fs.readFileSync(path.join(ROOT_DIR, "app", "renderer", "assets", "avatars", "geurimai.png"));
const APP_ICON_ICO = fs.readFileSync(path.join(ROOT_DIR, "app", "renderer", "assets", "app-icon.ico"));

function icoSizes(buffer) {
  assert.equal(buffer.readUInt16LE(0), 0, "ICO reserved header must be zero");
  assert.equal(buffer.readUInt16LE(2), 1, "ICO must contain icon images");
  const count = buffer.readUInt16LE(4);
  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + (index * 16);
    const width = buffer[offset] || 256;
    const height = buffer[offset + 1] || 256;
    sizes.push(`${width}x${height}`);
  }
  return sizes;
}

test("taskbar icon assets are the Kim Geurim avatar at Windows DPI sizes", () => {
  assert.deepEqual(APP_ICON_PNG, GEURIM_AVATAR);
  assert.deepEqual(icoSizes(APP_ICON_ICO), [
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
});

test("every HEYU BrowserWindow gets the Windows taskbar identity", () => {
  assert.match(MAIN_SOURCE, /const APP_USER_MODEL_ID = "local\.ai\.messenger"/);
  assert.match(MAIN_SOURCE, /app\.setAppUserModelId\(APP_USER_MODEL_ID\)/);
  assert.match(MAIN_SOURCE, /browserWindow\.setIcon\(iconPath\)/);
  assert.match(MAIN_SOURCE, /browserWindow\.setAppDetails\(details\)/);
  assert.match(MAIN_SOURCE, /appIconPath:\s*iconPath/);
  assert.match(MAIN_SOURCE, /relaunchCommand/);
  const applications = MAIN_SOURCE.match(/applyWindowsTaskbarIdentity\([^)]+\);/g) || [];
  assert.equal(applications.length, 5, "main, chat, PDF editor, config, and profile windows must opt in");
});

test("packaged EXE and taskbar identities share the same app id and icon", () => {
  assert.equal(PACKAGE.build.appId, "local.ai.messenger");
  assert.equal(PACKAGE.build.win.icon, "app/renderer/assets/app-icon.ico");
  assert.equal(PACKAGE.build.win.signExecutable, false);
  assert.equal(Object.hasOwn(PACKAGE.build.win, "signAndEditExecutable"), false);
});
